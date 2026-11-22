import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createWorldMock, type WorldMock } from '../src/mock/index.js';
import { WorldApiError, WorldClient, WorldForbiddenError, WorldUnavailableError } from '../src/client.js';
import type { WorldEducation, WorldLoginSuccess, WorldMemberProfile, WorldWork } from '../src/types.js';

let mock: WorldMock;
let client: WorldClient;

beforeAll(async () => {
  mock = createWorldMock();
  await mock.listen();
  client = new WorldClient({ baseUrl: mock.baseUrl, sleep: async () => undefined, maxRetries: 2 });
});
afterAll(() => mock.close());

async function login(user: 'admin' | 'mitglied'): Promise<WorldLoginSuccess> {
  const r = await client.login(user, user, user === 'admin' ? '123456' : undefined);
  if (r.kind !== 'ok') throw new Error('Login fehlgeschlagen');
  return r.data;
}

const category = (p: WorldMemberProfile, code: string) =>
  p.profile_categories.find((c) => c.code === code)?.values as Record<string, unknown>;

const address = {
  street1: 'Hauptstr. 1',
  street2: '',
  country_code: 'DE',
  postal_code: '20095',
  city: 'Hamburg',
};

describe('Verzeichnis', () => {
  it('liefert alle Familien und cacht sie', async () => {
    const t = await login('admin');
    const before = mock.calls.get('/v1/app/directory/all-families/') ?? 0;
    const families = await client.allFamilies(t.global_auth_token);
    await client.allFamilies(t.global_auth_token);
    expect(families.map((f) => f.path)).toContain('41');
    expect(mock.calls.get('/v1/app/directory/all-families/')).toBe(before + 1);
  });

  it('sucht Clubs nach Namen', async () => {
    const t = await login('admin');
    const page = await client.searchDirectory(t.global_auth_token, 'kiel');
    expect(page.results).toEqual([{ id: 102, name: 'RT 2 Kiel', logo: null, path: 'rt/de/2' }]);
  });

  it('fragt mehrere Ebenen auf einmal ab', async () => {
    const t = await login('admin');
    const res = (await client.queryLevels(t.global_auth_token, [101, 20])) as { id: number }[];
    expect(res.map((l) => l.id)).toEqual([101, 20]);
    expect(await client.queryLevels(t.global_auth_token, [])).toEqual([]);
  });
});

describe('Veranstaltungen', () => {
  it('liefert hervorgehobene, Standard- und angemeldete Veranstaltungen', async () => {
    const t = await login('admin');
    const highlighted = await client.highlightedEvents(t.global_auth_token);
    expect(highlighted.map((e) => e.id)).toEqual([502]);
    const list = await client.listEvents(t.global_auth_token, 'tisch');
    expect(list.results.map((e) => e.id)).toEqual([503]);
    const attending = await client.attendingEvents(t.global_auth_token);
    expect(attending.results.map((e) => e.id)).toEqual([502]);
    const other = await login('mitglied');
    expect((await client.attendingEvents(other.global_auth_token)).results).toEqual([]);
  });
});

describe('Benachrichtigungen', () => {
  it('schaltet Geburtstagshinweise', async () => {
    const t = await login('admin');
    await expect(client.setBirthdayNotifications(t.global_auth_token, true)).resolves.toBeUndefined();
  });
});

describe('Favoriten', () => {
  it('fügt Mitglieder und Ebenen hinzu und entfernt sie wieder', async () => {
    const t = await login('admin');
    const g = t.global_auth_token;
    await client.addFavorite(g, 'member', 1002);
    await client.addFavorite(g, 'level', 20);
    let favs = await client.favorites(g);
    expect(favs.favorite_members).toEqual([
      {
        id: 1002,
        first_name: 'Max',
        last_name: 'Mitglied',
        profile_pic_url: 'https://example.com/pics/1002.jpg',
        club_path: 'rt/de/2',
      },
    ]);
    expect(favs.favorite_levels.map((l) => l.id)).toEqual([20]);

    const search = await client.searchMembers(g, { query: 'max mitglied' });
    expect(search.results[0]?.is_favorite).toBe(true);

    await client.removeFavorite(g, 'member', 1002);
    await client.removeFavorite(g, 'level', 20);
    favs = await client.favorites(g);
    expect(favs).toEqual({ favorite_members: [], favorite_levels: [] });
  });

  it('meldet unbekannte Ziele mit 404', async () => {
    const t = await login('admin');
    await expect(client.addFavorite(t.global_auth_token, 'level', 999)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('leert den Ebenen-Cache, damit is_favorite stimmt', async () => {
    const t = await login('mitglied');
    const g = t.global_auth_token;
    const fav = (club: { members?: { id: number; is_favorite?: boolean }[] }) =>
      club.members?.find((m) => m.id === 2000)?.is_favorite;
    expect(fav(await client.level(g, 101))).toBe(false);
    await client.addFavorite(g, 'member', 2000);
    expect(fav(await client.level(g, 101))).toBe(true);
    await client.removeFavorite(g, 'member', 2000);
  });
});

describe('Eigenes Profil bearbeiten', () => {
  it('ändert Stammdaten, Adressen, Telefon und Social Media', async () => {
    const t = await login('mitglied');
    const l = t.local_auth_token;
    await client.updatePersonal(l, {
      title: 'Dr.',
      first_name: 'Maximilian',
      last_name: 'Mitglied',
      gender: 'M',
      birth_place: 'Kiel',
    });
    await client.updateAddress(l, address);
    await client.updateBillingAddress(l, {
      email: 'rechnung@example.com',
      address: { ...address, name: 'Max Mitglied', vat_nr: '' },
    });
    await client.updatePhone(l, { home: '', mobile: '+49 170 1234567' });
    await client.updateSocialMedia(l, {
      social_media_facebook: '',
      social_media_twitter: '',
      social_media_linkedin: 'https://linkedin.com/in/max',
      social_media_instagram: '',
    });

    const p = await client.myProfile(l);
    expect(category(p, 'personal')).toMatchObject({
      title: 'Dr.',
      first_name: 'Maximilian',
      birth_place: 'Kiel',
    });
    expect(category(p, 'address')).toMatchObject({
      home_address: address,
      billing_address: { email: 'rechnung@example.com' },
      phones: { mobile: '+49 170 1234567' },
    });
    expect(category(p, 'profile_pic').linkedin_url).toBe('https://linkedin.com/in/max');

    // Fremde sehen keine Rechnungsadresse.
    const other = await login('admin');
    const pub = await client.member(other.global_auth_token, 1002);
    expect(category(pub, 'address').billing_address).toBeNull();
  });

  it('reicht code und error_message bei 400 durch', async () => {
    const t = await login('mitglied');
    const err = await client.updatePrimaryEmail(t.local_auth_token, 'admin@example.com').catch((e) => e);
    expect(err).toBeInstanceOf(WorldApiError);
    expect(err).toMatchObject({
      status: 400,
      code: 'email_in_use',
      message: 'This email address is already in use',
    });
    await expect(
      client.updatePrimaryEmail(t.local_auth_token, 'max.neu@example.com'),
    ).resolves.toBeUndefined();
  });

  it('setzt Datenschutz und prüft cross_family_optin für "all"', async () => {
    const t = await login('mitglied');
    const l = t.local_auth_token;
    await expect(client.setPrivacy(l, 'birth_date', 'all')).rejects.toMatchObject({
      status: 400,
      code: 'cross_family_required',
    });
    await client.setCrossFamilySharing(l, true);
    await client.setPrivacy(l, 'birth_date', 'all');
    await client.setPrivacy(l, 'address-12', 'club');
    const p = await client.myProfile(l);
    expect(p.cross_family_optin).toBe(true);
    expect(p.privacy_settings).toEqual([
      { type: 'birth_date', level: 'all' },
      { type: 'address-12', level: 'club' },
    ]);
  });

  it('lädt ein Profilbild als multipart/form-data hoch', async () => {
    const t = await login('mitglied');
    const seen: { contentType: string | null }[] = [];
    const spy = new WorldClient({
      baseUrl: mock.baseUrl,
      fetch: (async (url: string, init: RequestInit) => {
        seen.push({ contentType: new Headers(init.headers).get('content-type') });
        return fetch(url, init);
      }) as typeof fetch,
    });
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
    await spy.updateProfilePic(t.local_auth_token, png, 'me.png');
    expect(seen[0]?.contentType).toBeNull(); // fetch setzt multipart samt boundary selbst
    const p = await client.myProfile(t.local_auth_token);
    expect(category(p, 'profile_pic').profile_pic_url).toBe('https://example.com/pics/1002.jpg?v=2');
  });

  it('legt Zweit-E-Mails, Ausbildung und Beruf an, ändert und löscht sie', async () => {
    const t = await login('admin');
    const l = t.local_auth_token;

    const mail = await client.addSecondaryEmail(l, { type: 'work', value: 'anna@firma.de', cc: true });
    expect(mail.id).toEqual(expect.any(Number));
    await client.updateSecondaryEmail(l, mail.id, { type: 'work', value: 'anna@firma.de', cc: false });

    const edu: WorldEducation = {
      education_name: 'M.Sc. Informatik',
      school_name: 'Universität Hamburg',
      address,
      begin_date: '2010-10-01',
      end_date: '2012-09-30',
      completed: true,
    };
    const e = await client.addEducation(l, edu);
    await client.updateEducation(l, e.id, { ...edu, completed: false });

    const job: WorldWork = {
      name: 'Acme GmbH',
      function: 'Entwicklerin',
      sector: 'information-technology',
      begin_date: '2018-01-01',
      end_date: null,
      address,
      phone: '',
      email: '',
      website: 'https://acme.example',
      vat_nr: '',
    };
    const w = await client.addWork(l, job);
    await client.updateWork(l, w.id, { ...job, function: 'Teamleiterin' });

    let p = await client.myProfile(l);
    expect(category(p, 'address').secondary_emails).toEqual([
      { id: mail.id, type: 'work', value: 'anna@firma.de', cc: false },
    ]);
    expect(p.profile_categories.find((c) => c.code === 'education')?.values).toEqual([
      { id: e.id, ...edu, completed: false },
    ]);
    expect(p.profile_categories.find((c) => c.code === 'work')?.values).toEqual([
      { id: w.id, ...job, function: 'Teamleiterin' },
    ]);

    await client.deleteSecondaryEmail(l, mail.id);
    await client.deleteEducation(l, e.id);
    await client.deleteWork(l, w.id);
    p = await client.myProfile(l);
    expect(category(p, 'address').secondary_emails).toEqual([]);
    expect(p.profile_categories.find((c) => c.code === 'work')?.values).toEqual([]);
    await expect(client.deleteWork(l, w.id)).rejects.toMatchObject({ status: 404 });
  });

  it('setzt eigene Felder je nach Feldtyp', async () => {
    const t = await login('admin');
    const l = t.local_auth_token;
    await client.updateCustomField(l, 1, 'Labskaus');
    await client.updateCustomField(l, 2, true);
    await client.updateCustomField(l, 3, 'de,en');
    await expect(client.updateCustomField(l, 2, 'ja')).rejects.toMatchObject({ status: 400 });
    const fields = (await client.myProfile(l)).profile_categories.find((c) => c.code === 'custom-1')
      ?.values as { id: number; value: unknown }[];
    expect(fields.map((f) => f.value)).toEqual(['Labskaus', true, 'de,en']);
  });

  it('verlangt das lokale Token', async () => {
    const t = await login('admin');
    await expect(client.setCrossFamilySharing(t.global_auth_token, true)).rejects.toBeInstanceOf(
      WorldForbiddenError,
    );
  });
});

describe('Geolocation', () => {
  const hamburg = { latitude: 53.5511, longitude: 9.9937 };
  const kiel = { latitude: 54.3233, longitude: 10.1228 };

  it('findet Mitglieder in der Nähe erst nach Freigabe und Position', async () => {
    const a = await login('admin');
    const m = await login('mitglied');
    await expect(client.nearbyMembers(a.global_auth_token)).rejects.toBeInstanceOf(WorldForbiddenError);

    for (const [t, coords, name] of [
      [a, hamburg, 'Hamburg'],
      [m, kiel, 'Kiel'],
    ] as const) {
      await client.setGeolocationPermission(t.global_auth_token, true);
      await client.updateLocation(t.global_auth_token, {
        coords,
        location: { name, country: 'Germany' },
        speed: 0,
        accuracy: 10,
      });
    }
    const nearby = await client.nearbyMembers(a.global_auth_token);
    expect(nearby).toHaveLength(1);
    expect(nearby[0]).toMatchObject({ member: { id: 1002 }, location: { name: 'Kiel' } });
    expect(nearby[0]!.distance).toBeGreaterThan(80);
    expect(nearby[0]!.distance).toBeLessThan(100);
  });

  it('Mock begrenzt Geolocation auf 8 Anfragen pro Minute', async () => {
    const fast = new WorldClient({ baseUrl: mock.baseUrl, geolocationRequestsPerMinute: 100, maxRetries: 0 });
    const t = await login('mitglied');
    for (let i = 0; i < 8; i++) await fast.setGeolocationPermission(t.global_auth_token, true);
    await expect(fast.setGeolocationPermission(t.global_auth_token, true)).rejects.toMatchObject({
      status: 429,
    });
    // Das Standard-Limit ist davon unberührt.
    await expect(fast.myLevels(t.global_auth_token)).resolves.toBeTruthy();
  });
});

describe('Client-Infrastruktur', () => {
  afterEach(() => vi.useRealTimers());

  const okFetch = (calls: string[], status = 200, body = '[]') =>
    (async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${new URL(url).pathname}`);
      return new Response(status === 204 ? null : body, { status });
    }) as unknown as typeof fetch;

  it('drosselt Geolocation separat auf 8 pro Minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const sleeps: number[] = [];
    const calls: string[] = [];
    const c = new WorldClient({
      baseUrl: 'http://x.test/',
      fetch: okFetch(calls),
      sleep: async (ms) => {
        sleeps.push(ms);
        vi.setSystemTime(Date.now() + ms);
      },
    });
    for (let i = 0; i < 8; i++) await c.nearbyMembers('tok');
    for (let i = 0; i < 20; i++) await c.myLevels('tok');
    expect(sleeps).toEqual([]);
    await c.nearbyMembers('tok');
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(50_000);
  });

  it('wiederholt schreibende Aufrufe nur bei 429, lesende auch bei 5xx', async () => {
    const t = await login('admin');
    const l = t.local_auth_token;
    const path = '/v1/app/update-profile/work/';
    const before = mock.calls.get(path) ?? 0;
    mock.failNext(1, 503);
    await expect(
      client.addWork(l, {
        name: 'X',
        function: '',
        sector: 'legal',
        begin_date: '2020-01-01',
        end_date: null,
        address,
        phone: '',
        email: '',
        website: '',
        vat_nr: '',
      }),
    ).rejects.toBeInstanceOf(WorldUnavailableError);
    expect(mock.calls.get(path)).toBe(before + 1);

    mock.failNext(1, 429);
    await expect(
      client.addSecondaryEmail(l, { type: 'home', value: 'a@b.de', cc: false }),
    ).resolves.toMatchObject({
      id: expect.any(Number),
    });

    mock.failNext(1, 503);
    await expect(client.listEvents(t.global_auth_token)).resolves.toBeTruthy();
    mock.failNext(0);
  });

  it('kommt mit leeren Antworten (204) zurecht', async () => {
    const calls: string[] = [];
    const c = new WorldClient({ baseUrl: 'http://x.test/v1/app/', fetch: okFetch(calls, 204) });
    await expect(c.removeFavorite('tok', 'member', 5)).resolves.toBeUndefined();
    await expect(c.nearbyMembers('tok')).resolves.toEqual([]);
    await expect(c.highlightedEvents('tok')).resolves.toEqual([]);
    expect(calls[0]).toBe('DELETE /v1/app/favorites/member/5/');
  });

  it('durchläuft alle Seiten mit paginate()', async () => {
    const t = await login('admin');
    const ids: number[] = [];
    for await (const m of client.paginate((o) => client.searchMembers(t.global_auth_token, {}, o)))
      ids.push(m.id);
    expect(ids.length).toBeGreaterThan(25);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
