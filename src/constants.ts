/** Konstanten der .WORLD-API (Werte und gleichnamige Typen). */

/** Familie einer Ebene bzw. eines Mitglieds (`sync_family`). */
export const Family = {
  RoundTable: 0,
  FortyOneClub: 1,
  LadiesCircle: 2,
  AgoraClub: 3,
  TangentClub: 4,
} as const;
export type Family = (typeof Family)[keyof typeof Family];

/** Stufe einer Ebene in der Hierarchie (`sync_level`). */
export const SyncLevel = {
  Club: 1,
  Area: 2,
  Association: 3,
  Family: 4,
} as const;
export type SyncLevel = (typeof SyncLevel)[keyof typeof SyncLevel];

/** Veranstaltungsarten (`event_type`) laut Doku. */
export const EVENT_TYPES = [
  'club_agm', // Jahreshauptversammlung Club
  'hym', // Halbjahrestreffen
  'wm', // internationale AGM
  'agm', // nationale AGM
  'number', // Tischabend
  'family', // gesellige Veranstaltung
  'special-onetime', // Sonderveranstaltung (einmalig)
  'special-regularly', // Sonderveranstaltung (regelmäßig)
  'as-statutory', // satzungsgemäße Versammlung (Assoziation)
  'statutory', // satzungsgemäße Versammlung (Club)
  'zone', // Zonentreffen
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
