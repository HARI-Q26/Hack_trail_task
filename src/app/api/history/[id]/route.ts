import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import {
  getConversationById,
  getConversationMessages,
  getConversationToolExecutions,
} from '@/lib/database';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getCurrentSession();

    // Verify ownership - prevent cross-user data access
    const conversation = getConversationById(id, session.userId);
    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found or access denied.' },
        { status: 404 }
      );
    }

    const messages = getConversationMessages(id);
    const toolExecutions = getConversationToolExecutions(id);

    return NextResponse.json({
      success: true,
      conversation,
      messages,
      toolExecutions,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to retrieve conversation details.' },
      { status: 500 }
    );
  }
}
