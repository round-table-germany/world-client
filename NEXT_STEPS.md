# Nächste Schritte: Abdeckung der .WORLD-API

Abgleich von `v1.0.0` mit der offiziellen Doku (Postman-Collection hinter
[developer.roundtable.world](https://developer.roundtable.world/), Stand 22.11.2026; JSON:
`https://developer.roundtable.world/api/collections/51170267/2sBXVfhqSi?segregateAuth=true&versionTag=latest`).

**Stand: 10 von 42 dokumentierten Endpunkten sind umgesetzt.** Es fehlen 32 Endpunkte und einige Querschnittsthemen
(eigene Drossel für Geolocation, Multipart-Upload, Paginierung, unvollständige Typen).

## Bereits abgedeckt

| Endpunkt                                     | Methode im Client    | Mock |
| -------------------------------------------- | -------------------- | ---- |
| `POST login/`                                | `login()`            | ✓    |
| `GET my-profile/` (lokales Token)            | `myProfile()`        | ✓    |
| `GET my-levels/`                             | `myLevels()`         | ✓    |
| `GET members/config/functions/`              | `functionsConfig()`  | ✓    |
| `POST members/search/`                       | `searchMembers()`    | ✓    |
| `GET members/:id/`                           | `member()`           | ✓    |
| `GET directory/:level_id/`                   | `level()`            | ✓    |
| `GET directory/association-clubs/:level_id/` | `associationClubs()` | ✓    |
| `POST events/search/`                        | `searchEvents()`     | ✓    |
| `POST events/statutory/`                     | `statutoryEvents()`  | ✓    |

## Fehlende Endpunkte

Vorschlag zur Reihenfolge: zuerst die rein lesenden Endpunkte (1–3), dann Favoriten und Profilpflege, zuletzt
Geolocation. Jeder neue Endpunkt bekommt eine Methode, Typen, eine Route im Mock und einen Test.

### 1. Verzeichnis (globales Token, lesend)

- [ ] `GET directory/all-families/`: alle Familien (`id`, `name`, `path`, `logo`). Selten geändert → lange cachen.
- [ ] `POST directory/search/` `{ query }`: Clubs nach Namen, paginiert (25 pro Seite), Ergebnis `id`, `name`,
      `logo`, `path`.
- [ ] `GET directory/query/:level_ids/`: Kurzinfos für mehrere Ebenen auf einmal (IDs kommagetrennt). Laut Doku „live,
      aber nicht vollständig dokumentiert“ → Antwort zunächst als `unknown` liefern und gegen echte Daten prüfen. Lohnt
      sich für Massenabfragen, weil es viele `directory/:id/`-Aufrufe (Rate-Limit) spart.

### 2. Veranstaltungen (globales Token, lesend)

- [ ] `GET events/highlighted/`: bis zu 3 hervorgehobene kommende Veranstaltungen (`{ results: Event[] }`, nicht
      paginiert).
- [ ] `POST events/list/` `{ query }`: Standardliste (kommende 12 Monate, eigene Assoziation), 10 pro Seite. Der Mock
      kennt die Route schon, der Client nicht.
- [ ] `POST events/attending/` `{ query }`: Veranstaltungen, zu denen der Nutzer angemeldet ist (−50 bis +400 Tage),
      10 pro Seite.

### 3. Benachrichtigungen

- [ ] `POST notifications/birthday/` `{ enabled }`: Geburtstagshinweise für Favoriten ein/aus.

### 4. Favoriten (globales Token)

- [ ] `GET favorites/`: `favorite_members[]` (`id`, `first_name`, `last_name`, `profile_pic_url`, `club_path`) und
      `favorite_levels[]` (`id`, `name`, `logo_url`, `path`).
- [ ] `POST favorites/:type/:id/` (`type` = `member` | `level`): Favorit hinzufügen.
- [ ] `DELETE favorites/:type/:id/`: Favorit entfernen.

### 5. Eigenes Profil bearbeiten (lokales Token, `update-profile/…`)

Alle Aufrufe brauchen das `local_auth_token`. Bei Fehlern antwortet .WORLD mit `400 { code, error_message }`.

- [ ] `POST update-profile/cross-family-sharing/` `{ enabled }`
- [ ] `POST update-profile/privacy-settings/` `{ field, level }`
  - `field`: `education`, `company-position`, `gender`, `birth_date`, `birth_place`, `address-<id>`, `phone-<id>`,
    `secondary-email-<id>`, `custom-field-category-<id>`
  - `level`: `all` (nur mit `cross_family_optin`), `public`, `association`, `area`, `club`, `favorites`, `private`
  - → Typen `PrivacyField` und `PrivacyLevel`
- [ ] `POST update-profile/edit/personal/` `{ title, first_name, last_name, gender (M|F|U|X), birth_place }`
- [ ] `POST update-profile/edit/address/` `{ street1, street2, country_code, postal_code, city }`
- [ ] `POST update-profile/edit/billing-address/` `{ email, address: { name, street1, street2, country_code, postal_code, city, vat_nr } }`
- [ ] `POST update-profile/edit/phone/` `{ home, mobile }`
- [ ] `POST update-profile/edit/primary-email/` `{ email }`: löst eine Bestätigungs-Mail aus; `400`, wenn die Adresse
      schon vergeben ist.
- [ ] `POST update-profile/edit/profile-pic/`: **multipart/form-data** mit Feld `profile_pic` (JPG/PNG, wird auf
      640×640 verkleinert). Dafür muss `raw()` neben JSON auch `FormData` senden können (kein `Content-Type` setzen).
- [ ] `POST update-profile/edit/social-media/` `{ social_media_facebook, social_media_twitter, social_media_linkedin, social_media_instagram }`
- [ ] Zweit-E-Mails: `POST update-profile/secondary-emails/` (→ `201 { id }`), `PUT …/secondary-emails/:id/`,
      `DELETE …/secondary-emails/:id/`; Body `{ type (home|work|other), value, cc }`
- [ ] Ausbildung: `POST update-profile/education/` (→ `201 { id }`), `PUT …/education/:id/`, `DELETE …/education/:id/`;
      Body `{ education_name, school_name, address, begin_date, end_date, completed }`
- [ ] Beruf: `POST update-profile/work/` (→ `201 { id }`), `PUT …/work/:id/`, `DELETE …/work/:id/`; Body
      `{ name, function, sector, begin_date, end_date|null, address, phone, email, website, vat_nr }`. Die
      Branchencodes (`sector`, z. B. `information-technology`) sind nicht vollständig dokumentiert, deshalb vorerst als
      `string` typisieren.
- [ ] `POST update-profile/custom-field/:id/` `{ value }`: Wertformat je Feldtyp (`text`, `textarea`, `choices_single`,
      `choices_multi` kommagetrennt, `date`, `datetime`, `int`, `auto`, `bool`, `link`); die Optionen stehen in
      `options` des Felds aus `GET my-profile/`.

### 6. Geolocation (eigenes Rate-Limit: 8 Anfragen / Token / Minute)

- [ ] `POST geolocation/set-permission/` `{ enabled }`
- [ ] `POST geolocation/update-location/`
      `{ coords: { latitude, longitude }, location: { name, country }, speed, accuracy }`: alles Pflicht; das
      Geocoding (Ortsname, Land) muss der Aufrufer liefern.
- [ ] `GET geolocation/nearby-members/`: bis zu 20 Mitglieder im Umkreis von 100 km (`member`, `distance`, `speed`,
      `lastseen`, `coords`, `location`). `403`, wenn keine Freigabe besteht oder keine Position der letzten 7 Tage.

## Querschnittsthemen

### Client-Infrastruktur

- [ ] **Zweite Drossel für Geolocation** mit 8 Anfragen pro Minute, getrennt vom Standard-Limit (90 von 100). Option
      `geolocationRequestsPerMinute`.
- [ ] **Hilfsmethoden `put()` und `delete()`** und Behandlung leerer Antworten (`204`, `201` mit `{ id }`).
- [ ] **Keine automatische Wiederholung bei schreibenden Aufrufen**: Ein `POST`, der etwas anlegt (Zweit-E-Mail,
      Ausbildung, Beruf, Favorit), darf bei 502/503/504 nicht erneut gesendet werden, sonst droht ein Duplikat.
      Wiederholung nur bei 429 oder bei lesenden Aufrufen. Heute gilt die Ausnahme nur für `login/`.
- [ ] **Fehlercode durchreichen**: `request()` setzt `WorldApiError.code` bisher nie. Für `400` sollen `code` und
      `error_message` aus der Antwort übernommen werden (z. B. E-Mail schon vergeben). `login()` liefert bei
      `failed` ebenfalls den `code` (`login_failed`).
- [ ] **Paginierung**: Ein Async-Iterator (z. B. `for await (const m of world.paginate(...))`) über `next`/`offset`
      für Mitgliedersuche, Verzeichnissuche und Veranstaltungslisten. Optional ein `limit`-Parameter, wo die API
      LimitOffsetPagination erlaubt.
- [ ] **Cache leeren nach Schreibzugriffen**, die gecachte Daten betreffen (z. B. `level:<id>`).
- [ ] **Konstante `DEMO_BASE_URL`** = `https://api.roundtable-demo.world/v1/app/`.
- [ ] Optional: englische Fehlermeldungen oder ein austauschbarer Meldungstext, damit 41er, LC, Agora und Tangent das
      Paket nutzen können. Aufrufer sollen weiterhin auf Klasse, `status` und `code` prüfen.

### Typen ergänzen (laut Doku vorhanden, bisher nicht typisiert)

- [ ] `Family`-Konstanten (0 Round Table, 1 41 Club, 2 Ladies Circle, 3 Agora Club, 4 Tangent Club) und `SyncLevel`
      (1 Club, 2 Area, 3 Association, 4 Family).
- [ ] `WorldMe`: `cross_family_optin`, `geolocation_optin`.
- [ ] `WorldMyProfile`: `cross_family_optin`, `privacy_settings[] { type, level }`; Kategorie: `display_order`,
      `can_edit`.
- [ ] `WorldMemberSummary`: `is_favorite`.
- [ ] `WorldLevelDetails`: `hostname`, `details` (Logo, Kontakt, Bio, Social), `board_assistants`.
- [ ] `WorldEvent`: `internal_type` (announcement|internal|external|sale), `cover_picture_url`, `external_url`,
      `has_signup`, `signup_start_date`, `signup_deadline`, `signup_status` (0 abwesend, 1 anwesend, null offen),
      `is_registration_active`.
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

### Mock und Tests

- [ ] Für jeden neuen Endpunkt eine Route im Mock: Zustand im Speicher, damit Anlegen, Ändern und Löschen sich prüfen
      lassen, und die Prüfung lokal/global wie bei `my-profile/`.
- [ ] Das Geolocation-Limit (8/min) im Mock nachbilden, damit die zweite Drossel testbar ist.
- [ ] `400 { code, error_message }` für Validierungsfehler im Mock (z. B. doppelte Primär-E-Mail).
- [ ] Die Mock-Daten an die Beispielantworten der Doku angleichen (z. B. `is_favorite`, Event-Felder).

## Offene Fragen an .WORLD

- Aufbau von `board` in `directory/:level_id/` ist nur als „Board members“ beschrieben (`parseBoard` rät mehrere
  Formen).
- Antwortformat von `directory/query/:level_ids/`.
- Vollständige Liste der Branchencodes (`sector`, `job_sector`).
- Ob die übrigen paginierten Endpunkte ein frei wählbares `limit` akzeptieren.
