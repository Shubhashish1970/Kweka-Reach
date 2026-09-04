const IST_TZ = 'Asia/Kolkata';

function formatYmdInIst(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function formatIstCalendarYmd(d: Date): string {
  return formatYmdInIst(d);
}

function istStartOfDay(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000+05:30`);
}

function istEndOfDay(ymd: string): Date {
  return new Date(`${ymd}T23:59:59.999+05:30`);
}

/**
 * YYYY-MM-DD for a query value.
 * Date-only ISO from express-validator is UTC midnight — keep that calendar day.
 * Other timestamps use the IST calendar day of the instant.
 */
export function calendarYmdIst(value: string | Date): string | undefined {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined;
    const utcMidnight =
      value.getUTCHours() === 0 &&
      value.getUTCMinutes() === 0 &&
      value.getUTCSeconds() === 0 &&
      value.getUTCMilliseconds() === 0;
    if (utcMidnight) {
      return value.toISOString().slice(0, 10);
    }
    return formatYmdInIst(value);
  }

  const raw = String(value).trim();
  if (!raw) return undefined;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : formatYmdInIst(d);
}

/** Calendar-day bounds in IST (India), returned as UTC Date instants. */
export function getIstCalendarDayBounds(now: Date = new Date()): { day: string; start: Date; end: Date } {
  const day = formatYmdInIst(now);
  return {
    day,
    start: istStartOfDay(day),
    end: istEndOfDay(day),
  };
}

/** Parse YYYY-MM-DD query param as IST start-of-day (for activity.date $gte). */
export function parseQueryDateFrom(value?: string | Date): Date | undefined {
  if (value == null || value === '') return undefined;
  const ymd = calendarYmdIst(value);
  return ymd ? istStartOfDay(ymd) : undefined;
}

/** Parse YYYY-MM-DD query param as IST end-of-day (for activity.date $lte). */
export function parseQueryDateTo(value?: string | Date): Date | undefined {
  if (value == null || value === '') return undefined;
  const ymd = calendarYmdIst(value);
  return ymd ? istEndOfDay(ymd) : undefined;
}
