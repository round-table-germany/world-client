# Nächste Schritte: Abdeckung der .WORLD-API

Abgleich mit der offiziellen Doku (Postman-Collection hinter
[developer.roundtable.world](https://developer.roundtable.world/), Stand 22.11.2026; JSON:
`https://developer.roundtable.world/api/collections/51170267/2sBXVfhqSi?segregateAuth=true&versionTag=latest`).

**Stand: alle 42 dokumentierten Endpunkte sind umgesetzt**, jeweils mit Methode, Typen, Mock-Route (Zustand im
Speicher) und Test. Offen sind noch Typen und Auswertungshilfen, die keine eigenen Endpunkte sind.

## Endpunkte

| Bereich                          | Endpunkte                                                                                                                                                                                                                                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login, eigene Daten              | `login()`, `myProfile()`, `myLevels()`                                                                                                                                                                                                                                                                                  |
| Mitglieder                       | `searchMembers()`, `member()`, `functionsConfig()`                                                                                                                                                                                                                                                                      |
| Verzeichnis                      | `level()`, `associationClubs()`, `allFamilies()`, `searchDirectory()`, `queryLevels()`                                                                                                                                                                                                                                  |
| Veranstaltungen                  | `searchEvents()`, `statutoryEvents()`, `listEvents()`, `attendingEvents()`, `highlightedEvents()`                                                                                                                                                                                                                       |
| Benachrichtigungen               | `setBirthdayNotifications()`                                                                                                                                                                                                                                                                                            |
| Favoriten                        | `favorites()`, `addFavorite()`, `removeFavorite()`                                                                                                                                                                                                                                                                      |
| Profil bearbeiten (lokal. Token) | `setCrossFamilySharing()`, `setPrivacy()`, `updatePersonal()`, `updateAddress()`, `updateBillingAddress()`, `updatePhone()`, `updatePrimaryEmail()`, `updateProfilePic()`, `updateSocialMedia()`, `add/update/deleteSecondaryEmail()`, `add/update/deleteEducation()`, `add/update/deleteWork()`, `updateCustomField()` |
| Geolocation                      | `setGeolocationPermission()`, `updateLocation()`, `nearbyMembers()`                                                                                                                                                                                                                                                     |

Umgesetzte Querschnittsthemen: zweite Drossel für `geolocation/…` (Option `geolocationRequestsPerMinute`, Standard
8; zählt zusätzlich zum Standard-Limit), `put()`/`delete()` und leere Antworten (`204`, `201`), keine Wiederholung
schreibender Aufrufe bei 5xx oder Netzfehlern (nur bei 429), `code`/`error_message` in `WorldApiError` (auch
`login()` liefert `code`), `paginate()` als Async-Iterator, Leeren des Ebenen-Caches nach Favoriten- und
Profiländerungen, `DEMO_BASE_URL`, `FormData`-Upload für das Profilbild. Der Mock bildet das Geolocation-Limit und
`400 { code, error_message }` nach.

## Offen

### Typen ergänzen (laut Doku vorhanden, bisher nicht typisiert)

- [ ] `Family`-Konstanten (0 Round Table, 1 41 Club, 2 Ladies Circle, 3 Agora Club, 4 Tangent Club) und `SyncLevel`
      (1 Club, 2 Area, 3 Association, 4 Family).
- [ ] `WorldLevelDetails`: `hostname`, `details` (Logo, Kontakt, Bio, Social), `board_assistants`.
- [ ] `WorldEvent`: `internal_type` (announcement|internal|external|sale), `cover_picture_url`, `external_url`,
      `has_signup`, `signup_start_date`, `signup_deadline`, `signup_status` (0 abwesend, 1 anwesend, null offen),
      `is_registration_active`. Der Mock liefert diese Felder bereits.
- [ ] `EventType`-Union: `club_agm`, `hym`, `wm`, `agm`, `number`, `family`, `special-onetime`, `special-regularly`,
      `as-statutory`, `statutory`, `zone`.
- [ ] `member()` liefert heute `Record<string, unknown>`. Besser ein Typ `WorldMemberProfile` (wie `WorldMyProfile`,
      aber nach Datenschutz gefiltert; `billing_address` und `email_private` sind immer `null`).

### Auswertungshilfen für das Profil

Bisher werden nur `profile_pic`, Mitgliedsdaten aus `personal` und Ämter aus `groups` ausgewertet. Es fehlen
Hilfsfunktionen für:

- [ ] `personal`: Titel, Name, Geschlecht, Geburtsdatum und -ort
- [ ] `profile_pic`: Social-Media-URLs
- [ ] `address`: Wohn- und Rechnungsadresse, Telefone, E-Mails (inkl. der IDs für die Datenschutz-Felder)
- [ ] `work`, `education` und `relations`: Listen
- [ ] `custom-<id>`: eigene Felder samt Typ und Optionen

Der Aufbau von `address`, `work`, `education` und `custom-<id>` im Mock ist angenommen und muss gegen echte Daten
geprüft werden, bevor diese Hilfen entstehen.

### Sonstiges

- [ ] Optional: englische Fehlermeldungen oder ein austauschbarer Meldungstext, damit 41er, LC, Agora und Tangent das
      Paket nutzen können. Aufrufer sollen weiterhin auf Klasse, `status` und `code` prüfen.
- [ ] Gegen die Demo-Umgebung (`DEMO_BASE_URL`) prüfen: Antwortcodes der schreibenden Aufrufe (der Mock antwortet mit
      `200 {}`, `201` bzw. `204`), Fehlercodes (der Mock nutzt `email_in_use`, `cross_family_required`,
      `invalid_input`), ob `set-permission/` ebenfalls unter das Geolocation-Limit fällt (der Client drosselt es
      vorsichtshalber mit).

## Offene Fragen an .WORLD

- Aufbau von `board` in `directory/:level_id/` ist nur als „Board members“ beschrieben (`parseBoard` rät mehrere
  Formen).
- Antwortformat von `directory/query/:level_ids/` (`queryLevels()` liefert vorerst `unknown`).
- Vollständige Liste der Branchencodes (`sector`, `job_sector`).
- Ob die übrigen paginierten Endpunkte ein frei wählbares `limit` akzeptieren.
- Fehlercodes (`code`) der Profil-Endpunkte, z. B. bei bereits vergebener Primär-E-Mail.
