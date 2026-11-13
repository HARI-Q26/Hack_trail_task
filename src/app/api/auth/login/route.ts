import { NextRequest, NextResponse } from 'next/server';
import { getCollegeAPIClient, CollegeAPIAuthError, CollegeAPIUnavailableError } from '@/lib/college-api';
import { createAuthenticatedSession, sanitizeData } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { login_id, password } = body;

    if (!login_id || !password) {
      return NextResponse.json(
        { error: 'Both login_id and password are required.' },
        { status: 400 }
      );
    }

    const client = getCollegeAPIClient();
    const loginResult = await client.login(String(login_id).trim(), String(password));

    // Store in SQLite sessions & set secure HTTP-only cookie
    const sessionId = await createAuthenticatedSession(
      loginResult.user,
      loginResult.access_token,
      loginResult.expires_in || 28800
    );

    return NextResponse.json({
      success: true,
      sessionId,
      user: sanitizeData(loginResult.user),
    });
  } catch (err: any) {
    if (err instanceof CollegeAPIAuthError) {
      return NextResponse.json(
        { error: 'Invalid login ID or password. Please verify your college credentials.' },
        { status: 401 }
      );
    }
    if (err instanceof CollegeAPIUnavailableError) {
      return NextResponse.json(
        { error: 'The KIT College System is currently unreachable. Please try again shortly.' },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: err.message || 'An unexpected error occurred during login.' },
      { status: 500 }
    );
  }
}
