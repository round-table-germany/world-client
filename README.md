# @round-table-germany/world-client

TypeScript-Client für die .WORLD-App-API von Round Table (`https://api.roundtable.world/v1/app/`,
Doku: developer.roundtable.world) – mit Drossel pro Token, Wiederholung bei 429/5xx, Zeitlimit und Cache,
Auswertung von Profil (Ämter, Profilbild, Mitgliedszeitraum) und Vorstandslisten sowie einem Mock-Server für Tests.

Node.js ≥ 22.13, ESM, keine Laufzeitabhängigkeiten (eingebautes `fetch`).

Abgedeckt sind alle 42 dokumentierten Endpunkte (Login, Profil lesen und bearbeiten, Ebenen, Mitglieder,
Verzeichnis, Veranstaltungen, Favoriten, Benachrichtigungen, Geolocation). Was noch offen ist, steht in
[NEXT_STEPS.md](NEXT_STEPS.md).

## Installation

```json
"dependencies": {
  "@round-table-germany/world-client": "github:round-table-germany/world-client#v1.0.0"
}
```

Beim Installieren aus GitHub baut npm das Paket über das `prepare`-Skript.

## Verwendung

```ts
import {
  Family,
  WorldClient,
  WorldForbiddenError,
  myFunctions,
  parseBoard,
} from '@round-table-germany/world-client';

const world = new WorldClient({
  // alle Angaben optional
  baseUrl: 'https://api.roundtable.world/v1/app/', // muss mit "/" enden
  family: Family.RoundTable, // sync_family beim Login (0 = Round Table)
  requestsPerMinute: 90, // pro Token, API-Limit 100
  log: (msg, data) => console.info(msg, data),
});

const res = await world.login(username, password, tfaCode);
if (res.kind === 'tfa_required') {
  /* 2FA-Code abfragen und login() erneut aufrufen */
}
if (res.kind === 'ok') {
  const { global_auth_token, local_auth_token, me } = res.data;
  const profile = await world.myProfile(local_auth_token); // my-profile braucht das lokale Token
  const functions = myFunctions(profile); // aktuell gültige Ämter
  const club = await world.level(global_auth_token, me.level_id);
  const board = parseBoard(club.board);
}
```

Weitere Beispiele:

```ts
// Alle Seiten eines paginierten Endpunkts durchlaufen
for await (const m of world.paginate((offset) =>
  world.searchMembers(global_auth_token, { query: 'Max' }, offset),
)) {
  console.log(m.first_name, m.last_name);
}

// Profil bearbeiten (lokales Token); Anlegen liefert die neue ID
const { id } = await world.addSecondaryEmail(local_auth_token, {
  type: 'work',
  value: 'max@firma.de',
  cc: false,
});
await world.setPrivacy(local_auth_token, `secondary-email-${id}`, 'club');
await world.updateProfilePic(local_auth_token, new Blob([jpegBytes], { type: 'image/jpeg' }), 'ich.jpg');

// Favoriten und Geolocation (globales Token)
await world.addFavorite(global_auth_token, 'member', 12345);
await world.setGeolocationPermission(global_auth_token, true);
await world.updateLocation(global_auth_token, {
  coords: { latitude: 53.55, longitude: 9.99 },
  location: { name: 'Hamburg', country: 'Germany' }, // Geocoding macht der Aufrufer
  speed: 0,
  accuracy: 10,
});
const nearby = await world.nearbyMembers(global_auth_token);
```

Drossel und Wiederholung: Standardmäßig höchstens 90 Anfragen pro Token und Minute, für `geolocation/…` zusätzlich
höchstens 8 (`geolocationRequestsPerMinute`). Lesende Aufrufe werden bei 429, 502/503/504 und Netzfehlern
wiederholt, schreibende nur bei 429 (sonst drohen Duplikate), der Login nie. Für Tests gegen die Demo-Umgebung gibt
es `DEMO_BASE_URL`.

Fehler: `WorldForbiddenError` (401/403: Token ungültig, Mitglied inaktiv, kein Zugriff), `WorldUnavailableError`
(nicht erreichbar, Zeitüberschreitung, 429/5xx nach Wiederholungen), sonst `WorldApiError` mit `status` und – bei
Validierungsfehlern (400) – dem `code` von .WORLD (z. B. Primär-E-Mail schon vergeben).
Auf Klasse, `status` und `code` prüfen, nicht auf den Text.

## Mock für Tests und Entwicklung

`fastify` (≥ 5) als devDependency installieren, dann:

```ts
import { createWorldMock } from '@round-table-germany/world-client/mock';

const mock = createWorldMock();
await mock.listen();
const world = new WorldClient({ baseUrl: mock.baseUrl, sleep: async () => {} });
// …
await mock.close();
```

Als eigenständiger Server: `npx world-mock` (Port 4010 bzw. `WORLD_MOCK_PORT`).
Test-Zugänge: `admin/admin` (2FA-Code `123456`), `mitglied/mitglied`, `inaktiv/inaktiv`.

## Entwicklung

```bash
npm run build      # tsc → dist/
npm test
npm run typecheck
```

## Release

Version in `package.json` anheben (SemVer), committen und taggen – Projekte binden den Tag ein:

```bash
npm version minor            # erzeugt Commit und Tag vX.Y.Z
git push --follow-tags
```
