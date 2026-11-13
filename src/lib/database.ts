import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.DATABASE_PATH || './data/kit_assistant.db';

let dbInstance: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!dbInstance) {
    const fullPath = path.join(process.cwd(), 'data', 'kit_assistant.db');
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    dbInstance = new Database(fullPath);
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('foreign_keys = ON');

    initSchema(dbInstance);
  }
  return dbInstance;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      external_user_id TEXT UNIQUE,
      role TEXT NOT NULL,
      display_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      display_name TEXT NOT NULL,
      college_jwt TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_id TEXT,
      role TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tool_executions (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      execution_status TEXT NOT NULL,
      result_summary TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pending_actions (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      parameters TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_tool_executions_conversation ON tool_executions(conversation_id);
  `);
}

// === Database Helper Functions ===

export interface DBUser {
  id: string;
  external_user_id: string;
  role: string;
  display_name: string;
  created_at: string;
}

export interface DBSession {
  id: string;
  user_id: string;
  role: string;
  display_name: string;
  college_jwt: string;
  expires_at: string;
  created_at: string;
}

export interface DBConversation {
  id: string;
  user_id: string;
  session_id: string | null;
  role: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface DBMessage {
  id: string;
  conversation_id: string;
  sender: 'user' | 'assistant' | 'system';
  message: string;
  created_at: string;
}

export interface DBToolExecution {
  id: string;
  conversation_id: string;
  tool_name: string;
  execution_status: string;
  result_summary: string | null;
  created_at: string;
}

export function saveSession(session: DBSession): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO sessions (id, user_id, role, display_name, college_jwt, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      user_id=excluded.user_id,
      role=excluded.role,
      display_name=excluded.display_name,
      college_jwt=excluded.college_jwt,
      expires_at=excluded.expires_at
  `);
  stmt.run(
    session.id,
    session.user_id,
    session.role,
    session.display_name,
    session.college_jwt,
    session.expires_at
  );
}

export function getSessionById(sessionId: string): DBSession | null {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM sessions WHERE id = ? AND expires_at > datetime('now')
  `);
  return (stmt.get(sessionId) as DBSession) || null;
}

export function deleteSessionById(sessionId: string): void {
  const db = getDatabase();
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
}

export function createConversation(data: {
  id: string;
  user_id: string;
  session_id?: string | null;
  role: string;
  title: string;
}): DBConversation {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO conversations (id, user_id, session_id, role, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET updated_at = datetime('now')
  `);
  stmt.run(data.id, data.user_id, data.session_id || null, data.role, data.title);
  return getConversationById(data.id, data.user_id)!;
}

export function getConversationById(id: string, user_id?: string): DBConversation | null {
  const db = getDatabase();
  if (user_id) {
    const stmt = db.prepare(`SELECT * FROM conversations WHERE id = ? AND user_id = ?`);
    const found = stmt.get(id, user_id) as DBConversation;
    if (found) return found;
  }
  const fallbackStmt = db.prepare(`SELECT * FROM conversations WHERE id = ?`);
  return (fallbackStmt.get(id) as DBConversation) || null;
}

export function listUserConversations(userId: string): DBConversation[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC
  `);
  return stmt.all(userId) as DBConversation[];
}

export function saveMessage(data: {
  id: string;
  conversation_id: string;
  sender: 'user' | 'assistant' | 'system';
  message: string;
}): DBMessage {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO messages (id, conversation_id, sender, message, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);
  stmt.run(data.id, data.conversation_id, data.sender, data.message);

  // Update conversation updated_at
  db.prepare(`UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`).run(
    data.conversation_id
  );

  return {
    id: data.id,
    conversation_id: data.conversation_id,
    sender: data.sender,
    message: data.message,
    created_at: new Date().toISOString(),
  };
}

export function getConversationMessages(conversationId: string): DBMessage[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC
  `);
  return stmt.all(conversationId) as DBMessage[];
}

export function logToolExecution(data: {
  id: string;
  conversation_id: string;
  tool_name: string;
  execution_status: string;
  result_summary?: string;
}): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO tool_executions (id, conversation_id, tool_name, execution_status, result_summary, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `);
  stmt.run(
    data.id,
    data.conversation_id,
    data.tool_name,
    data.execution_status,
    data.result_summary || null
  );
}

export function getConversationToolExecutions(conversationId: string): DBToolExecution[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM tool_executions WHERE conversation_id = ? ORDER BY created_at ASC
  `);
  return stmt.all(conversationId) as DBToolExecution[];
}
