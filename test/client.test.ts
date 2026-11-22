import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorldMock, type WorldMock } from '../src/mock/index.js';
import { WorldClient, WorldForbiddenError, WorldUnavailableError } from '../src/client.js';
import { SlidingWindowLimiter } from '../src/limiter.js';
import {
  extractFunctionMatches,
  extractFunctions,
  memberUntilDate,
  myFunctions,
  profilePicUrl,
} from '../src/profile.js';

let mock: WorldMock;
let client: WorldClient;

beforeAll(async () => {
  mock = createWorldMock();
  await mock.listen();
  client = new WorldClient({ baseUrl: mock.baseUrl, sleep: async () => undefined, maxRetries: 2 });
});
afterAll(() => mock.close());

async function adminTokens() {
  const r = await client.login('admin', 'admin', '123456');
  if (r.kind !== 'ok') throw new Error('Login fehlgeschlagen');
  return r.data;
}

describe('WorldClient.login', () => {
  it('meldet falsches Passwort', async () => {
    expect(await client.login('admin', 'falsch')).toEqual({
      kind: 'failed',
      message: 'Invalid username or password',
      code: 'login_failed',
    });
  });

  it('verlangt 2FA und akzeptiert danach den Code', async () => {
    expect(await client.login('admin', 'admin')).toEqual({ kind: 'tfa_required' });
    const ok = await client.login('admin', 'admin', '123456');
    expect(ok.kind).toBe('ok');
    if (ok.kind === 'ok') {
      expect(ok.data.me.id).toBe(1001);
      expect(ok.data.club.name).toBe('RT 1 Hamburg');
    }
  });

  it('sendet tfa_code nur, wenn gesetzt', async () => {
    expect((await client.login('mitglied', 'mitglied')).kind).toBe('ok');
    expect(await client.login('admin', 'admin', '')).toEqual({ kind: 'tfa_required' });
  });

  it('lehnt inaktive Mitglieder ab', async () => {
    const r = await client.login('inaktiv', 'inaktiv');
    expect(r.kind).toBe('failed');
  });
});

describe('WorldClient Daten', () => {
  it('liest Profil, Ämter und Ebenen', async () => {
    const t = await adminTokens();
    const profile = await client.myProfile(t.local_auth_token);
    expect(profilePicUrl(profile)).toBe('https://example.com/pics/1001.jpg');
    expect(memberUntilDate(profile)).toBe('2030-12-31');
    const fns = myFunctions(profile);
    // Abgelaufenes Amt (Sekretär 2020–2021) wird ignoriert.
    expect(fns).toEqual([
      {
        combinationId: 1010,
        label: 'Präsident · Round Table Deutschland',
        startDate: '2025-01-01',
        endDate: null,
      },
    ]);
    const levels = await client.myLevels(t.global_auth_token);
    expect(levels.association?.id).toBe(10);
    expect(levels.area?.id).toBe(20);
  });

  it('nutzt das falsche Token nicht (local vs. global)', async () => {
    const t = await adminTokens();
    await expect(client.myProfile(t.global_auth_token)).rejects.toBeInstanceOf(WorldForbiddenError);
  });

  it('liefert Tische, Mitglieder und Ehrenmitglieder', async () => {
    const t = await adminTokens();
    const clubs = await client.associationClubs(t.global_auth_token, 10);
    expect(clubs).toHaveLength(6);
    const club = await client.level(t.global_auth_token, 104);
    expect(club.members?.length).toBe(4);
    expect(club.honorary_members?.length).toBe(1);
  });

  it('meldet inaktive Mitglieder mit 403', async () => {
    const t = await adminTokens();
    await expect(client.member(t.global_auth_token, 1003)).rejects.toBeInstanceOf(WorldForbiddenError);
    await expect(client.member(t.global_auth_token, 1002)).resolves.toBeTruthy();
  });

  it('wiederholt bei 429 und gibt danach auf', async () => {
    const t = await adminTokens();
    mock.failNext(1);
    await expect(client.myLevels(t.global_auth_token)).resolves.toBeTruthy();
    mock.failNext(10);
    await expect(client.myLevels(t.global_auth_token)).rejects.toBeInstanceOf(WorldUnavailableError);
    mock.failNext(0);
  });

  it('sucht Mitglieder und Veranstaltungen', async () => {
    const t = await adminTokens();
    const page = await client.searchMembers(t.global_auth_token, { query: 'mitglied' });
    expect(page.results.map((m) => m.id)).toContain(1002);
    const events = await client.statutoryEvents(t.global_auth_token);
    expect(events.results.length).toBeGreaterThan(0);
  });
});

describe('SlidingWindowLimiter', () => {
  it('wartet, wenn das Fenster voll ist', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const limiter = new SlidingWindowLimiter(
      2,
      1000,
      () => now,
      async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    );
    await limiter.acquire('a');
    await limiter.acquire('a');
    await limiter.acquire('b');
    expect(sleeps).toEqual([]);
    await limiter.acquire('a');
    expect(sleeps.length).toBe(1);
    expect(now).toBeGreaterThanOrEqual(1000);
  });
});

describe('extractFunctions', () => {
  const today = '2026-06-15';
  const entry = (id: number, start: string | null, end: string | null) => ({
    combination: { id, name: `Kombi ${id}` },
    start_date: start,
    end_date: end,
  });

  it('zählt nur Einträge, deren Zeitraum heute einschließt', () => {
    const groups = {
      groups: [
        entry(1, '2026-01-01', '2026-12-31'),
        entry(2, '2020-01-01', '2021-12-31'),
        entry(3, '2027-01-01', null),
        entry(4, null, null),
        entry(5, '2026-06-15', '2026-06-15'),
      ],
    };
    expect(extractFunctions(groups, today).map((f) => f.combinationId)).toEqual([1, 4, 5]);
    expect(extractFunctionMatches(groups, today).map((m) => m.status)).toEqual([
      'current',
      'past',
      'future',
      'current',
      'current',
    ]);
  });
  it('ignoriert Einträge ohne combination und doppelte Kombinationen', () => {
    const groups = [{ name: 'Golf', start_date: null }, entry(7, null, null), entry(7, null, null)];
    expect(extractFunctions(groups, today)).toEqual([
      { combinationId: 7, label: 'Kombi 7', startDate: null, endDate: null },
    ]);
  });
});

describe('WorldClientOptions', () => {
  it('nutzt Standard-URL und Familie 0, beides überschreibbar', async () => {
    const seen: { url: string; body: unknown }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ code: 'tfa_required' }), { status: 400 });
    }) as unknown as typeof fetch;

    await new WorldClient({ fetch: fakeFetch }).login('a', 'b');
    await new WorldClient({ fetch: fakeFetch, baseUrl: 'http://x.test/api/', family: 2 }).login('a', 'b');

    expect(seen[0]).toEqual({
      url: 'https://api.roundtable.world/v1/app/login/',
      body: { username: 'a', password: 'b', sync_family: 0 },
    });
    expect(seen[1]).toEqual({
      url: 'http://x.test/api/login/',
      body: { username: 'a', password: 'b', sync_family: 2 },
    });
  });
});
