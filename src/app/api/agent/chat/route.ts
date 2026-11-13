import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import { runAgentOrchestration } from '@/services/agent/orchestrator';

export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    const body = await req.json();
    const { message, conversationId } = body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json(
        { error: 'Message cannot be empty.' },
        { status: 400 }
      );
    }

    const output = await runAgentOrchestration({
      conversationId: conversationId || undefined,
      message: message.trim(),
      session,
    });

    return NextResponse.json({
      success: true,
      ...output,
      session: {
        role: session.role,
        displayName: session.displayName,
      },
    });
  } catch (err: any) {
    console.error('[Agent Chat API Route Error]:', err);
    return NextResponse.json(
      { error: err.message || 'Agent failed to process chat request.' },
      { status: 500 }
    );
  }
}
