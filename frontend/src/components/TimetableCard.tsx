"use client";

export interface TimetableSlot {
  id?: number;
  weekday: number;
  period: number;
  start_time: string;
  end_time: string;
  subject_code: string;
  subject_name: string;
}

export interface TimetableToolData {
  requested_day?: string;
  resolved_date?: string | null;
  effective_weekday?: number | null;
  note?: string;
  is_holiday?: boolean;
  holiday?: { title?: string; date?: string };
  college_today?: string | null;
  slots?: TimetableSlot[];
  weekly_slots?: TimetableSlot[];
}

const WEEKDAY_NAMES: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

export function TimetableCard({ data }: { data: TimetableToolData }) {
  if (data.is_holiday) {
    return (
      <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900">
        <p className="font-semibold">
          Holiday — {data.holiday?.title || "College Holiday"} ({data.holiday?.date || data.resolved_date || ""})
        </p>
        <p className="mt-0.5 text-amber-800">No regular classes scheduled.</p>
      </div>
    );
  }

  const daySlots = Array.isArray(data.slots) ? [...data.slots] : [];
  const weeklySlots = Array.isArray(data.weekly_slots) ? [...data.weekly_slots] : [];

  if (daySlots.length > 0) {
    daySlots.sort((a, b) => a.period - b.period);
    const weekdayLabel = data.effective_weekday
      ? WEEKDAY_NAMES[data.effective_weekday] || `Day ${data.effective_weekday}`
      : data.requested_day || "Schedule";

    return (
      <div className="mt-2.5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-900 px-3.5 py-2.5 text-white">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold tracking-wide uppercase">
              Class Timetable · {weekdayLabel}
            </span>
            {data.resolved_date && (
              <span className="rounded bg-white/15 px-2 py-0.5 text-[11px] font-medium text-slate-100">
                {data.resolved_date}
              </span>
            )}
          </div>
          <span className="text-[11px] text-slate-300">{daySlots.length} periods</span>
        </div>

        {data.note && (
          <div className="border-b border-amber-200 bg-amber-50 px-3.5 py-1.5 text-[11px] font-medium text-amber-900">
            {data.note}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3.5 py-2">Period</th>
                <th className="px-3.5 py-2">Time</th>
                <th className="px-3.5 py-2">Code</th>
                <th className="px-3.5 py-2">Subject</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {daySlots.map((slot, idx) => (
                <tr key={`${slot.period}-${idx}`} className="hover:bg-slate-50">
                  <td className="px-3.5 py-2 font-semibold text-slate-900 whitespace-nowrap">
                    Period {slot.period}
                  </td>
                  <td className="px-3.5 py-2 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                    {slot.start_time} – {slot.end_time}
                  </td>
                  <td className="px-3.5 py-2 whitespace-nowrap">
                    <span className="rounded bg-blue-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-blue-700">
                      {slot.subject_code}
                    </span>
                  </td>
                  <td className="px-3.5 py-2 font-medium text-slate-800">{slot.subject_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (weeklySlots.length > 0) {
    const periods = Array.from(new Set(weeklySlots.map((s) => s.period))).sort((a, b) => a - b);
    const weekdays = Array.from(new Set(weeklySlots.map((s) => s.weekday))).sort((a, b) => a - b);
    const periodTimes = new Map<number, string>();
    const cellMap = new Map<string, TimetableSlot>();
    for (const s of weeklySlots) {
      if (!periodTimes.has(s.period)) {
        periodTimes.set(s.period, `${s.start_time}–${s.end_time}`);
      }
      cellMap.set(`${s.weekday}-${s.period}`, s);
    }

    return (
      <div className="mt-2.5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-900 px-3.5 py-2.5 text-white">
          <span className="text-xs font-semibold tracking-wide uppercase">
            Weekly Class Timetable
          </span>
          {data.college_today && (
            <span className="rounded bg-white/15 px-2 py-0.5 text-[11px] text-slate-100">
              Today: {data.college_today}
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2 whitespace-nowrap">Day</th>
                {periods.map((p) => (
                  <th key={p} className="px-3 py-2 whitespace-nowrap">
                    <div>P{p}</div>
                    <div className="font-mono text-[10px] font-normal text-slate-400">
                      {periodTimes.get(p)}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {weekdays.map((wd) => (
                <tr key={wd} className="hover:bg-slate-50">
                  <td className="px-3 py-2.5 font-semibold text-slate-900 whitespace-nowrap">
                    {WEEKDAY_NAMES[wd] || `Day ${wd}`}
                  </td>
                  {periods.map((p) => {
                    const slot = cellMap.get(`${wd}-${p}`);
                    return (
                      <td key={p} className="px-3 py-2 align-top">
                        {slot ? (
                          <div className="min-w-[110px]">
                            <span className="inline-block rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-blue-700">
                              {slot.subject_code}
                            </span>
                            <p className="mt-0.5 text-[11px] leading-snug text-slate-700">
                              {slot.subject_name}
                            </p>
                          </div>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return null;
}

