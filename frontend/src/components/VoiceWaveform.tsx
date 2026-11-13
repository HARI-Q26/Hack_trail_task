"use client";

export type VoiceState = "idle" | "listening" | "processing" | "speaking";

const STATE_CONFIG: Record<
  VoiceState,
  { label: string; badgeClass: string; barClass: string }
> = {
  idle: {
    label: "Ready",
    badgeClass: "bg-slate-100 text-slate-700 border-slate-200",
    barClass: "bg-slate-300 h-2",
  },
  listening: {
    label: "Listening...",
    badgeClass: "bg-red-50 text-red-700 border-red-200",
    barClass: "bg-red-500 animate-pulse",
  },
  processing: {
    label: "Thinking & checking tools...",
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200",
    barClass: "bg-amber-500 animate-pulse",
  },
  speaking: {
    label: "Speaking...",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    barClass: "bg-emerald-500 animate-pulse",
  },
};

export function VoiceWaveform({ state }: { state: VoiceState }) {
  const cfg = STATE_CONFIG[state];
  const heights =
    state === "listening"
      ? ["h-4", "h-7", "h-5", "h-8", "h-4"]
      : state === "speaking"
        ? ["h-5", "h-8", "h-6", "h-7", "h-4"]
        : state === "processing"
          ? ["h-3", "h-5", "h-3", "h-5", "h-3"]
          : ["h-2", "h-2", "h-2", "h-2", "h-2"];

  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 items-center gap-1" aria-hidden="true">
        {heights.map((h, i) => (
          <span
            key={i}
            className={`w-1.5 rounded-full transition-all duration-200 ${h} ${cfg.barClass}`}
          />
        ))}
      </div>
      <span className={`rounded-full border px-3 py-1 text-xs font-medium ${cfg.badgeClass}`}>
        {cfg.label}
      </span>
    </div>
  );
}

