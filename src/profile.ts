import type { MemberFunction, WorldMyProfile } from './types.js';

/**
 * Auswertung von /my-profile/ bzw. /members/:id/.
 *
 * Ämter stehen in der Profilkategorie "groups". Maßgeblich für Admin-Rechte ist je Eintrag die
 * `combination.id` (Kombination aus Amt und Ebene); ein Eintrag zählt nur, solange das heutige Datum
 * innerhalb von `start_date` … `end_date` liegt (fehlendes Datum = offen).
 */

function category(profile: WorldMyProfile, code: string): Record<string, unknown> | undefined {
  const cat = profile.profile_categories?.find((c) => c.code === code);
  const values = cat?.values;
  return values && typeof values === 'object' && !Array.isArray(values)
    ? (values as Record<string, unknown>)
    : undefined;
}

export function profilePicUrl(profile: WorldMyProfile): string | null {
  const v = category(profile, 'profile_pic')?.profile_pic_url;
  return typeof v === 'string' && v ? v : null;
}

export function memberUntilDate(profile: WorldMyProfile): string | null {
  const v = category(profile, 'personal')?.member_until_date;
  return typeof v === 'string' && v ? v : null;
}

export function memberStartDate(profile: WorldMyProfile): string | null {
  const v = category(profile, 'personal')?.member_start_date;
  return typeof v === 'string' && v ? v.slice(0, 10) : null;
}

/** Profile anderer Mitglieder (/members/:id/) haben „ähnliche Struktur“ – ggf. flach. */
export function profilePicFromAny(data: Record<string, unknown>): string | null {
  if (Array.isArray(data.profile_categories)) return profilePicUrl(data as unknown as WorldMyProfile);
  const v = data.profile_pic_url;
  return typeof v === 'string' && v ? v : null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  return null;
}

function asDate(v: unknown): string | null {
  return typeof v === 'string' && v ? v.slice(0, 10) : null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export type FunctionStatus = 'current' | 'past' | 'future';

export function functionStatus(
  f: { startDate: string | null; endDate: string | null },
  today: string,
): FunctionStatus {
  if (f.startDate && f.startDate > today) return 'future';
  if (f.endDate && f.endDate < today) return 'past';
  return 'current';
}

/** Lesbare Bezeichnung: Namen aus der Kombination (bzw. deren Unterobjekten wie Amt/Ebene). */
function labelOf(combination: Record<string, unknown>, entry: Record<string, unknown>): string {
  const parts: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === 'string' && v.trim() && !parts.includes(v.trim())) parts.push(v.trim());
  };
  for (const obj of [combination, entry]) {
    add(obj.name);
    add(obj.title);
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'combination') continue;
      const o = asRecord(v);
      if (o) add(o.name ?? o.title);
    }
  }
  return parts.length > 0 ? parts.join(' · ') : `Kombination ${String(combination.id)}`;
}

function toFunction(entry: Record<string, unknown>): MemberFunction | null {
  const combination = asRecord(entry.combination);
  const combinationId = asNumber(combination?.id) ?? asNumber(entry.combination_id);
  if (combinationId === null) return null;
  return {
    combinationId,
    label: labelOf(combination ?? { id: combinationId }, entry),
    startDate: asDate(entry.start_date),
    endDate: asDate(entry.end_date),
  };
}

/** Ein Eintrag aus "groups" samt Status, Fundstelle (JSON-Pfad) und Rohobjekt – für die Admin-Ansicht. */
export interface FunctionMatch {
  function: MemberFunction;
  status: FunctionStatus;
  path: string;
  source: Record<string, unknown>;
}

/** Alle Einträge mit `combination` (auch vergangene/künftige) aus den Werten der Kategorie "groups". */
export function extractFunctionMatches(
  groupsValues: unknown,
  today = new Date().toISOString().slice(0, 10),
): FunctionMatch[] {
  const found: FunctionMatch[] = [];
  const visit = (node: unknown, depth: number, path: string) => {
    if (depth > 6 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((n, i) => visit(n, depth + 1, `${path}[${i}]`));
      return;
    }
    const obj = node as Record<string, unknown>;
    const fn = toFunction(obj);
    if (fn) {
      found.push({ function: fn, status: functionStatus(fn, today), path, source: obj });
      return;
    }
    for (const [k, v] of Object.entries(obj)) visit(v, depth + 1, `${path}.${k}`);
  };
  visit(groupsValues, 0, '$');
  return found;
}

/** Aktuell gültige Ämter (heute innerhalb start_date … end_date), je Kombination einmal. */
export function extractFunctions(groupsValues: unknown, today = new Date().toISOString().slice(0, 10)) {
  const seen = new Set<number>();
  return extractFunctionMatches(groupsValues, today)
    .filter((m) => m.status === 'current')
    .map((m) => m.function)
    .filter((f) => !seen.has(f.combinationId) && seen.add(f.combinationId));
}

/** Rohdaten, aus denen die Ämter gelesen werden (Kategorie "groups" bzw. flaches Feld). */
export function groupsSource(data: Record<string, unknown>): unknown {
  if (Array.isArray(data.profile_categories)) {
    const cat = (data as unknown as WorldMyProfile).profile_categories?.find((c) => c.code === 'groups');
    return cat?.values ?? null;
  }
  return data.groups ?? null;
}

export function myFunctions(profile: WorldMyProfile): MemberFunction[] {
  return extractFunctions(groupsSource(profile as unknown as Record<string, unknown>) ?? []);
}
