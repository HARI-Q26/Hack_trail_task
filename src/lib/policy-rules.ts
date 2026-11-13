import { getCollegeAPIClient } from './college-api';

export interface DateResolutionResult {
  resolvedDate: string; // YYYY-MM-DD
  todayDate: string;
  weekdayName: string;
}

/**
 * Resolve relative date keywords ("today", "tomorrow", "day after tomorrow", "next monday")
 * against the authoritative College API current date (/v1/today).
 */
export async function resolveCollegeDate(inputDateStr: string): Promise<DateResolutionResult> {
  const client = getCollegeAPIClient();
  let todayInfo;
  try {
    todayInfo = await client.getToday();
  } catch {
    // Fallback to system date in Asia/Kolkata if API temporarily offline
    const now = new Date();
    const istStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    todayInfo = {
      date: istStr,
      weekday: now.getDay() || 7,
      weekday_name: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()],
      timezone: 'Asia/Kolkata',
    };
  }

  const baseDate = new Date(todayInfo.date + 'T00:00:00Z');
  const lower = inputDateStr.toLowerCase().trim();

  let targetDate = new Date(baseDate);

  if (lower === 'today') {
    // targetDate is today
  } else if (lower === 'tomorrow') {
    targetDate.setUTCDate(targetDate.getUTCDate() + 1);
  } else if (lower === 'day after tomorrow') {
    targetDate.setUTCDate(targetDate.getUTCDate() + 2);
  } else if (lower.startsWith('next ')) {
    const dayName = lower.replace('next ', '').trim();
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetIdx = days.indexOf(dayName);
    if (targetIdx !== -1) {
      const currentDay = targetDate.getUTCDay();
      let diff = (targetIdx - currentDay + 7) % 7;
      if (diff === 0) diff = 7;
      targetDate.setUTCDate(targetDate.getUTCDate() + diff);
    }
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(lower)) {
    targetDate = new Date(lower + 'T00:00:00Z');
  }

  const yyyy = targetDate.getUTCFullYear();
  const mm = String(targetDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(targetDate.getUTCDate()).padStart(2, '0');
  const resolvedStr = `${yyyy}-${mm}-${dd}`;

  const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return {
    resolvedDate: resolvedStr,
    todayDate: todayInfo.date,
    weekdayName: weekdayNames[targetDate.getUTCDay()],
  };
}

/**
 * Validate proposed leave date against college calendar (exams, holidays).
 */
export async function validateLeaveDate(
  token: string,
  dateStr: string
): Promise<{
  valid: boolean;
  conflict?: string;
  calendarEvent?: any;
}> {
  const client = getCollegeAPIClient();
  try {
    const calendar = await client.getCalendar(token, { from: dateStr, to: dateStr });
    if (calendar && calendar.length > 0) {
      for (const entry of calendar) {
        if (entry.type === 'internal_exam' || entry.type === 'exam') {
          return {
            valid: false,
            conflict: `Conflict with scheduled ${entry.title || 'Internal Assessment Examination'} (${entry.subject_code || ''}) on ${dateStr}. Per College Rule 6.1.4, personal leave cannot be granted on Internal Assessment examination days.`,
            calendarEvent: entry,
          };
        }
        if (entry.type === 'holiday') {
          return {
            valid: true,
            conflict: `Note: ${dateStr} is already marked as a holiday (${entry.title}). A formal leave request may not be necessary, but can still be submitted if required.`,
            calendarEvent: entry,
          };
        }
      }
    }
    return { valid: true };
  } catch (err: any) {
    console.warn('[validateLeaveDate warning]:', err?.message);
    return { valid: true };
  }
}
