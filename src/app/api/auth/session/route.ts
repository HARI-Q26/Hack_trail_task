import { NextResponse } from 'next/server';
import { getCurrentSession, sanitizeData } from '@/lib/auth';

export async function GET() {
  const session = await getCurrentSession();
  return NextResponse.json({
    session: sanitizeData({
      userId: session.userId,
      role: session.role,
      displayName: session.displayName,
      isAuthenticated: session.isAuthenticated,
    }),
  });
}
