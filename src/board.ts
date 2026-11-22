/**
 * Auswertung der Vorstandsliste (`board`) aus /directory/:id/.
 *
 * Die Doku nennt nur „board: array – Board members“. Die Auswertung ist tolerant gegenüber verschiedenen Formen:
 * Person direkt im Eintrag (id, first_name, …) oder verschachtelt (member/user), Amt als Text (function_name,
 * function, title, position, role) oder Objekt (function.name, combination.function.name, combination.name).
 * Zur Prüfung gegen echte Daten: GET /api/admin/levels/:id?raw=1.
 */

export interface BoardMember {
  memberId: number;
  firstName: string;
  lastName: string;
  profilePicUrl: string | null;
  functionName: string;
  clubId: number | null;
  clubName: string | null;
}

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  return null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function functionNameOf(e: Record<string, unknown>): string | null {
  const combination = rec(e.combination);
  return (
    str(e.function_name) ??
    str(rec(e.function)?.name) ??
    str(e.function) ??
    str(rec(combination?.function)?.name) ??
    str(e.title) ??
    str(e.position) ??
    str(rec(e.position)?.name) ??
    str(e.role) ??
    str(rec(e.role)?.name) ??
    str(combination?.name)
  );
}

export function parseBoard(entries: unknown): BoardMember[] {
  if (!Array.isArray(entries)) return [];
  const result: BoardMember[] = [];
  for (const raw of entries) {
    const e = rec(raw);
    if (!e) continue;
    const nested = rec(e.member) ?? rec(e.user) ?? rec(e.person);
    const person = nested ?? e;
    const memberId = nested
      ? num(nested.id)
      : (num(e.member_id) ?? num(e.user_id) ?? (str(e.first_name) ? num(e.id) : null));
    const firstName = str(person.first_name);
    const lastName = str(person.last_name);
    const functionName = functionNameOf(e);
    if (memberId === null || !firstName || !lastName || !functionName) continue;
    const level = rec(person.level) ?? rec(person.club);
    result.push({
      memberId,
      firstName,
      lastName,
      profilePicUrl: str(person.profile_pic_url),
      functionName,
      clubId: num(level?.id),
      clubName: str(level?.name),
    });
  }
  return result;
}
