import { cookies, headers } from 'next/headers';
import crypto from 'crypto';
import { getSessionById, saveSession, deleteSessionById, DBSession } from './database';
import { getCollegeAPIClient, CollegeUser } from './college-api';

export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'kit_session';

export interface UserSessionData {
  userId: string;
  role: 'public' | 'student' | 'teacher';
  displayName: string;
  isAuthenticated: boolean;
  token?: string;
  classCode?: string;
  department?: string;
}

/**
 * Generate a random cryptographic session ID.
 */
export function generateSessionId(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Sanitize data by redacting sensitive fields.
 */
export function sanitizeData(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(sanitizeData);
  }

  const result: Record<string, any> = {};
  const SENSITIVE_KEYS = new Set(['password', 'access_token', 'token', 'authorization', 'secret', 'client_secret']);

  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object') {
      result[key] = sanitizeData(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Get the current user session from HTTP-only cookie or session header.
 * If not logged in, returns a public anonymous session.
 */
export async function getCurrentSession(): Promise<UserSessionData> {
  const cookieStore = await cookies();
  const headerStore = await headers();

  let sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  // Fallback: Check x-session-id or Authorization header
  if (!sessionCookie) {
    const customHeader = headerStore.get('x-session-id');
    if (customHeader) {
      sessionCookie = customHeader;
    } else {
      const authHeader = headerStore.get('authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        sessionCookie = authHeader.replace('Bearer ', '').trim();
      }
    }
  }

  if (sessionCookie) {
    const session = getSessionById(sessionCookie);
    if (session) {
      return {
        userId: session.user_id,
        role: session.role as 'student' | 'teacher',
        displayName: session.display_name,
        isAuthenticated: true,
        token: session.college_jwt,
      };
    }
  }

  // Fallback to anonymous public session
  // Generate or retrieve anonymous visitor id from a non-sensitive public cookie if desired
  let publicVisitorId = cookieStore.get('kit_visitor_id')?.value;
  if (!publicVisitorId) {
    publicVisitorId = `pub_${crypto.randomBytes(8).toString('hex')}`;
  }

  return {
    userId: publicVisitorId,
    role: 'public',
    displayName: 'Prospective Student / Visitor',
    isAuthenticated: false,
  };
}

/**
 * Establish a logged-in user session in SQLite and set HTTP-only cookie.
 */
export async function createAuthenticatedSession(
  user: CollegeUser,
  accessToken: string,
  expiresInSeconds: number = 28800
): Promise<string> {
  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

  const sessionRecord: DBSession = {
    id: sessionId,
    user_id: user.login_id,
    role: user.role,
    display_name: user.full_name,
    college_jwt: accessToken,
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
  };

  saveSession(sessionRecord);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: 'lax',
    path: '/',
    maxAge: expiresInSeconds,
  });

  return sessionId;
}

/**
 * Destroy the current session.
 */
export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (sessionCookie) {
    deleteSessionById(sessionCookie);
    cookieStore.delete(SESSION_COOKIE_NAME);
  }
}
