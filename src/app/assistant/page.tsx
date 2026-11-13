'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  modelUsed?: string;
  toolExecutions?: Array<{
    toolName: string;
    success: boolean;
    summary: string;
    data?: any;
    actionRequired?: string;
  }>;
  pendingAction?: {
    type: string;
    description: string;
    payload: any;
  };
  timestamp: string;
}

export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);

  // States: idle, recording, transcribing, thinking, speaking
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechMuted, setSpeechMuted] = useState(false);

  const [session, setSession] = useState<{
    userId: string;
    role: 'public' | 'student' | 'teacher';
    displayName: string;
    isAuthenticated: boolean;
  }>({
    userId: 'visitor',
    role: 'public',
    displayName: 'Prospective Student / Visitor',
    isAuthenticated: false,
  });

  const [micError, setMicError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Load session & initial welcome message
  useEffect(() => {
    fetch('/api/auth/session')
      .then((res) => res.json())
      .then((data) => {
        if (data.session) {
          setSession(data.session);

          // Add role-specific welcome message
          let welcome = 'Welcome to Knotopian Institute of Technology (KIT). How can I assist you with admissions, course eligibility, or college policies today?';
          if (data.session.role === 'student') {
            welcome = `Hello ${data.session.displayName}! I am your KIT Student Assistant. You can ask for your real-time attendance, class timetable, upcoming internal exams, or submit a leave or on-duty request.`;
          } else if (data.session.role === 'teacher') {
            welcome = `Welcome Dr./Prof. ${data.session.displayName}. You are logged in as Class Advisor. You can ask to review pending student leave requests or check class attendance.`;
          }

          setMessages([
            {
              id: 'welcome',
              sender: 'assistant',
              text: welcome,
              modelUsed: 'openai/gpt-oss-120b',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
          ]);
        }
      })
      .catch((err) => console.error(err));

    // Check for query param in URL (e.g. ?q=What courses...)
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const query = urlParams.get('q');
      const convParam = urlParams.get('convId');

      if (convParam) {
        setConversationId(convParam);
        fetch(`/api/history/${convParam}`)
          .then((res) => res.json())
          .then((d) => {
            if (d.success && d.messages) {
              setMessages(
                d.messages.map((m: any) => ({
                  id: m.id,
                  sender: m.sender,
                  text: m.message,
                  timestamp: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                }))
              );
            }
          });
      } else if (query) {
        setTimeout(() => handleSendMessage(query), 500);
      }
    }
  }, []);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, isThinking, isTranscribing, isSpeaking]);

  // Voice Playback using SpeechSynthesis
  function speakText(text: string) {
    if (speechMuted) return;
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    window.speechSynthesis.cancel(); // Stop any active speech

    // Clean text for clean spoken pronunciation (remove markdown asterisks, hashes)
    const cleanSpoken = text.replace(/[*#_`]/g, '').replace(/https?:\/\/\S+/g, 'the website link');

    const utterance = new SpeechSynthesisUtterance(cleanSpoken);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    // Pick a natural English voice
    const voices = window.speechSynthesis.getVoices();
    const naturalVoice =
      voices.find((v) => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha'))) ||
      voices.find((v) => v.lang.startsWith('en')) ||
      voices[0];

    if (naturalVoice) {
      utterance.voice = naturalVoice;
    }

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  }

  function stopSpeaking() {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  }

  // Voice Recording using MediaRecorder
  async function startRecording() {
    setMicError(null);
    stopSpeaking();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMicError('Audio recording is not supported in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4';

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        // Stop audio tracks
        stream.getTracks().forEach((track) => track.stop());
        await processAudioTranscription(audioBlob);
      };

      mediaRecorder.start(250);
      setIsRecording(true);
    } catch (err: any) {
      console.error('Microphone access denied:', err);
      setMicError('Microphone permission was denied. Please allow microphone access or use text input.');
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }

  // Upload Audio to Groq Whisper STT API
  async function processAudioTranscription(audioBlob: Blob) {
    setIsTranscribing(true);
    try {
      const formData = new FormData();
      formData.append('file', audioBlob, 'audio.webm');

      const res = await fetch('/api/voice/transcribe', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to transcribe audio.');
      }

      if (data.text && data.text.trim()) {
        await handleSendMessage(data.text.trim());
      } else {
        setMicError('No speech was detected. Please try speaking closer to the microphone.');
      }
    } catch (err: any) {
      console.error(err);
      setMicError(err.message || 'Speech recognition failed.');
    } finally {
      setIsTranscribing(false);
    }
  }

  // Send Message to Central Groq Agent Orchestrator
  async function handleSendMessage(textToSend?: string) {
    const text = (textToSend || inputText).trim();
    if (!text || isThinking) return;

    setInputText('');
    stopSpeaking();

    const userMessage: Message = {
      id: crypto.randomUUID(),
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsThinking(true);

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversationId: conversationId || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Agent execution failed');
      }

      if (data.conversationId) {
        setConversationId(data.conversationId);
      }

      // Check if any tool execution requires confirmation
      let pendingAction = undefined;
      const confirmItem = data.toolExecutions?.find((t: any) => t.actionRequired === 'confirmation');
      if (confirmItem) {
        pendingAction = {
          type: confirmItem.toolName,
          description: confirmItem.summary,
          payload: confirmItem.data,
        };
      }

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        sender: 'assistant',
        text: data.response,
        modelUsed: data.modelUsed,
        toolExecutions: data.toolExecutions,
        pendingAction,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // Speak response aloud
      speakText(data.response);
    } catch (err: any) {
      console.error(err);
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        sender: 'assistant',
        text: `Error: ${err.message || 'Failed to connect to assistant.'}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsThinking(false);
    }
  }

  // Handle Action Confirmation (e.g. Leave, OD, Approve, Reject, Admission)
  async function handleConfirmAction(action: any) {
    const confirmPrompt = `Yes, please confirm and submit the ${action.type.replace(/_/g, ' ')}.`;
    await handleSendMessage(confirmPrompt);
  }

  function handleCancelAction() {
    handleSendMessage('Please cancel this request.');
  }

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-4rem)] max-w-6xl mx-auto w-full p-2 sm:p-4">
      {/* Role & System Status Banner */}
      <div className="bg-white rounded-xl border border-slate-200 px-4 py-2.5 mb-3 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#0E625E] text-white flex items-center justify-center font-bold text-sm">
            KIT
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-slate-800">
                KIT Voice Assistant
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  session.role === 'student'
                    ? 'bg-emerald-100 text-emerald-800'
                    : session.role === 'teacher'
                    ? 'bg-purple-100 text-purple-800'
                    : 'bg-blue-100 text-blue-800'
                }`}
              >
                {session.role}
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              User: <span className="font-semibold">{session.displayName}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isSpeaking && (
            <button
              onClick={stopSpeaking}
              className="px-2.5 py-1 rounded-md bg-amber-100 hover:bg-amber-200 text-amber-800 text-xs font-semibold flex items-center gap-1.5 transition-colors animate-pulse"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
              <span>Stop Speaking</span>
            </button>
          )}

          <button
            onClick={() => setSpeechMuted(!speechMuted)}
            className={`p-2 rounded-lg border text-xs font-medium transition-colors ${
              speechMuted
                ? 'bg-rose-50 border-rose-200 text-rose-700'
                : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
            }`}
            title={speechMuted ? 'Unmute voice output' : 'Mute voice output'}
          >
            {speechMuted ? '🔇 Muted' : '🔊 Voice Output On'}
          </button>

          {!session.isAuthenticated ? (
            <Link
              href="/login"
              className="px-3 py-1.5 rounded-lg bg-[#0E625E] hover:bg-[#094340] text-white text-xs font-semibold"
            >
              Portal Login
            </Link>
          ) : (
            <Link
              href="/login"
              className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-semibold"
            >
              Account
            </Link>
          )}
        </div>
      </div>

      {/* Mic Warning Banner */}
      {micError && (
        <div className="mb-2 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between">
          <span>{micError}</span>
          <button onClick={() => setMicError(null)} className="font-bold ml-2">✕</button>
        </div>
      )}

      {/* Transcript Chat Area */}
      <div
        ref={chatScrollRef}
        className="flex-1 bg-white rounded-2xl border border-slate-200 p-4 sm:p-6 overflow-y-auto space-y-4 shadow-sm"
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${
              msg.sender === 'user' ? 'items-end' : 'items-start'
            }`}
          >
            <div
              className={`max-w-[85%] rounded-2xl p-4 text-sm leading-relaxed ${
                msg.sender === 'user'
                  ? 'bg-[#0E625E] text-white rounded-br-xs shadow-sm'
                  : 'bg-[#F2F7F8] text-slate-800 rounded-bl-xs border border-slate-200 shadow-xs'
              }`}
            >
              <div className="flex items-center justify-between gap-4 mb-1">
                <span className="text-[10px] uppercase font-bold tracking-wider opacity-75">
                  {msg.sender === 'user' ? (session.displayName || 'You') : 'KIT Assistant'}
                </span>
                {msg.modelUsed && (
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-teal-800/20 text-[#0E625E] font-mono">
                    {msg.modelUsed}
                  </span>
                )}
              </div>

              <div className="whitespace-pre-wrap">{msg.text}</div>

              {/* Tool Execution Chips */}
              {msg.toolExecutions && msg.toolExecutions.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-200/60 space-y-1.5">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    College Action:
                  </div>
                  {msg.toolExecutions.map((t, idx) => (
                    <div
                      key={idx}
                      className="p-2 rounded bg-white/80 border border-slate-200 text-xs flex items-start justify-between gap-2"
                    >
                      <div>
                        <span className="font-mono font-semibold text-slate-700">{t.toolName}</span>
                        <p className="text-slate-600 text-[11px] mt-0.5">{t.summary}</p>
                      </div>
                      <span
                        className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                          t.success ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {t.success ? 'Executed' : 'Failed'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Confirmation Card for Write Operations */}
              {msg.pendingAction && (
                <div className="mt-3 p-3.5 rounded-xl bg-orange-50 border-2 border-[#F47F20]/50 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#D66710]">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span>Explicit Confirmation Required</span>
                  </div>
                  <p className="text-xs text-slate-700">{msg.pendingAction.description}</p>
                  <div className="pt-2 flex gap-2">
                    <button
                      onClick={() => handleConfirmAction(msg.pendingAction)}
                      className="px-4 py-2 rounded-lg bg-[#F47F20] hover:bg-[#D66710] text-white text-xs font-bold shadow-sm transition-all"
                    >
                      Confirm & Submit
                    </button>
                    <button
                      onClick={handleCancelAction}
                      className="px-3 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
            <span className="text-[10px] text-slate-400 mt-1 px-1">
              {msg.timestamp}
            </span>
          </div>
        ))}

        {/* Live Processing States */}
        {isTranscribing && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-teal-50 text-teal-800 text-xs font-medium w-fit animate-pulse">
            <span className="w-2 h-2 rounded-full bg-teal-600 animate-ping"></span>
            Transcribing speech with Groq Whisper-large-v3-turbo...
          </div>
        )}

        {isThinking && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-100 text-slate-700 text-xs font-medium w-fit animate-pulse">
            <span className="w-2 h-2 rounded-full bg-[#0E625E] animate-ping"></span>
            KIT Agent is consulting college records via Groq openai/gpt-oss-120b...
          </div>
        )}

        {isSpeaking && (
          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-50 text-amber-800 text-xs font-semibold w-fit border border-amber-200">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>
            <span>Speaking response...</span>
          </div>
        )}
      </div>

      {/* Role-tailored Quick Suggestion Chips */}
      <div className="my-2.5 flex items-center gap-2 overflow-x-auto py-1 text-xs">
        <span className="text-slate-400 font-semibold whitespace-nowrap text-[11px]">
          Quick Questions:
        </span>
        {session.role === 'student' && (
          <>
            <button
              onClick={() => handleSendMessage('What is my current attendance?')}
              className="px-3 py-1.5 rounded-full bg-white hover:bg-teal-50 text-[#0E625E] border border-slate-200 whitespace-nowrap font-medium transition-colors"
            >
              📊 Check Attendance
            </button>
            <button
              onClick={() => handleSendMessage('I need leave tomorrow for personal work')}
              className="px-3 py-1.5 rounded-full bg-white hover:bg-teal-50 text-[#0E625E] border border-slate-200 whitespace-nowrap font-medium transition-colors"
            >
              📝 Apply for Leave Tomorrow
            </button>
            <button
              onClick={() => handleSendMessage('What is my timetable?')}
              className="px-3 py-1.5 rounded-full bg-white hover:bg-teal-50 text-[#0E625E] border border-slate-200 whitespace-nowrap font-medium transition-colors"
            >
              📅 View Timetable
            </button>
            <button
              onClick={() => handleSendMessage('When are the upcoming examinations?')}
              className="px-3 py-1.5 rounded-full bg-white hover:bg-teal-50 text-[#0E625E] border border-slate-200 whitespace-nowrap font-medium transition-colors"
            >
              🎯 Check Exam Dates
            </button>
          </>
        )}

        {session.role === 'teacher' && (
          <>
            <button
              onClick={() => handleSendMessage('Show my pending student leave requests')}
              className="px-3 py-1.5 rounded-full bg-white hover:bg-purple-50 text-purple-800 border border-slate-200 whitespace-nowrap font-medium transition-colors"
            >
              📋 Pending Student Requests
            </button>
            <button
              onClick={() => handleSendMessage('Show class CSE-2A attendance roster')}
              className="px-3 py-1.5 rounded-full bg-white hover:bg-purple-50 text-purple-800 border border-slate-200 whitespace-nowrap font-medium transition-colors"
            >
              👥 Class CSE-2A Attendance
            </button>
          </>
        )}

        {session.role === 'public' && (
          <>
            <button
              onClick={() => handleSendMessage('What courses are offered at KIT and what are the fees?')}
              className="px-3 py-1.5 rounded-full bg-white hover:bg-blue-50 text-[#0E625E] border border-slate-200 whitespace-nowrap font-medium transition-colors"
            >
              🎓 Courses & Fees
            </button>
            <button
              onClick={() => handleSendMessage('I got 82 percent in 12th standard. Am I eligible for Computer Science?')}
              className="px-3 py-1.5 rounded-full bg-white hover:bg-blue-50 text-[#0E625E] border border-slate-200 whitespace-nowrap font-medium transition-colors"
            >
              ✨ Check My Eligibility
            </button>
            <button
              onClick={() => handleSendMessage('What are the college rules regarding minimum attendance?')}
              className="px-3 py-1.5 rounded-full bg-white hover:bg-blue-50 text-[#0E625E] border border-slate-200 whitespace-nowrap font-medium transition-colors"
            >
              📖 Attendance Policy Rules
            </button>
          </>
        )}
      </div>

      {/* Voice & Text Input Controls */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex items-center gap-2"
        >
          {/* Push-to-Talk / Click Microphone Button */}
          <button
            type="button"
            onClick={isRecording ? stopRecording : startRecording}
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all shadow-md shrink-0 ${
              isRecording
                ? 'bg-rose-500 hover:bg-rose-600 text-white animate-pulse-ring'
                : 'bg-[#F47F20] hover:bg-[#D66710] text-white hover:scale-105'
            }`}
            title={isRecording ? 'Click to Stop Recording' : 'Click to Speak (Push-to-Talk)'}
          >
            {isRecording ? (
              <svg className="w-6 h-6 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 100-6 3 3 0 000 6z" />
              </svg>
            )}
          </button>

          {/* Text Input Fallback */}
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={
              isRecording
                ? 'Listening to your microphone... Click square button to finish.'
                : 'Speak or type your message here...'
            }
            disabled={isRecording}
            className="flex-1 px-4 py-3 rounded-xl border border-slate-200 focus:border-[#0E625E] focus:ring-1 focus:ring-[#0E625E] outline-none text-sm transition-all text-slate-800 disabled:bg-slate-50"
          />

          {/* Send Button */}
          <button
            type="submit"
            disabled={!inputText.trim() || isThinking || isRecording}
            className="w-12 h-12 rounded-xl bg-[#0E625E] hover:bg-[#094340] text-white flex items-center justify-center transition-all disabled:opacity-40 shrink-0 shadow-sm"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
