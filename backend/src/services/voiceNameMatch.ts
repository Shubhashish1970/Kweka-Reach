const NAME_STOPWORDS = new Set([
  'crop',
  'crops',
  'product',
  'products',
  'kg',
  'gms',
  'gm',
  'lt',
  'ltr',
  'ml',
  'the',
  'a',
  'an',
  'and',
  'of',
]);

/**
 * Spoken / ASR variants → English keys, then matched to Crop master spellings.
 * Never invents a crop that is not on the master list.
 */
const CROP_ALIASES: Record<string, string> = {
  dhan: 'paddy',
  chawal: 'paddy',
  rice: 'paddy',
  paddy: 'paddy',
  'धान': 'paddy',
  'चावल': 'paddy',
  kapas: 'cotton',
  cotton: 'cotton',
  'कपास': 'cotton',
  gehu: 'wheat',
  wheat: 'wheat',
  'गेहूं': 'wheat',
  'गेहूँ': 'wheat',
  makka: 'maize',
  maize: 'maize',
  corn: 'maize',
  'मक्का': 'maize',
  tamatar: 'tomato',
  tomato: 'tomato',
  'टमाटर': 'tomato',
  soyabean: 'soybean',
  soybean: 'soybean',
  soya: 'soybean',
  'सोयाबीन': 'soybean',
  mirch: 'chilli',
  chilli: 'chilli',
  chili: 'chilli',
  'मिर्च': 'chilli',
  ganna: 'sugarcane',
  sugarcane: 'sugarcane',
  'गन्ना': 'sugarcane',
  baingan: 'brinjal',
  brinjal: 'brinjal',
  eggplant: 'brinjal',
  'बैंगन': 'brinjal',
  pyaz: 'onion',
  onion: 'onion',
  'प्याज': 'onion',
  aloo: 'potato',
  potato: 'potato',
  'आलू': 'potato',
};

export interface CanonicalNameOptions {
  /** Prefer these master names when two candidates score equally. */
  preferred?: string[];
  aliases?: Record<string, string>;
}

export function normalizeName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\u0900-\u097f]+/gi, ' ')
    .split(/\s+/)
    .filter((token) => token && !NAME_STOPWORDS.has(token))
    .join(' ')
    .trim();
}

function compactName(value: string): string {
  return normalizeName(value).replace(/\s+/g, '');
}

function tokens(value: string): string[] {
  return normalizeName(value).split(/\s+/).filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[] = new Array(cols);
  for (let j = 0; j < cols; j += 1) dp[j] = j;
  for (let i = 1; i < rows; i += 1) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j < cols; j += 1) {
      const cur = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = cur;
    }
  }
  return dp[cols - 1];
}

function aliasKey(value: string, aliases: Record<string, string>): string | null {
  const normalized = normalizeName(value);
  if (!normalized) return null;
  if (aliases[normalized]) return aliases[normalized];
  const compact = compactName(value);
  if (aliases[compact]) return aliases[compact];
  return null;
}

/**
 * Lower is better. null = no plausible match.
 * 0 exact, 1 normalized/alias, 2 unique contains/tokens, 3 small typo.
 */
export function nameMatchScore(
  spoken: string,
  master: string,
  aliases: Record<string, string> = {}
): number | null {
  const rawSpoken = spoken.trim();
  const rawMaster = master.trim();
  if (!rawSpoken || !rawMaster) return null;
  if (rawSpoken === rawMaster) return 0;
  if (rawSpoken.toLowerCase() === rawMaster.toLowerCase()) return 1;

  const spokenNorm = normalizeName(rawSpoken);
  const masterNorm = normalizeName(rawMaster);
  if (!spokenNorm || !masterNorm) return null;
  if (spokenNorm === masterNorm) return 1;

  const spokenAlias = aliasKey(rawSpoken, aliases);
  if (spokenAlias && (spokenAlias === masterNorm || spokenAlias === compactName(rawMaster))) {
    return 1;
  }

  if (compactName(rawSpoken) && compactName(rawSpoken) === compactName(rawMaster)) return 1;

  const spokenTokens = tokens(rawSpoken);
  const masterTokens = tokens(rawMaster);
  if (
    spokenTokens.length > 0 &&
    masterTokens.length > 0 &&
    spokenTokens.every((t) => masterTokens.includes(t)) &&
    spokenNorm.length >= 4
  ) {
    return 2;
  }
  if (
    spokenTokens.length > 0 &&
    masterTokens.length > 0 &&
    masterTokens.every((t) => spokenTokens.includes(t)) &&
    masterNorm.length >= 4
  ) {
    return 2;
  }

  if (spokenNorm.length >= 4 && masterNorm.includes(spokenNorm)) return 2;
  if (masterNorm.length >= 4 && spokenNorm.includes(masterNorm)) return 2;

  const a = compactName(rawSpoken);
  const b = compactName(rawMaster);
  if (a.length >= 4 && b.length >= 4) {
    const dist = levenshtein(a, b);
    const allowed = a.length >= 8 || b.length >= 8 ? 2 : 1;
    if (dist > 0 && dist <= allowed) return 3;
  }

  return null;
}

/**
 * Map a spoken/ASR name onto a master spelling.
 * Ambiguous fuzzy hits are rejected unless exactly one preferred name wins.
 */
export function canonicalName(
  value: string,
  names: string[],
  options: CanonicalNameOptions = {}
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!names.length) return trimmed;

  const aliases = options.aliases || {};
  const preferred = new Set(
    (options.preferred || []).map((name) => name.trim().toLowerCase()).filter(Boolean)
  );

  const hits = names
    .map((name) => ({ name, score: nameMatchScore(trimmed, name, aliases) }))
    .filter((hit): hit is { name: string; score: number } => hit.score != null)
    .sort((a, b) => a.score - b.score);

  if (!hits.length) return null;

  const bestScore = hits[0].score;
  const tied = hits.filter((hit) => hit.score === bestScore);
  if (tied.length === 1) return tied[0].name;

  const preferredTied = tied.filter((hit) => preferred.has(hit.name.toLowerCase()));
  if (preferredTied.length === 1) return preferredTied[0].name;

  // Exact / case-insensitive ties should not happen for unique masters.
  if (bestScore <= 1 && tied.length > 1) return null;
  return null;
}

export function matchNames(
  values: string[],
  names: string[],
  options: CanonicalNameOptions = {}
): { matched: string[]; unmatched: string[] } {
  if (!names.length) return { matched: values.filter(Boolean), unmatched: [] };
  const seen = new Set<string>();
  const matched: string[] = [];
  const unmatched: string[] = [];
  for (const value of values) {
    const name = canonicalName(value, names, options);
    if (!name) {
      unmatched.push(value.trim());
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    matched.push(name);
  }
  return { matched, unmatched };
}

export function canonicalizeAgainstMasters(
  values: string[] | undefined,
  names: string[],
  options: CanonicalNameOptions = {}
): string[] {
  return matchNames(values || [], names, options).matched;
}

/**
 * Masters first (MIS spelling), then this call's own names (activity crops/products).
 * If neither list exists, keep the spoken value.
 */
export function resolveAgainstOurData(
  spoken: string,
  masters: string[],
  ourNames: string[],
  options: CanonicalNameOptions = {}
): string | null {
  const trimmed = spoken.trim();
  if (!trimmed) return null;
  const preferred = [...(options.preferred || []), ...ourNames];
  if (masters.length) {
    const masterHit = canonicalName(trimmed, masters, { ...options, preferred });
    if (masterHit) return masterHit;
  }
  if (ourNames.length) {
    return canonicalName(trimmed, ourNames, options);
  }
  if (!masters.length) return trimmed;
  return null;
}

export function matchAgainstOurData(
  values: string[],
  masters: string[],
  ourNames: string[],
  options: CanonicalNameOptions = {}
): { matched: string[]; extra: string[] } {
  const seen = new Set<string>();
  const matched: string[] = [];
  const extra: string[] = [];
  for (const value of values) {
    const name = resolveAgainstOurData(value, masters, ourNames, options);
    if (!name) {
      extra.push(value.trim());
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    matched.push(name);
  }
  return { matched, extra };
}

export function namesLikelySame(a: string, b: string): boolean {
  const left = a.trim();
  const right = b.trim();
  if (!left || !right) return false;
  return nameMatchScore(left, right) != null && (nameMatchScore(left, right) as number) <= 2;
}

export const CROP_NAME_ALIASES = CROP_ALIASES;
