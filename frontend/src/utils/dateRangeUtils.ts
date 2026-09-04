/**
 * Shared date range utilities for the date picker used across:
 * ActivityEmsProgressView, ActivitySamplingView, AgentHistoryView, AgentAnalyticsView,
 * TaskList, TaskDashboardView, SamplingControlView, CallbackRequestView.
 *
 * Uses IST (Asia/Kolkata) calendar days for presets and YYYY-MM-DD values.
 */

export type DateRangePreset =
  | 'Custom'
  | 'Today'
  | 'Yesterday'
  | 'This week (Sun - Today)'
  | 'Last 7 days'
  | 'Last week (Sun - Sat)'
  | 'Last 14 days'
  | 'Last 28 days'
  | 'Last 30 days'
  | 'Last 90 days'
  | 'YTD';

export const APP_TIMEZONE = 'Asia/Kolkata';

/** Format a Date as YYYY-MM-DD in IST (Reach calendar days). */
export function toISODateIST(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** @deprecated Use toISODateIST. Kept so existing call sites keep compiling. */
export function toISODateLocal(d: Date): string {
  return toISODateIST(d);
}

function addIstDays(ymd: string, delta: number): string {
  const t = new Date(`${ymd}T12:00:00.000+05:30`);
  t.setTime(t.getTime() + delta * 86_400_000);
  return toISODateIST(t);
}

function istSundayOffset(d: Date): number {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    weekday: 'short',
  }).format(d);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
}

function parseDateInput(value: string | Date | null | undefined): Date | null {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date only in IST: dd/mm/yy */
export function formatDateIST(value: string | Date | null | undefined): string {
  const d = parseDateInput(value);
  if (!d) return '';
  return d.toLocaleDateString('en-GB', {
    timeZone: APP_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

/** Date and time in IST: dd/mm/yy, HH:mm:ss IST */
export function formatDateTimeIST(value: string | Date | null | undefined): string {
  const d = parseDateInput(value);
  if (!d) return '';
  const date = formatDateIST(d);
  const time = d.toLocaleTimeString('en-GB', {
    timeZone: APP_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return `${date}, ${time} IST`;
}

/** Backend FFA config dates (DD-MM-YYYY HH:mm:ss) → dd/mm/yy, HH:mm:ss IST */
export function formatConfigDateTimeDisplay(value: string | null | undefined): string {
  if (!value) return '';
  const dash = value.match(/^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
  if (dash) {
    const [, dd, mm, yyyy, hh = '00', min = '00', sec = '00'] = dash;
    return `${dd}/${mm}/${yyyy.slice(-2)}, ${hh}:${min}:${sec} IST`;
  }
  return formatDateTimeIST(value);
}

/** Format ISO date string for display in IST (dd/mm/yy). */
export function formatPretty(iso: string): string {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return `${m[3]}/${m[2]}/${m[1].slice(-2)}`;
  }
  try {
    return formatDateIST(iso);
  } catch {
    return iso;
  }
}

export interface PresetRangeResult {
  start: string;
  end: string;
}

/**
 * Get start/end dates for a preset. Uses IST calendar days.
 * YTD = fiscal year to date (1 Apr of current FY → today): Apr–Dec use this year's Apr 1;
 * Jan–Mar use previous year's Apr 1.
 * For Custom, pass the current custom range (customFrom, customTo); they are returned as-is.
 */
export function getPresetRange(
  preset: DateRangePreset,
  customFrom?: string,
  customTo?: string
): PresetRangeResult {
  const todayYmd = toISODateIST(new Date());
  const sundayOffset = istSundayOffset(new Date());

  switch (preset) {
    case 'Today':
      return { start: todayYmd, end: todayYmd };
    case 'Yesterday': {
      const y = addIstDays(todayYmd, -1);
      return { start: y, end: y };
    }
    case 'This week (Sun - Today)': {
      return { start: addIstDays(todayYmd, -sundayOffset), end: todayYmd };
    }
    case 'Last 7 days': {
      return { start: addIstDays(todayYmd, -6), end: todayYmd };
    }
    case 'Last week (Sun - Sat)': {
      const lastSat = addIstDays(todayYmd, -(sundayOffset + 1));
      const lastSun = addIstDays(lastSat, -6);
      return { start: lastSun, end: lastSat };
    }
    case 'Last 14 days': {
      return { start: addIstDays(todayYmd, -13), end: todayYmd };
    }
    case 'Last 28 days': {
      return { start: addIstDays(todayYmd, -27), end: todayYmd };
    }
    case 'Last 30 days': {
      return { start: addIstDays(todayYmd, -29), end: todayYmd };
    }
    case 'Last 90 days': {
      return { start: addIstDays(todayYmd, -89), end: todayYmd };
    }
    case 'YTD': {
      const [yearStr, monthStr] = todayYmd.split('-');
      const year = Number(yearStr);
      const month = Number(monthStr);
      const fyStartYear = month >= 4 ? year : year - 1;
      return { start: `${fyStartYear}-04-01`, end: todayYmd };
    }
    case 'Custom':
    default:
      return { start: customFrom ?? '', end: customTo ?? '' };
  }
}
