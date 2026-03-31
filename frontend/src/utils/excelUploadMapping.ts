import * as XLSX from 'xlsx';

export type MapFieldDef = { key: string; label: string; required?: boolean };

const NONE = '__none__';

export const MAP_NONE = NONE;

export function normalizeHeader(h: string): string {
  return String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Resolve sheet name case-insensitively from workbook */
export function findSheetName(workbook: XLSX.WorkBook, candidates: string[]): string | null {
  const names = workbook.SheetNames.map((n) => n.trim());
  for (const c of candidates) {
    const idx = names.findIndex((n) => n.toLowerCase() === c.toLowerCase());
    if (idx >= 0) return workbook.SheetNames[idx];
  }
  return null;
}

export function findHierarchySheetName(workbook: XLSX.WorkBook): string | null {
  const hit = workbook.SheetNames.find((n) => /sales\s*hierarchy|hierarchy/i.test(n.trim()));
  return hit ?? workbook.SheetNames[0] ?? null;
}

export function readSheetAsRows(workbook: XLSX.WorkBook, sheetName: string): Record<string, unknown>[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
}

export function getHeadersFromRows(rows: Record<string, unknown>[]): string[] {
  if (rows.length === 0) return [];
  return Object.keys(rows[0] as object);
}

function scoreHeaderForField(header: string, field: MapFieldDef): number {
  const h = normalizeHeader(header).replace(/ /g, '');
  const key = field.key.toLowerCase();
  const label = normalizeHeader(field.label).replace(/ /g, '');
  if (h === key) return 100;
  if (h === label) return 95;
  if (h.includes(key) || key.includes(h)) return 70;
  if (label && (h.includes(label) || label.includes(h))) return 65;
  const hk = normalizeHeader(header);
  const words = label.split(' ').filter(Boolean);
  let w = 0;
  for (const word of words) {
    if (hk.includes(word)) w += 10;
  }
  return w;
}

/** Greedy auto-map: each field picks best unused header */
export function autoMapHeaders(headers: string[], fields: MapFieldDef[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  const sortedFields = [...fields].sort((a, b) => (b.required === true ? 1 : 0) - (a.required === true ? 1 : 0));
  for (const f of sortedFields) {
    let best: { h: string; s: number } | null = null;
    for (const h of headers) {
      if (used.has(h)) continue;
      const s = scoreHeaderForField(h, f);
      if (!best || s > best.s) best = { h, s };
    }
    if (best && best.s >= 40) {
      mapping[f.key] = best.h;
      used.add(best.h);
    } else {
      mapping[f.key] = NONE;
    }
  }
  return mapping;
}

export function rowsWithCanonicalKeys(
  rawRows: Record<string, unknown>[],
  fields: MapFieldDef[],
  mapping: Record<string, string>
): Record<string, unknown>[] {
  return rawRows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const h = mapping[f.key];
      if (!h || h === NONE) continue;
      out[f.key] = row[h];
    }
    return out;
  });
}

export function buildDualSheetXlsxFile(
  activitiesRows: Record<string, unknown>[],
  farmersRows: Record<string, unknown>[],
  activityFields: MapFieldDef[],
  farmerFields: MapFieldDef[],
  actMapping: Record<string, string>,
  farmMapping: Record<string, string>,
  filename = 'ffa_import.xlsx'
): File {
  const actOut = rowsWithCanonicalKeys(activitiesRows, activityFields, actMapping);
  const farmOut = rowsWithCanonicalKeys(farmersRows, farmerFields, farmMapping);
  const wb = XLSX.utils.book_new();
  const wsA = XLSX.utils.json_to_sheet(actOut);
  const wsF = XLSX.utils.json_to_sheet(farmOut);
  XLSX.utils.book_append_sheet(wb, wsA, 'Activities');
  XLSX.utils.book_append_sheet(wb, wsF, 'Farmers');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new File([buf], filename, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** Remap hierarchy sheet to exact backend-expected column titles */
export function buildHierarchyXlsxFile(
  rawRows: Record<string, unknown>[],
  fields: MapFieldDef[],
  mapping: Record<string, string>,
  filename = 'sales_hierarchy_mapped.xlsx'
): File {
  const titles: Record<string, string> = {
    territoryCode: 'Territory Code',
    territoryName: 'Territory Name',
    regionCode: 'Region Code',
    region: 'Region',
    zoneCode: 'Zone Code',
    zoneName: 'Zone Name',
    bu: 'BU',
  };
  const canonical = rowsWithCanonicalKeys(rawRows, fields, mapping);
  const out = canonical.map((r) => {
    const row: Record<string, unknown> = {};
    for (const f of fields) {
      const v = r[f.key];
      const title = titles[f.key] ?? f.label;
      row[title] = v ?? '';
    }
    return row;
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(out);
  XLSX.utils.book_append_sheet(wb, ws, 'Sales Hierarchy');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new File([buf], filename, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function selectOptionsFromHeaders(headers: string[]): { value: string; label: string }[] {
  return [{ value: NONE, label: '— Not mapped —' }, ...headers.map((h) => ({ value: h, label: h }))];
}
