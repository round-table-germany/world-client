/** Typen der .WORLD-API (Doku: developer.roundtable.world). */

import type { EventType, Family, SyncLevel } from './constants.js';

/**
 * Bekannte Werte als Vorschlag, andere Strings bleiben erlaubt (für Codes, die .WORLD später ergänzt).
 * `string & {}` verhindert, dass TypeScript die Union zu `string` zusammenfasst.
 */
export type KnownOr<T extends string> = T | (string & {});

export interface WorldLevelRef {
  id: number;
  name: string;
  path?: string;
  logo?: string | null;
  subdomain?: string;
  sync_family?: Family;
  sync_level?: SyncLevel;
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

/**
 * Profil eines anderen Mitglieds (`members/:id/`): Aufbau wie `my-profile/`, aber nach den Datenschutz-Einstellungen
 * des Mitglieds gefiltert – nur freigegebene Felder, `billing_address` und `email_private` sind immer `null`.
 */
export interface WorldMemberProfile {
  profile_categories: WorldProfileCategory[];
}

/** Eigenes Profil (`my-profile/`). */
export interface WorldMyProfile extends WorldMemberProfile {
  cross_family_optin?: boolean;
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
  /** Vollständiger Hostname, z. B. "92-be.roundtable.world". */
  hostname?: string;
  sync_parent?: number | null;
  children?: WorldLevelRef[];
  /** Logo, Kontakt, Bio und Social Media der Ebene; Feldnamen nicht dokumentiert. */
  details?: Record<string, unknown> | null;
  /** Vorstand der Ebene; Aufbau nicht dokumentiert (Auswertung mit parseBoard()). */
  board?: unknown[];
  /** Vorstandsassistenten; Aufbau nicht dokumentiert. */
  board_assistants?: unknown[];
  /** Nur bei Clubs. */
  members?: WorldMemberSummary[];
  /** Nur bei Clubs. */
  honorary_members?: WorldMemberSummary[];
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

/** Art des Eintrags im Kalender. */
export type EventInternalType = 'announcement' | 'internal' | 'external' | 'sale';

/** Rückmeldung zur Veranstaltung: 0 = abwesend, 1 = anwesend, null = keine Antwort. */
export type EventSignupStatus = 0 | 1 | null;

export interface WorldEvent {
  id: number;
  name: string;
  /** HTML. */
  description?: string | null;
  internal_type?: KnownOr<EventInternalType> | null;
  /** ISO-Datum mit Uhrzeit. */
  start_date?: string | null;
  /** ISO-Datum mit Uhrzeit. */
  end_date?: string | null;
  cover_picture_url?: string | null;
  event_type?: KnownOr<EventType> | null;
  /** Ausrichtender Club bzw. ausrichtende Ebene. */
  club?: { id: number; name: string } | null;
  /** Sichtbarkeit, z. B. "area" oder "association". */
  shared_with_type?: string | null;
  shared_with_level?: WorldLevelRef | null;
  /** Persönlicher Link des Nutzers zur Veranstaltung. */
  external_url?: string | null;
  /** Anmeldung möglich. */
  has_signup?: boolean;
  signup_start_date?: string | null;
  signup_deadline?: string | null;
  signup_status?: EventSignupStatus;
  /** Anmeldung derzeit offen. */
  is_registration_active?: boolean;
}

export interface WorldEventSearch {
  /** Name, ohne Groß-/Kleinschreibung. */
  query?: string;
  /** YYYY-MM-DD (Standard: heute). */
  start_date?: string | null;
  /** YYYY-MM-DD (Standard: heute + 400 Tage). */
  end_date?: string | null;
  /** Genau diese ausrichtende Ebene. */
  organising_level?: number | null;
  /** Alle Ebenen unterhalb dieser Ebene (Club, Distrikt, Assoziation oder Familie). */
  organising_region?: number | null;
  organising_sync_level?: SyncLevel | SyncLevel[] | null;
  event_type?: KnownOr<EventType> | null;
}

export interface WorldMemberSearch {
  /** Textsuche im Namen. */
  query?: string;
  level?: number | null;
  club_number?: string | null;
  /** Branchencode, z. B. "information-technology". */
  job_sector?: string | null;
  job_function?: string | null;
  phone?: string | null;
  city?: string | null;
  /** Amt (Name aus functionsConfig()). */
  function_name?: string | null;
  /** YYYY-MM-DD: Amt gehalten ab … */
  function_between_start?: string | null;
  /** YYYY-MM-DD: … bis */
  function_between_end?: string | null;
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

/** Feldtypen eigener Felder (`custom-<id>`). */
export type WorldCustomFieldType =
  | 'text'
  | 'textarea'
  | 'choices_single'
  | 'choices_multi'
  | 'date'
  | 'datetime'
  | 'int'
  | 'auto'
  | 'bool'
  | 'link';

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
