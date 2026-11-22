# @round-table-germany/world-client

TypeScript-Client für die .WORLD-App-API von Round Table (`https://api.roundtable.world/v1/app/`,
Doku: developer.roundtable.world) – mit Drossel pro Token, Wiederholung bei 429/5xx, Zeitlimit und Cache,
Auswertung von Profil (Ämter, Profilbild, Mitgliedszeitraum) und Vorstandslisten sowie einem Mock-Server für Tests.

Node.js ≥ 22.13, ESM, keine Laufzeitabhängigkeiten (eingebautes `fetch`).

## Installation

```json
"dependencies": {
  "@round-table-germany/world-client": "github:round-table-germany/world-client#v1.0.0"
}
```

Beim Installieren aus GitHub baut npm das Paket über das `prepare`-Skript.

## Verwendung

```ts
import { WorldClient, WorldForbiddenError, myFunctions, parseBoard } from '@round-table-germany/world-client';

const world = new WorldClient({
  // alle Angaben optional
  baseUrl: 'https://api.roundtable.world/v1/app/', // muss mit "/" enden
  family: 0, // sync_family beim Login, 0 = Round Table
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

Fehler: `WorldForbiddenError` (401/403: Token ungültig, Mitglied inaktiv, kein Zugriff), `WorldUnavailableError`
(nicht erreichbar, Zeitüberschreitung, 429/5xx nach Wiederholungen), sonst `WorldApiError` mit `status`.
Auf Klasse und `status` prüfen, nicht auf den Text.

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
