import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  EVENT_TYPES,
  Family,
  ROUND_TABLE_FAMILY,
  SyncLevel,
  WorldClient,
  myFunctions,
  profilePicFromAny,
  type EventType,
  type PrivacyField,
  type WorldEvent,
  type WorldEventSearch,
  type WorldLevelRef,
  type WorldMemberProfile,
  type WorldMyProfile,
} from '../src/index.js';
import { createWorldMock } from '../src/mock/index.js';

describe('Konstanten', () => {
  it('entsprechen den Werten der Doku', () => {
    expect(Family).toEqual({ RoundTable: 0, FortyOneClub: 1, LadiesCircle: 2, AgoraClub: 3, TangentClub: 4 });
    expect(SyncLevel).toEqual({ Club: 1, Area: 2, Association: 3, Family: 4 });
    expect(ROUND_TABLE_FAMILY).toBe(Family.RoundTable);
    expect(EVENT_TYPES).toHaveLength(11);
    expect(EVENT_TYPES).toContain('as-statutory');
  });

  it('dienen zugleich als Typen', () => {
    expectTypeOf<Family>().toEqualTypeOf<0 | 1 | 2 | 3 | 4>();
    expectTypeOf<SyncLevel>().toEqualTypeOf<1 | 2 | 3 | 4>();
    expectTypeOf<WorldLevelRef['sync_level']>().toEqualTypeOf<SyncLevel | undefined>();
    expectTypeOf<'hym'>().toExtend<EventType>();
  });
});

describe('Typen', () => {
  it('lassen bekannte und unbekannte Codes bei event_type zu', () => {
    const known: WorldEventSearch = {
      event_type: 'hym',
      organising_sync_level: [SyncLevel.Club, SyncLevel.Area],
    };
    const future: WorldEvent = { id: 1, name: 'x', event_type: 'neuer-code', internal_type: 'sale' };
    expect(known.event_type).toBe('hym');
    expect(future.event_type).toBe('neuer-code');
    // @ts-expect-error sync_level 5 gibt es nicht
    const invalid: WorldEventSearch = { organising_sync_level: 5 };
    expect(invalid).toBeTruthy();
  });

  it('beschreiben Datenschutz-Felder als Template-Literale', () => {
    expectTypeOf<'address-12424'>().toExtend<PrivacyField>();
    expectTypeOf<'birth_date'>().toExtend<PrivacyField>();
    expectTypeOf<'address-'>().not.toExtend<PrivacyField>();
  });

  it('member() liefert ein Profil, das die Profil-Helfer verstehen', async () => {
    expectTypeOf<WorldClient['member']>().returns.resolves.toEqualTypeOf<WorldMemberProfile>();
    expectTypeOf<WorldMyProfile>().toExtend<WorldMemberProfile>();

    const mock = createWorldMock();
    await mock.listen();
    try {
      const client = new WorldClient({ baseUrl: mock.baseUrl, sleep: async () => undefined });
      const r = await client.login('mitglied', 'mitglied');
      if (r.kind !== 'ok') throw new Error('Login fehlgeschlagen');
      const p = await client.member(r.data.global_auth_token, 1001);
      expect(profilePicFromAny(p)).toBe('https://example.com/pics/1001.jpg');
      expect(myFunctions(p).map((f) => f.combinationId)).toEqual([1010]);
    } finally {
      await mock.close();
    }
  });
});
