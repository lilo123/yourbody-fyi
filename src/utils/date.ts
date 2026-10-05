/**
 * Canonical Date & Local Timezone Utilities
 *
 * Provides timezone-safe date parsing, normalization, and local timestamp generation.
 * Guarantees that daily diary entries, macro tracking, and workout sessions are
 * strictly partitioned by the user's local solar/civil day (YYYY-MM-DD), decoupling
 * calendar tracking from astronomical UTC date drift.
 */

/**
 * Returns local YYYY-MM-DD string for a given Date or today.
 * Queries local calendar getters (getFullYear, getMonth, getDate)
 * to prevent UTC date rollover bugs.
 */
export function getLocalDateStr(date: Date = new Date()): string {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return '';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function getDateTimeFormat(timeZone: string): Intl.DateTimeFormat {
  let dtf = dtfCache.get(timeZone);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    dtfCache.set(timeZone, dtf);
  }
  return dtf;
}

/**
 * Returns the timezone offset in minutes for a specific date instant and timezone.
 * Handles IANA timezone strings (e.g. 'America/New_York', 'Asia/Tokyo'),
 * explicit offset strings (e.g. '+09:00', '-05:00', 'Z', '+00:00'),
 * or defaults to the runtime's local timezone offset if omitted.
 */
export function getTimezoneOffsetMinutes(date: Date = new Date(), timeZone?: string): number {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return 0;
  }
  if (!timeZone) {
    return -date.getTimezoneOffset();
  }
  const offsetMatch = timeZone.match(/^([+-])(\d{2}):?(\d{2})?$/);
  if (offsetMatch) {
    const sign = offsetMatch[1] === '+' ? 1 : -1;
    const hours = parseInt(offsetMatch[2], 10);
    const mins = offsetMatch[3] ? parseInt(offsetMatch[3], 10) : 0;
    return sign * (hours * 60 + mins);
  }
  if (timeZone.toUpperCase() === 'Z' || timeZone.toUpperCase() === 'UTC') {
    return 0;
  }
  try {
    const formatter = getDateTimeFormat(timeZone);
    const parts = formatter.formatToParts(date);
    const map: Record<string, number> = {};
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10);
    }
    const asUtc = Date.UTC(
      map.year,
      map.month - 1,
      map.day,
      map.hour === 24 ? 0 : map.hour,
      map.minute,
      map.second
    );
    const dateMsSec = Math.floor(date.getTime() / 1000) * 1000;
    return Math.round((asUtc - dateMsSec) / 60000);
  } catch {
    return -date.getTimezoneOffset();
  }
}

/**
 * Converts local civil date and time components in a given timezone (or system timezone)
 * to exact UTC epoch milliseconds.
 * Iteratively converges the timezone offset to handle daylight saving transitions accurately.
 */
export function localCivilToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
  timeZone?: string
): number {
  const targetCivilMs = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const effectiveTz = timeZone || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined);

  if (!effectiveTz) {
    return new Date(year, month - 1, day, hour, minute, second, millisecond).getTime();
  }

  let utcMs = targetCivilMs;
  for (let i = 0; i < 4; i++) {
    const offset = getTimezoneOffsetMinutes(new Date(utcMs), effectiveTz);
    const nextUtcMs = targetCivilMs - offset * 60000;
    if (nextUtcMs === utcMs) break;
    utcMs = nextUtcMs;
  }
  return utcMs;
}

export interface DayBounds {
  startOfDay: string;
  endOfDay: string;
}

/**
 * Computes precise ISO start-of-day (00:00:00.000) and end-of-day (23:59:59.999)
 * query bounds in UTC for a given calendar date (YYYY-MM-DD) in the specified
 * timezone (or local environment timezone if omitted).
 *
 * Prevents clipping of meals/workouts logged near midnight across positive
 * (e.g. Tokyo +09:00) and negative (e.g. New York -05:00) timezone offsets,
 * as well as daylight saving transition days (23-hour or 25-hour days).
 */
export function getDayBounds(
  dateInput?: string | Date | null,
  timeZone?: string
): DayBounds {
  const getTodayInTz = () => normalizeDateStr(new Date(), timeZone) || getLocalDateStr();
  const norm = (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput))
    ? dateInput
    : (dateInput ? normalizeDateStr(dateInput, timeZone) : '') || getTodayInTz();
  const [year, month, day] = norm.split('-').map(Number);
  if (isNaN(year) || isNaN(month) || isNaN(day)) {
    const today = getTodayInTz();
    return getDayBounds(today, timeZone);
  }

  const startUtcMs = localCivilToUtcMs(year, month, day, 0, 0, 0, 0, timeZone);
  const endUtcMs = localCivilToUtcMs(year, month, day, 23, 59, 59, 999, timeZone);

  return {
    startOfDay: new Date(startUtcMs).toISOString(),
    endOfDay: new Date(endUtcMs).toISOString(),
  };
}

/**
 * Returns the precise ISO start-of-day query bound for a given YYYY-MM-DD date.
 */
export function getStartOfDay(dateInput?: string | Date | null, timeZone?: string): string {
  return getDayBounds(dateInput, timeZone).startOfDay;
}

/**
 * Returns the precise ISO end-of-day query bound for a given YYYY-MM-DD date.
 */
export function getEndOfDay(dateInput?: string | Date | null, timeZone?: string): string {
  return getDayBounds(dateInput, timeZone).endOfDay;
}

/**
 * Authoritative check whether a given timestamp (ISO string or Date) falls within
 * the authoritative day boundary for dateInput in the given timezone.
 * Guarantees server query and client rendering stay strictly aligned.
 */
export function isWithinDayBounds(
  timestamp: string | Date | null | undefined,
  dateInput: string | Date,
  timeZone?: string
): boolean {
  if (!timestamp) return false;
  const normDate = (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput))
    ? dateInput
    : (normalizeDateStr(dateInput, timeZone) || (typeof dateInput === 'string' ? dateInput.slice(0, 10) : ''));
  if (!normDate) return false;

  const { startOfDay, endOfDay } = getDayBounds(normDate, timeZone);
  const startTime = new Date(startOfDay).getTime();
  const endTime = new Date(endOfDay).getTime();

  let t: number;
  if (timestamp instanceof Date) {
    t = timestamp.getTime();
  } else if (typeof timestamp === 'string') {
    t = new Date(timestamp).getTime();
  } else {
    return false;
  }

  if (isNaN(t)) return false;

  // Primary check: timestamp falls within authoritative day bounds
  return t >= startTime && t <= endTime;
}

/**
 * Normalizes any date input (string, Date, null, undefined) into YYYY-MM-DD.
 * If timeZone is specified, converts the timestamp instant to that timezone's calendar day.
 * If timeZone is omitted:
 * - String starting with YYYY-MM-DD preserves the prefix without timezone shifting.
 * - Date object extracts local calendar year/month/day.
 */
export function normalizeDateStr(
  val: string | Date | null | undefined,
  timeZone?: string
): string {
  if (!val) return '';

  if (timeZone) {
    if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
      return val;
    }
    const parsed = typeof val === 'string' ? new Date(val) : val;
    if (parsed instanceof Date && !isNaN(parsed.getTime())) {
      const offsetMinutes = getTimezoneOffsetMinutes(parsed, timeZone);
      const shifted = new Date(parsed.getTime() + offsetMinutes * 60000);
      const year = shifted.getUTCFullYear();
      const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
      const day = String(shifted.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }

  if (typeof val === 'string') {
    const match = val.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
    const parsed = new Date(val);
    if (!isNaN(parsed.getTime())) {
      const year = parsed.getFullYear();
      const month = String(parsed.getMonth() + 1).padStart(2, '0');
      const day = String(parsed.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    return val.slice(0, 10);
  }
  if (val instanceof Date && !isNaN(val.getTime())) {
    const year = val.getFullYear();
    const month = String(val.getMonth() + 1).padStart(2, '0');
    const day = String(val.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(val);
}

/**
 * Timezone-safe local day of week abbreviation extractor (e.g. 'Sun', 'Mon', 'Tue').
 * Avoids UTC date parsing shifts where UTC midnight becomes previous day in Western time zones.
 */
export function getDayOfWeekAbbr(dateStr: string): string {
  const norm = normalizeDateStr(dateStr);
  if (!norm) return '';
  const [year, month, day] = norm.split('-').map(Number);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return '';
  const localDate = new Date(year, month - 1, day);
  if (
    isNaN(localDate.getTime()) ||
    localDate.getFullYear() !== year ||
    localDate.getMonth() !== month - 1 ||
    localDate.getDate() !== day
  ) {
    return '';
  }
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[localDate.getDay()] || '';
}

/**
 * Formats a date string (YYYY-MM-DD or ISO timestamp) into short human format (e.g. "Sep 8", "Jan 15").
 * Normalizes input first so full ISO timestamps (like Supabase timestamptz) are correctly parsed.
 */
export function formatShortDate(isoDateStr: string): string {
  if (!isoDateStr || typeof isoDateStr !== 'string') return '';
  const norm = normalizeDateStr(isoDateStr);
  const parts = norm.split('-');
  if (parts.length !== 3) return isoDateStr;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mIdx = parseInt(parts[1], 10) - 1;
  const monthStr = months[mIdx] || parts[1];
  const dayStr = parseInt(parts[2], 10);
  if (isNaN(mIdx) || isNaN(dayStr)) return isoDateStr;
  return `${monthStr} ${dayStr}`;
}

/**
 * Generates a valid ISO-8601 UTC timestamp string corresponding to the actual instant
 * anchored to the specified local calendar date string (YYYY-MM-DD) and local clock time.
 *
 * Guarantees:
 * 1. Returns a valid ISO-8601 UTC timestamp corresponding to the true physical instant.
 * 2. If calendarDate is provided (YYYY-MM-DD), combines that civil date with the
 *    time components of `time` in the given timezone (or local environment timezone).
 * 3. Timestamps fall strictly inside getDayBounds for the calendarDate and outside adjacent days.
 * 4. PostgreSQL timestamptz columns record the exact instant without timezone offset error.
 */
export function formatLocalTimestamp(
  calendarDate?: string | null,
  time: Date = new Date(),
  timeZone?: string
): string {
  const validTime = time instanceof Date && !isNaN(time.getTime()) ? time : new Date();
  if (calendarDate && /^\d{4}-\d{2}-\d{2}$/.test(calendarDate)) {
    const [year, month, day] = calendarDate.split('-').map(Number);
    let hours = validTime.getHours();
    let minutes = validTime.getMinutes();
    let seconds = validTime.getSeconds();
    const ms = validTime.getMilliseconds();

    if (timeZone) {
      try {
        const formatter = getDateTimeFormat(timeZone);
        const parts = formatter.formatToParts(validTime);
        const map: Record<string, number> = {};
        for (const p of parts) {
          if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10);
        }
        if (typeof map.hour === 'number') {
          hours = map.hour === 24 ? 0 : map.hour;
        }
        if (typeof map.minute === 'number') {
          minutes = map.minute;
        }
        if (typeof map.second === 'number') {
          seconds = map.second;
        }
      } catch {
        // Fallback to validTime local hours/minutes/seconds
      }
    }

    const utcMs = localCivilToUtcMs(
      year,
      month,
      day,
      hours,
      minutes,
      seconds,
      ms,
      timeZone
    );
    return new Date(utcMs).toISOString();
  }
  return validTime.toISOString();
}

/**
 * Checks whether a given string is a valid civil calendar date (YYYY-MM-DD).
 */
export function isCivilDate(str: string): boolean {
  if (!str || typeof str !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(str);
}

/**
 * Formats a civil date (YYYY-MM-DD) or ISO timestamp into short human format (e.g. "Sep 15").
 * Directly parses calendar components without astronomical timezone shifting (H4, RD-5).
 */
export function formatCivilDate(dateStr: string): string {
  if (!dateStr || typeof dateStr !== "string") return "";
  if (isCivilDate(dateStr)) {
    const parts = dateStr.split("-");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const mIdx = parseInt(parts[1], 10) - 1;
    const monthStr = months[mIdx] || parts[1];
    const dayStr = parseInt(parts[2], 10);
    if (!isNaN(mIdx) && !isNaN(dayStr)) {
      return `${monthStr} ${dayStr}`;
    }
  }
  return formatShortDate(dateStr);
}
