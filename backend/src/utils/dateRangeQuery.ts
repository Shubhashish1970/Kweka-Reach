const IST_TZ = 'Asia/Kolkata';

/** Calendar-day bounds in IST (India), returned as UTC Date instants. */
export function getIstCalendarDayBounds(now: Date = new Date()): { day: string; start: Date; end: Date } {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return {
    day,
    start: new Date(`${day}T00:00:00.000+05:30`),
    end: new Date(`${day}T23:59:59.999+05:30`),
  };
}

/** Parse YYYY-MM-DD query param as local start-of-day (for activity.date $gte). */
export function parseQueryDateFrom(value?: string | Date): Date | undefined {
  if (!value) return undefined;
  const raw = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  }
  const d = new Date(raw);
  return isNaN(d.getTime()) ? undefined : d;
}

/** Parse YYYY-MM-DD query param as local end-of-day (for activity.date $lte). */
export function parseQueryDateTo(value?: string | Date): Date | undefined {
  if (!value) return undefined;
  const raw = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
  }
  const d = new Date(raw);
  return isNaN(d.getTime()) ? undefined : d;
}
