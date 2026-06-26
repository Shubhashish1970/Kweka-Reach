import { useEffect, useMemo, useState } from 'react';
import { getAuthHeaders } from '../services/api';

const API_BASE = import.meta.env.VITE_API_URL || '';

export const FALLBACK_LANGUAGES = [
  'Hindi',
  'Telugu',
  'Marathi',
  'Kannada',
  'Tamil',
  'Bengali',
  'Oriya',
  'English',
  'Malayalam',
] as const;

function mergeLanguageNames(...lists: (string[] | undefined)[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const list of lists) {
    for (const language of list ?? []) {
      const trimmed = language?.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(trimmed);
    }
  }

  return merged;
}

export function useMasterLanguages(extraLanguages: string[] = []) {
  const [languages, setLanguages] = useState<string[]>([...FALLBACK_LANGUAGES]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchLanguages = async () => {
      try {
        const response = await fetch(`${API_BASE}/master-data/languages`, {
          headers: getAuthHeaders(),
        });
        const data = await response.json();
        if (!cancelled && data.success && Array.isArray(data.data?.languages) && data.data.languages.length > 0) {
          setLanguages(data.data.languages.map((language: { name: string }) => language.name));
        }
      } catch (error) {
        console.warn('Failed to fetch languages from API, using fallback', error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchLanguages();

    return () => {
      cancelled = true;
    };
  }, []);

  const mergedLanguages = useMemo(
    () => mergeLanguageNames(languages, extraLanguages),
    [languages, extraLanguages]
  );

  return { languages: mergedLanguages, isLoading };
}
