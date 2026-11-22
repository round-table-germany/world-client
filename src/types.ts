/** Typen der .WORLD-API (nur die von der App genutzten Felder; Doku: developer.roundtable.world). */

export interface WorldLevelRef {
  id: number;
  name: string;
  path?: string;
  logo?: string | null;
  subdomain?: string;
  sync_family?: number;
  sync_level?: number;
}

export interface WorldMe {
  id: number;
  first_name: string;
  last_name: string;
  level_id: number;
}

export interface WorldLoginSuccess {
  global_auth_token: string;
  local_auth_token: string;
  me: WorldMe;
  club: { id: number; name: string; path?: string };
}

export interface WorldProfileCategory {
  category_name?: string;
  code: string;
  values: unknown;
}

export interface WorldMyProfile {
  profile_categories: WorldProfileCategory[];
}

export interface WorldMyLevels {
  club?: WorldLevelRef | null;
  area?: WorldLevelRef | null;
  association?: WorldLevelRef | null;
  family?: WorldLevelRef | null;
}

export interface WorldMemberSummary {
  id: number;
  first_name: string;
  last_name: string;
  profile_pic_url?: string | null;
  level?: WorldLevelRef | null;
}

export interface WorldLevelDetails extends WorldLevelRef {
  sync_parent?: number | null;
  children?: WorldLevelRef[];
  members?: WorldMemberSummary[];
  honorary_members?: WorldMemberSummary[];
  /** Vorstand der Ebene; Aufbau nicht dokumentiert (siehe world/board.ts). */
  board?: unknown[];
}

export interface WorldPage<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface WorldFunctionConfig {
  id: number;
  name: string;
  display_order?: number;
}

export interface WorldEvent {
  id: number;
  name: string;
  description?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  event_type?: string | null;
  club?: { id: number; name: string } | null;
  shared_with_type?: string | null;
  shared_with_level?: WorldLevelRef | null;
}

export interface WorldEventSearch {
  query?: string;
  start_date?: string | null;
  end_date?: string | null;
  organising_level?: number | null;
  organising_region?: number | null;
  organising_sync_level?: number | number[] | null;
  event_type?: string | null;
}

export interface WorldMemberSearch {
  query?: string;
  level?: number | null;
  function_name?: string | null;
  order_by?: 'first_name' | 'last_name';
}

/** Ein Amt eines Mitglieds aus "groups" – identifiziert über combination.id. */
export interface MemberFunction {
  combinationId: number;
  /** Lesbare Bezeichnung aus den Namen der Kombination (nur Anzeige). */
  label: string;
  startDate: string | null;
  endDate: string | null;
}
