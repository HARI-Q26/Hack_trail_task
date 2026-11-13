"use client";

import { FormEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, UserRole } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Transcript, TranscriptEntry } from "@/components/Transcript";
import { VoiceState, VoiceWaveform } from "@/components/VoiceWaveform";

interface SpeechRecognitionAlternative {
  transcript: string;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  0: SpeechRecognitionAlternative;
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResult>;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

function PhoneCallIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function PhoneOffIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M16.5 16.5a16 16 0 0 1-8.5-8.5" />
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07" />
      <path d="M4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81" />
      <path d="M10.68 13.31a16 16 0 0 0 2.63 2.63" />
    </svg>
  );
}

function MicIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}

function MicOffIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}

function SpeakerIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function SpeakerOffIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="1" y1="1" x2="23" y2="23" />
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
}

const QUICK_PROMPTS: Record<UserRole, string[]> = {
  public: [
    "What courses are offered at Knotopian Institute of Technology?",
    "What are the admission eligibility requirements and fees?",
    "What is the college address and contact email?",
  ],
  student: [
    "What is my current attendance?",
    "Show my timetable for tomorrow.",
    "Can I apply for leave tomorrow?",
    "Are there any exams next week?",
  ],
  teacher: [
    "Show me all pending student requests.",
    "Show my teacher profile.",
    "What are the upcoming college holidays?",
  ],
};

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

export function VoiceAssistant() {
  const { user } = useAuth();
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [textInput, setTextInput] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [continuousMode, setContinuousMode] = useState(true);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [bargeInEnabled, setBargeInEnabled] = useState(false);

  // Phone Call Mode state
  const [isCallActive, setIsCallActive] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [isMicMuted, setIsMicMuted] = useState(false);

  // Fallback MediaRecorder state for Groq Whisper STT
  const [useWhisperStt, setUseWhisperStt] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const speechSupported = useSyncExternalStore(
    () => () => {},
    () => getSpeechRecognitionCtor() !== null,
    () => true
  );

  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const conversationActiveRef = useRef(false);
  const conversationIdRef = useRef<string | null>(null);
  const submitTurnRef = useRef<(messageText: string) => Promise<void>>(async () => {});
  const utteranceTokenRef = useRef(0);
  const recognitionTokenRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries, interimTranscript]);

  // Call timer effect
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isCallActive) {
      interval = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      setCallDuration(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isCallActive]);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  const cancelSpeechNow = useCallback(() => {
    utteranceTokenRef.current += 1;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    cancelSpeechNow();
    setVoiceState((prev) => (prev === "speaking" ? "idle" : prev));
  }, [cancelSpeechNow]);

  // Fallback Whisper MediaRecorder capture
  const startWhisperRecording = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setErrorMsg("Microphone access is not supported in this browser environment.");
      setVoiceState("idle");
      return;
    }
    cancelSpeechNow();
    setErrorMsg(null);
    setVoiceState("listening");
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        if (audioBlob.size > 1000) {
          setVoiceState("processing");
          try {
            const { text } = await api.transcribeVoice(audioBlob);
            if (text && text.trim()) {
              void submitTurnRef.current(text.trim());
            } else {
              setVoiceState("idle");
            }
          } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : "Whisper transcription failed.");
            setVoiceState("idle");
          }
        } else {
          setVoiceState("idle");
        }
      };

      recorder.start();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not access microphone.");
      setVoiceState("idle");
    }
  }, [cancelSpeechNow]);

  const stopWhisperRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const startListening = useCallback(() => {
    if (isMicMuted) return;

    if (useWhisperStt) {
      void startWhisperRecording();
      return;
    }

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      // Fallback to Groq Whisper
      setUseWhisperStt(true);
      void startWhisperRecording();
      return;
    }

    cancelSpeechNow();
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    recognitionTokenRef.current += 1;
    const myRecToken = recognitionTokenRef.current;
    recognitionRef.current?.abort();
    setErrorMsg(null);

    try {
      const recognition = new Ctor();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-IN";

      let finalText = "";

      recognition.onstart = () => {
        if (myRecToken !== recognitionTokenRef.current) return;
        setVoiceState("listening");
      };

      recognition.onresult = (event) => {
        if (myRecToken !== recognitionTokenRef.current) return;
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const piece = event.results[i][0]?.transcript || "";
          if (event.results[i].isFinal) {
            finalText += `${piece} `;
          } else {
            interim += piece;
          }
        }
        setInterimTranscript(interim.trim());
      };

      recognition.onerror = (event) => {
        if (myRecToken !== recognitionTokenRef.current) return;
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          setErrorMsg("Microphone permission denied. Please allow microphone access or use text input.");
          conversationActiveRef.current = false;
          setIsCallActive(false);
          setVoiceState("idle");
        } else if (event.error === "network") {
          // Automatic seamless switch to Groq Whisper STT on network error
          setUseWhisperStt(true);
          void startWhisperRecording();
        } else if (event.error !== "aborted" && event.error !== "no-speech") {
          setErrorMsg(`Speech recognition error: ${event.error}`);
          setVoiceState("idle");
        } else {
          setVoiceState("idle");
        }
      };

      recognition.onend = () => {
        if (myRecToken !== recognitionTokenRef.current) return;
        setInterimTranscript("");
        const spoken = finalText.trim();
        if (spoken) {
          void submitTurnRef.current(spoken);
        } else {
          setVoiceState("idle");
          // If in call and continuous mode, re-arm listening after a moment
          if (conversationActiveRef.current && continuousMode && isCallActive && !isMicMuted) {
            setTimeout(() => {
              if (conversationActiveRef.current && isCallActive && !isMicMuted) {
                startListening();
              }
            }, 600);
          }
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      // Fallback to Groq Whisper
      setUseWhisperStt(true);
      void startWhisperRecording();
    }
  }, [cancelSpeechNow, continuousMode, isCallActive, isMicMuted, startWhisperRecording, useWhisperStt]);

  const handleStopConversation = useCallback(() => {
    conversationActiveRef.current = false;
    setIsCallActive(false);
    recognitionTokenRef.current += 1;
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    stopWhisperRecording();
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    cancelSpeechNow();
    setInterimTranscript("");
    setVoiceState("idle");
  }, [cancelSpeechNow, stopWhisperRecording]);

  const handleInterruptAndSpeak = useCallback(() => {
    conversationActiveRef.current = true;
    startListening();
  }, [startListening]);

  // Global Escape key shortcut for immediate hangup/stop
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleStopConversation();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      handleStopConversation();
    };
  }, [handleStopConversation]);

  const speakResponse = useCallback(
    (text: string) => {
      if (!ttsEnabled || typeof window === "undefined" || !("speechSynthesis" in window)) {
        if (conversationActiveRef.current && continuousMode && !isMicMuted) {
          setTimeout(startListening, 300);
        } else {
          setVoiceState("idle");
        }
        return;
      }

      try {
        cancelSpeechNow();
        const myToken = utteranceTokenRef.current;

        const plainForSpeech = text
          .replace(/```[\s\S]*?```/g, " ")
          .replace(/\|/g, " ")
          .replace(/[*_`#]/g, "")
          .replace(/\s+/g, " ")
          .trim();

        const utterance = new SpeechSynthesisUtterance(plainForSpeech || text);
        utterance.lang = "en-IN";
        utterance.rate = 1.0;

        utterance.onstart = () => {
          if (myToken !== utteranceTokenRef.current) return;
          setVoiceState("speaking");
        };
        utterance.onend = () => {
          if (myToken !== utteranceTokenRef.current) return;
          if (conversationActiveRef.current && continuousMode && !isMicMuted) {
            startListening();
          } else {
            setVoiceState("idle");
          }
        };
        utterance.onerror = (event) => {
          if (myToken !== utteranceTokenRef.current) return;
          const errCode = (event as SpeechSynthesisErrorEvent).error;
          if (errCode === "interrupted" || errCode === "canceled") {
            setVoiceState("idle");
            return;
          }
          setVoiceState("idle");
        };

        window.speechSynthesis.speak(utterance);
      } catch {
        setVoiceState("idle");
      }
    },
    [cancelSpeechNow, continuousMode, isMicMuted, startListening, ttsEnabled]
  );

  const submitTurn = useCallback(
    async (messageText: string) => {
      const trimmed = messageText.trim();
      if (!trimmed) return;

      cancelSpeechNow();
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setErrorMsg(null);
      setVoiceState("processing");
      setEntries((prev) => [
        ...prev,
        { id: `u-${Date.now()}`, role: "user", content: trimmed },
      ]);

      try {
        const res = await api.chat(
          {
            message: trimmed,
            conversation_id: conversationIdRef.current,
          },
          controller.signal
        );
        if (controller.signal.aborted) return;

        setConversationId(res.conversation_id);
        setEntries((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            content: res.reply,
            toolsUsed: res.tools_used,
            fallbackUsed: res.fallback_used,
            pendingConfirmation: res.pending_confirmation,
          },
        ]);
        speakResponse(res.reply);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          setVoiceState("idle");
          return;
        }
        setErrorMsg(err instanceof Error ? err.message : "Failed to reach assistant backend.");
        setVoiceState("idle");
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [cancelSpeechNow, speakResponse]
  );

  useEffect(() => {
    submitTurnRef.current = submitTurn;
  }, [submitTurn]);

  // Phone Call Handlers
  function handleStartPhoneCall() {
    setIsCallActive(true);
    conversationActiveRef.current = true;
    setErrorMsg(null);

    // Initial greeting based on role
    let greeting = "Hello! Welcome to Knotopian Institute of Technology. I am your campus voice assistant. How can I help you today?";
    if (user.role === "student") {
      greeting = `Hello ${user.display_name}! I am your KIT assistant. How can I assist you with your attendance, timetable, or leave requests?`;
    } else if (user.role === "teacher") {
      greeting = `Hello Professor ${user.display_name}! How can I help you with pending student requests and schedules today?`;
    }

    setEntries((prev) => [
      ...prev,
      {
        id: `call-welcome-${Date.now()}`,
        role: "assistant",
        content: greeting,
      },
    ]);
    speakResponse(greeting);
  }

  function handleEndPhoneCall() {
    handleStopConversation();
  }

  function toggleMicMute() {
    if (isMicMuted) {
      setIsMicMuted(false);
      if (conversationActiveRef.current) {
        startListening();
      }
    } else {
      setIsMicMuted(true);
      if (voiceState === "listening") {
        if (useWhisperStt) {
          stopWhisperRecording();
        } else {
          recognitionRef.current?.stop();
        }
        setVoiceState("idle");
      }
    }
  }

  function handleTextSubmit(e: FormEvent) {
    e.preventDefault();
    if (!textInput.trim() || voiceState === "processing") return;
    const msg = textInput;
    setTextInput("");
    void submitTurn(msg);
  }

  function formatDuration(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      {/* Phone Call Section */}
      {isCallActive ? (
        <div className="rounded-2xl border-2 border-emerald-500 bg-slate-950 p-6 text-white shadow-xl">
          <div className="flex flex-col items-center text-center">
            <div className="relative mb-3">
              <div
                className={`flex h-20 w-20 items-center justify-center rounded-full transition-all ${
                  voiceState === "speaking"
                    ? "bg-emerald-500/30 ring-8 ring-emerald-500/40 animate-pulse"
                    : voiceState === "listening"
                    ? "bg-rose-500/30 ring-8 ring-rose-500/40 animate-pulse"
                    : "bg-blue-500/20 ring-4 ring-blue-500/30"
                }`}
              >
                <PhoneCallIcon className="h-10 w-10 text-emerald-400" />
              </div>
              <span className="absolute bottom-0 right-0 h-4 w-4 rounded-full border-2 border-slate-950 bg-emerald-500 ring-2 ring-emerald-400" />
            </div>

            <h2 className="text-xl font-bold tracking-tight text-white">
              Knotopian Voice Assistant (KIT)
            </h2>
            <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-slate-400">
              {user.role === "public"
                ? "Admissions & Campus Enquiries"
                : user.role === "student"
                ? `Student Support (${user.display_name})`
                : `Faculty Support (${user.display_name})`}
            </p>

            {/* In-Call Status & Duration */}
            <div className="mt-3 flex items-center gap-2 rounded-full border border-emerald-800/60 bg-emerald-950/80 px-4 py-1 font-mono text-xs font-semibold text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
              <span>LIVE CALL · {formatDuration(callDuration)}</span>
            </div>

            {/* Waveform and Live Speech Status */}
            <div className="mt-4 flex flex-col items-center gap-2">
              <VoiceWaveform state={voiceState} />
              {interimTranscript && (
                <p className="mt-1 max-w-md rounded-lg border border-slate-800 bg-slate-900/90 px-3 py-1.5 text-xs italic text-slate-200">
                  &ldquo;{interimTranscript}&rdquo;
                </p>
              )}
            </div>

            {/* Call Action Buttons */}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
              <button
                type="button"
                onClick={toggleMicMute}
                className={`flex h-12 w-12 items-center justify-center rounded-full transition-all ${
                  isMicMuted
                    ? "bg-amber-600 text-white shadow-md shadow-amber-600/30"
                    : "bg-slate-800 text-slate-200 hover:bg-slate-700"
                }`}
                title={isMicMuted ? "Unmute Microphone" : "Mute Microphone"}
                aria-label={isMicMuted ? "Unmute Microphone" : "Mute Microphone"}
              >
                {isMicMuted ? <MicOffIcon className="h-6 w-6" /> : <MicIcon className="h-6 w-6" />}
              </button>

              <button
                type="button"
                onClick={handleEndPhoneCall}
                className="flex items-center gap-2 rounded-full bg-rose-600 px-7 py-3 text-sm font-bold text-white shadow-lg shadow-rose-600/40 transition-all hover:bg-rose-700 active:scale-95"
              >
                <PhoneOffIcon className="h-5 w-5" />
                <span>End Call</span>
              </button>

              <button
                type="button"
                onClick={() => setTtsEnabled(!ttsEnabled)}
                className={`flex h-12 w-12 items-center justify-center rounded-full transition-all ${
                  !ttsEnabled
                    ? "bg-amber-600 text-white shadow-md shadow-amber-600/30"
                    : "bg-slate-800 text-slate-200 hover:bg-slate-700"
                }`}
                title={ttsEnabled ? "Speaker Output Enabled" : "Speaker Output Muted"}
                aria-label={ttsEnabled ? "Speaker Output Enabled" : "Speaker Output Muted"}
              >
                {ttsEnabled ? <SpeakerIcon className="h-6 w-6" /> : <SpeakerOffIcon className="h-6 w-6" />}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border-2 border-emerald-500/20 bg-linear-to-b from-emerald-500/5 to-transparent p-5 shadow-xs">
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md shadow-emerald-500/30">
                <PhoneCallIcon className="h-7 w-7" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-slate-900">
                    Knotopian Phone Call Assistant
                  </h2>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                    Live Real-Time Voice
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  Talk to the campus assistant like a phone call. It speaks answers and automatically listens for follow-ups.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleStartPhoneCall}
              className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-md shadow-emerald-600/30 transition-all hover:bg-emerald-700 active:scale-95"
            >
              <PhoneCallIcon className="h-5 w-5" />
              <span>Start Phone Call</span>
            </button>
          </div>
        </div>
      )}

      {/* Voice Assistant Controls & Prompts Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              Campus Voice Assistant
            </h1>
            <p className="text-xs text-slate-500">
              Active mode:{" "}
              <span className="font-semibold capitalize text-slate-700">{user.role}</span>{" "}
              · Press <kbd className="rounded border border-slate-300 bg-slate-100 px-1 py-0.5 text-[10px]">Esc</kbd> anytime to stop
            </p>
          </div>
          <VoiceWaveform state={voiceState} />
        </div>

        {!speechSupported && !useWhisperStt && (
          <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
            Microphone input enabled via Groq Whisper STT (whisper-large-v3-turbo). You can also use full text chat below.
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800"
          >
            {errorMsg}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          {voiceState === "speaking" ? (
            <>
              <button
                type="button"
                onClick={handleInterruptAndSpeak}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Interrupt & Speak
              </button>
              <button
                type="button"
                onClick={stopSpeaking}
                className="rounded-lg border border-rose-300 bg-rose-50 px-3.5 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"
              >
                Stop Speaking
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={startListening}
              disabled={voiceState === "listening" || voiceState === "processing"}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {voiceState === "listening" ? "Listening..." : "Push to Talk"}
            </button>
          )}

          <button
            type="button"
            onClick={handleStopConversation}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Stop
          </button>

          <div className="ml-auto flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={continuousMode}
                onChange={(e) => setContinuousMode(e.target.checked)}
                className="rounded border-slate-300"
              />
              Auto-listen
            </label>

            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={ttsEnabled}
                onChange={(e) => {
                  const next = e.target.checked;
                  setTtsEnabled(next);
                  if (!next) stopSpeaking();
                }}
                className="rounded border-slate-300"
              />
              Voice output
            </label>
          </div>
        </div>

        {/* Suggested Queries */}
        <div className="mt-4 flex flex-wrap gap-2">
          {QUICK_PROMPTS[user.role].map((prompt) => (
            <button
              key={prompt}
              type="button"
              disabled={voiceState === "processing"}
              onClick={() => void submitTurn(prompt)}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      {/* Transcript Log */}
      <div className="min-h-[320px] rounded-2xl border border-slate-200/90 bg-slate-50/60 p-5 shadow-2xs">
        <Transcript
          entries={entries}
          interimTranscript={interimTranscript}
          onConfirmAction={(text) => void submitTurn(text)}
          disabled={voiceState === "processing"}
        />
        <div ref={transcriptEndRef} />
      </div>

      {/* Message Input Fallback Bar */}
      <form onSubmit={handleTextSubmit} className="flex gap-2">
        <input
          type="text"
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          placeholder="Type a message (fallback or alongside voice)..."
          aria-label="Message input"
          className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={
            voiceState === "listening"
              ? handleStopConversation
              : voiceState === "speaking"
              ? handleInterruptAndSpeak
              : startListening
          }
          disabled={voiceState === "processing"}
          title={
            voiceState === "listening"
              ? "Listening... Click to stop"
              : voiceState === "speaking"
              ? "Speaking... Click to interrupt"
              : "Click to speak with microphone"
          }
          aria-label={voiceState === "listening" ? "Stop listening" : "Start speaking"}
          className={`flex items-center justify-center rounded-lg px-3.5 py-2.5 transition-colors disabled:opacity-50 ${
            voiceState === "listening"
              ? "bg-rose-600 text-white animate-pulse hover:bg-rose-700 shadow-sm"
              : voiceState === "speaking"
              ? "bg-amber-600 text-white hover:bg-amber-700 shadow-sm"
              : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 shadow-xs"
          }`}
        >
          <MicIcon className="h-5 w-5" />
        </button>
        <button
          type="submit"
          disabled={!textInput.trim() || voiceState === "processing"}
          className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
