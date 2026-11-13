import { NextRequest, NextResponse } from 'next/server';
import { transcribeAudioWithFallback } from '@/lib/groq';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get('file') as File | null;

    if (!audioFile) {
      return NextResponse.json(
        { error: 'No audio file provided in FormData (field name "file").' },
        { status: 400 }
      );
    }

    // Size limit check (25MB standard whisper limit)
    if (audioFile.size > 25 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'Audio file exceeds 25MB limit.' },
        { status: 413 }
      );
    }

    const collegePrompt =
      'Knotopian Institute of Technology, KIT, Attendance, On-duty, OD, Leave application, Examination, Internal Assessment, Placement, Admissions, Dr. Lakshmi, Arjun, CSE-2A';

    const result = await transcribeAudioWithFallback(audioFile, collegePrompt);

    return NextResponse.json({
      success: true,
      text: result.text,
      modelUsed: result.modelUsed,
    });
  } catch (err: any) {
    console.error('[Voice Transcription API Error]:', err);
    return NextResponse.json(
      { error: err.message || 'Speech-to-text transcription failed.' },
      { status: 500 }
    );
  }
}
