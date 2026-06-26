import { MasterLanguage } from '../models/MasterData.js';
import { AppError } from '../middleware/errorHandler.js';

export async function getActiveMasterLanguageNames(): Promise<string[]> {
  const languages = await MasterLanguage.find({ isActive: true })
    .sort({ displayOrder: 1, name: 1 })
    .select('name')
    .lean();

  return languages.map((language) => language.name);
}

export async function assertActiveMasterLanguage(
  language: string,
  label = 'Language'
): Promise<string> {
  const trimmed = String(language ?? '').trim();
  if (!trimmed) {
    const error: AppError = new Error(`${label} is required`);
    error.statusCode = 400;
    throw error;
  }

  const active = await getActiveMasterLanguageNames();
  const canonical = active.find((name) => name.toLowerCase() === trimmed.toLowerCase());
  if (!canonical) {
    const error: AppError = new Error(
      `${label} "${trimmed}" is not an active language in master data`
    );
    error.statusCode = 400;
    throw error;
  }

  return canonical;
}

export async function assertActiveMasterLanguages(
  languages: string[],
  label = 'Language'
): Promise<string[]> {
  if (!Array.isArray(languages) || languages.length === 0) {
    return [];
  }

  const active = await getActiveMasterLanguageNames();
  const activeByLower = new Map(active.map((name) => [name.toLowerCase(), name]));
  const normalized: string[] = [];
  const invalid: string[] = [];

  for (const language of languages) {
    const trimmed = String(language ?? '').trim();
    if (!trimmed) continue;

    const canonical = activeByLower.get(trimmed.toLowerCase());
    if (!canonical) {
      invalid.push(trimmed);
      continue;
    }

    if (!normalized.some((name) => name.toLowerCase() === canonical.toLowerCase())) {
      normalized.push(canonical);
    }
  }

  if (invalid.length > 0) {
    const error: AppError = new Error(
      `${label} not found in active languages master: ${invalid.join(', ')}`
    );
    error.statusCode = 400;
    throw error;
  }

  return normalized;
}
