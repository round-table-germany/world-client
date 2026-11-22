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
  cross_family_optin?: boolean;
  geolocation_optin?: boolean;
}

export interface WorldLoginSuccess {
  global_auth_token: string;
  local_auth_token: string;
  me: WorldMe;
  club: { id: number; name: string; path?: string };
}

export interface WorldProfileCategory {
  category_name?: string;
  display_order?: number;
  code: string;
  can_edit?: boolean;
  values: unknown;
}

export interface WorldPrivacySetting {
  /** Feld, z. B. "birth_date" oder "address-12424" (siehe PrivacyField). */
  type: string;
  level: PrivacyLevel;
}

export interface WorldMyProfile {
  cross_family_optin?: boolean;
  profile_categories: WorldProfileCategory[];
  privacy_settings?: WorldPrivacySetting[];
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
  is_favorite?: boolean;
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

// ---------- Verzeichnis ----------

/** Eintrag aus `directory/all-families/`. */
export interface WorldFamily {
  id: number;
  name: string;
  path: string;
  logo?: string | null;
}

/** Treffer aus `directory/search/` (Clubs). */
export interface WorldDirectoryHit {
  id: number;
  name: string;
  path: string;
  logo?: string | null;
}

// ---------- Favoriten ----------

export type FavoriteType = 'member' | 'level';

export interface WorldFavoriteMember {
  id: number;
  first_name: string;
  last_name: string;
  profile_pic_url?: string | null;
  club_path?: string | null;
}

export interface WorldFavoriteLevel {
  id: number;
  name: string;
  logo_url?: string | null;
  path?: string | null;
}

export interface WorldFavorites {
  favorite_members: WorldFavoriteMember[];
  favorite_levels: WorldFavoriteLevel[];
}

// ---------- Eigenes Profil bearbeiten ----------

/** Antwort beim Anlegen (201) von Zweit-E-Mail, Ausbildung oder Beruf. */
export interface WorldCreated {
  id: number;
}

export type PrivacyField =
  | 'education'
  | 'company-position'
  | 'gender'
  | 'birth_date'
  | 'birth_place'
  | `address-${number}`
  | `phone-${number}`
  | `secondary-email-${number}`
  | `custom-field-category-${number}`;

/** `all` setzt `cross_family_optin` voraus. */
export type PrivacyLevel = 'all' | 'public' | 'association' | 'area' | 'club' | 'favorites' | 'private';

/** M = männlich, F = weiblich, U = unbekannt, X = divers. */
export type WorldGender = 'M' | 'F' | 'U' | 'X';

export interface WorldPersonalUpdate {
  title: string;
  first_name: string;
  last_name: string;
  gender: WorldGender;
  birth_place: string;
}

export interface WorldAddress {
  street1: string;
  street2: string;
  /** ISO-3166-1-Alpha-2, z. B. "DE". */
  country_code: string;
  postal_code: string;
  city: string;
}

export interface WorldBillingAddressUpdate {
  /** Rechnungs-E-Mail. */
  email: string;
  address: WorldAddress & { name: string; vat_nr: string };
}

export interface WorldPhoneUpdate {
  home: string;
  mobile: string;
}

export interface WorldSocialMediaUpdate {
  social_media_facebook: string;
  social_media_twitter: string;
  social_media_linkedin: string;
  social_media_instagram: string;
}

export interface WorldSecondaryEmail {
  type: 'home' | 'work' | 'other';
  value: string;
  /** In Mitteilungen in CC setzen. */
  cc: boolean;
}

export interface WorldEducation {
  education_name: string;
  school_name: string;
  address: WorldAddress;
  /** YYYY-MM-DD */
  begin_date: string;
  /** YYYY-MM-DD */
  end_date: string;
  completed: boolean;
}

export interface WorldWork {
  name: string;
  function: string;
  /** Branchencode, z. B. "information-technology" (Liste nicht vollständig dokumentiert). */
  sector: string;
  /** YYYY-MM-DD */
  begin_date: string;
  /** YYYY-MM-DD, null = aktuelle Stelle */
  end_date: string | null;
  address: WorldAddress;
  phone: string;
  email: string;
  website: string;
  vat_nr: string;
}

/**
 * Wert eines eigenen Felds: text/textarea/choices_single/link/date/datetime als string,
 * choices_multi kommagetrennt, int/auto als Zahl, bool als boolean.
 */
export type WorldCustomFieldValue = string | number | boolean;

// ---------- Geolocation ----------

export interface WorldCoords {
  latitude: number;
  longitude: number;
}

export interface WorldLocationName {
  name: string;
  country: string;
}

/** Alle Felder Pflicht; das Geocoding (Ortsname, Land) liefert der Aufrufer. */
export interface WorldLocationUpdate {
  coords: WorldCoords;
  location: WorldLocationName;
  speed: number;
  /** GPS-Genauigkeit in Metern. */
  accuracy: number;
}

export interface WorldNearbyMember {
  member: WorldMemberSummary;
  distance: number;
  speed: number;
  lastseen: string;
  coords: WorldCoords;
  location: WorldLocationName;
}
