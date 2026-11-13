import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import { listUserConversations } from '@/lib/database';

export async function GET() {
  try {
    const session = await getCurrentSession();
    const conversations = listUserConversations(session.userId);
    return NextResponse.json({
      success: true,
      conversations,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to retrieve conversation history.' },
      { status: 500 }
    );
  }
}
