/**
 * Calling window checks in a given IANA timezone (default Asia/Kolkata).
 */

const DAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function getZonedParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const weekday = parts.find((p) => p.type === 'weekday')?.value || 'Sun';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  return { dayOfWeek: DAY_MAP[weekday] ?? 0, minutesSinceMidnight: hour * 60 + minute };
}

function parseHm(hm: string): number {
  const [h, m] = hm.split(':').map((v) => Number(v));
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

export function isWithinCallingWindow(
  now: Date,
  options: {
    timezone: string;
    daysOfWeek: number[];
    startTime: string;
    endTime: string;
  }
): boolean {
  const { dayOfWeek, minutesSinceMidnight } = getZonedParts(now, options.timezone || 'Asia/Kolkata');
  if (!options.daysOfWeek?.length || !options.daysOfWeek.includes(dayOfWeek)) {
    return false;
  }
  const start = parseHm(options.startTime);
  const end = parseHm(options.endTime);
  if (end <= start) {
    return minutesSinceMidnight >= start || minutesSinceMidnight < end;
  }
  return minutesSinceMidnight >= start && minutesSinceMidnight < end;
}
