import { type DateRangePreset } from './dateRangeUtils';

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const COMMON_DATE_RANGE_PRESETS: DateRangePreset[] = [
  'Custom',
  'Today',
  'Yesterday',
  'This week (Sun - Today)',
  'Last 7 days',
  'Last week (Sun - Sat)',
  'Last 14 days',
  'Last 28 days',
  'Last 30 days',
  'Last 90 days',
  'YTD',
];

export function parseIsoDate(value: unknown, fallback: string): string {
  return typeof value === 'string' && ISO_DATE.test(value) ? value : fallback;
}

export function parsePreset(
  value: unknown,
  fallback: DateRangePreset,
  presets: readonly DateRangePreset[] = COMMON_DATE_RANGE_PRESETS
): DateRangePreset {
  return (presets as readonly string[]).includes(value as string) ? (value as DateRangePreset) : fallback;
}

export function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function parseString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function loadJsonStorage<T>(key: string, createDefaults: () => T, merge: (parsed: unknown, defaults: T) => T): T {
  const defaults = createDefaults();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaults;
    return merge(JSON.parse(raw), defaults);
  } catch {
    return defaults;
  }
}

export function saveJsonStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota / private mode errors
  }
}
