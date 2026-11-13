import crypto from 'crypto';
import { UserSessionData } from '@/lib/auth';
import { getCollegeAPIClient } from '@/lib/college-api';
import {
  createChatCompletionWithFallback,
  ChatMessage,
} from '@/lib/groq';
import {
  saveMessage,
  logToolExecution,
  getConversationMessages,
  createConversation,
  getConversationById,
  DBMessage,
} from '@/lib/database';
import { getToolsForRole, executeTool, ToolExecutionResult } from './tool-registry';
import { buildSystemPrompt } from './system-prompt';

export interface AgentProcessInput {
  conversationId?: string;
  message: string;
  session: UserSessionData;
}

export interface AgentProcessOutput {
  conversationId: string;
  response: string;
  modelUsed: string;
  toolExecutions: Array<{
    toolName: string;
    success: boolean;
    summary: string;
    data?: any;
    actionRequired?: string;
  }>;
}

const MAX_TOOL_ITERATIONS = 5;

/**
 * Central Groq Agent Orchestrator for Knotopian Institute of Technology (KIT).
 */
export async function runAgentOrchestration(
  input: AgentProcessInput
): Promise<AgentProcessOutput> {
  const { message, session } = input;
  let conversationId = input.conversationId;

  // 1. Resolve or create conversation in SQLite
  if (!conversationId) {
    conversationId = crypto.randomUUID();
    const shortTitle = message.slice(0, 40).replace(/\n/g, ' ') || 'New Conversation';
    createConversation({
      id: conversationId,
      user_id: session.userId,
      role: session.role,
      title: shortTitle,
    });
  } else {
    const existing = getConversationById(conversationId, session.userId);
    if (!existing) {
      // Create if client passed a new ID
      createConversation({
        id: conversationId,
        user_id: session.userId,
        role: session.role,
        title: message.slice(0, 40) || 'Conversation',
      });
    }
  }

  // 2. Persist incoming user message to SQLite
  saveMessage({
    id: crypto.randomUUID(),
    conversation_id: conversationId,
    sender: 'user',
    message,
  });

  // 3. Load live college date from College API
  const client = getCollegeAPIClient();
  let todayDate = '2026-11-21';
  try {
    const today = await client.getToday();
    todayDate = today.date;
  } catch (err) {
    console.warn('[Orchestrator]: Using fallback date for prompt context');
  }

  // 4. Build system prompt & conversation context
  const systemPrompt = buildSystemPrompt(session, todayDate);
  const historyMessages = getConversationMessages(conversationId);

  // Take recent message history (last 10 messages for context)
  const recentHistory = historyMessages.slice(-10);

  const groqMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...recentHistory.map(m => ({
      role: (m.sender === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.message,
    })),
  ];

  // 5. Get role-restricted tool definitions
  const availableTools = getToolsForRole(session.role);

  let iterations = 0;
  let finalResponseText = '';
  let lastModelUsed = '';
  const executedToolsLog: Array<{
    toolName: string;
    success: boolean;
    summary: string;
    data?: any;
    actionRequired?: string;
  }> = [];

  try {
    // 6. Bounded Tool Execution Loop (max 5 iterations)
    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      const completion = await createChatCompletionWithFallback({
        messages: groqMessages,
        tools: availableTools,
        tool_choice: availableTools.length > 0 ? 'auto' : 'none',
        temperature: 0.2,
      });

      lastModelUsed = completion.modelUsed;
      const assistantMsg = completion.message;

      // Append assistant's output to message buffer
      groqMessages.push({
        role: 'assistant',
        content: assistantMsg.content || null,
        tool_calls: assistantMsg.tool_calls || undefined,
      });

      // If the model did not request tool calls, we're done
      if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
        finalResponseText = assistantMsg.content || 'I have processed your request.';
        break;
      }

      // Execute each tool call requested by Groq
      for (const toolCall of assistantMsg.tool_calls) {
        const functionName = toolCall.function.name;
        let functionArgs: any = {};
        try {
          functionArgs = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          functionArgs = {};
        }

        console.info(`[Agent Tool Call ${iterations}]: ${functionName}`, functionArgs);

        // Execute local tool with strict RBAC enforcement
        const toolResult: ToolExecutionResult = await executeTool(
          functionName,
          functionArgs,
          session
        );

        // Record execution in SQLite audit log
        logToolExecution({
          id: crypto.randomUUID(),
          conversation_id: conversationId,
          tool_name: functionName,
          execution_status: toolResult.success ? 'success' : 'failed',
          result_summary: toolResult.summary,
        });

        executedToolsLog.push({
          toolName: functionName,
          success: toolResult.success,
          summary: toolResult.summary,
          data: toolResult.data,
          actionRequired: toolResult.actionRequired,
        });

        // Feed tool response back to Groq
        groqMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: functionName,
          content: JSON.stringify(toolResult),
        });
      }
    }

    // Fallback if max iterations reached without final text
    if (!finalResponseText) {
      finalResponseText = 'I have processed your request and updated the college records.';
    }
  } catch (error: any) {
    console.error('[Agent Orchestration Error]:', error);

    // Deterministic fallback if Groq or downstream fails
    finalResponseText = `I apologize, but I encountered a temporary issue connecting to the AI processing service (${error.message || 'Error'}). Please try again or type your query.`;
    lastModelUsed = 'fallback/offline';
  }

  // 7. Persist final assistant response to SQLite
  saveMessage({
    id: crypto.randomUUID(),
    conversation_id: conversationId,
    sender: 'assistant',
    message: finalResponseText,
  });

  return {
    conversationId,
    response: finalResponseText,
    modelUsed: lastModelUsed,
    toolExecutions: executedToolsLog,
  };
}
