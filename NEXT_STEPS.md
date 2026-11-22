# Nächste Schritte: Abdeckung der .WORLD-API

Abgleich mit der offiziellen Doku (Postman-Collection hinter
[developer.roundtable.world](https://developer.roundtable.world/), Stand 22.11.2026; JSON:
`https://developer.roundtable.world/api/collections/51170267/2sBXVfhqSi?segregateAuth=true&versionTag=latest`).

**Stand: alle 42 dokumentierten Endpunkte sind umgesetzt**, jeweils mit Methode, Typen, Mock-Route (Zustand im
Speicher) und Test. Alle in der Doku beschriebenen Felder sind typisiert. Offen sind noch Auswertungshilfen für das
Profil.

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

Typisierung: Konstanten `Family`, `SyncLevel` und `EVENT_TYPES` (zugleich Typen, `EventType`), `sync_family`/
`sync_level` als Literal-Typen, vollständige Felder von `WorldEvent`, `WorldLevelDetails`, `WorldMemberSearch` und
`WorldEventSearch`, `WorldMemberProfile` als Rückgabe von `member()`. Codes, die .WORLD erweitern könnte
(`event_type`, `internal_type`), sind als `KnownOr<…>` typisiert: bekannte Werte mit Autovervollständigung, andere
Strings bleiben erlaubt. Der Mock ist gegen diese Typen geprüft (`satisfies`/Rückgabetypen).

## Offen

### Typen, die erst mit echten Daten genauer werden

- [ ] `WorldLevelDetails.details` (Logo, Kontakt, Bio, Social), `board` und `board_assistants`: Feldnamen nicht
      dokumentiert, daher `Record<string, unknown>` bzw. `unknown[]`.
- [ ] `WorldProfileCategory.values` ist `unknown`. Eine nach `code` unterschiedene Union (`profile_pic`, `personal`,
      `address`, …) entsteht zusammen mit den Auswertungshilfen unten.
- [ ] `shared_with_type` der Veranstaltungen (Werte nicht dokumentiert, vermutlich `club`/`area`/`association`/…).

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
