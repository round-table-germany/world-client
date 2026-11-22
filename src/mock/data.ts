/** Testdaten für den .WORLD-Mock: 1 Assoziation, 2 Distrikte, 6 Tische. */

export interface MockLevel {
  id: number;
  name: string;
  path: string;
  subdomain: string;
  sync_level: 1 | 2 | 3 | 4;
  parent: number | null;
}

export interface MockFunction {
  functionId: number;
  functionName: string;
  levelId: number;
  start_date: string;
  end_date: string | null;
}

export interface MockMember {
  id: number;
  first_name: string;
  last_name: string;
  clubId: number;
  active: boolean;
  honorary?: boolean;
  username?: string;
  password?: string;
  tfa?: string;
  member_until_date?: string;
  functions?: MockFunction[];
}

export const FUNCTIONS = [
  { id: 1, name: 'Präsident', display_order: 1 },
  { id: 2, name: 'Vizepräsident', display_order: 2 },
  { id: 3, name: 'Sekretär', display_order: 3 },
  { id: 4, name: 'Schatzmeister', display_order: 4 },
  { id: 5, name: 'IRO', display_order: 5 },
];

export function createMockData() {
  const levels: MockLevel[] = [
    { id: 1, name: 'Round Table International', path: 'rt', subdomain: 'rt', sync_level: 4, parent: null },
    { id: 10, name: 'Round Table Deutschland', path: 'rt/de', subdomain: 'de', sync_level: 3, parent: 1 },
    { id: 20, name: 'Distrikt Nord', path: 'rt/de/d1', subdomain: 'd1-de', sync_level: 2, parent: 10 },
    { id: 21, name: 'Distrikt Süd', path: 'rt/de/d2', subdomain: 'd2-de', sync_level: 2, parent: 10 },
    { id: 101, name: 'RT 1 Hamburg', path: 'rt/de/1', subdomain: '1-de', sync_level: 1, parent: 20 },
    { id: 102, name: 'RT 2 Kiel', path: 'rt/de/2', subdomain: '2-de', sync_level: 1, parent: 20 },
    { id: 103, name: 'RT 3 Bremen', path: 'rt/de/3', subdomain: '3-de', sync_level: 1, parent: 20 },
    { id: 104, name: 'RT 4 München', path: 'rt/de/4', subdomain: '4-de', sync_level: 1, parent: 21 },
    { id: 105, name: 'RT 5 Stuttgart', path: 'rt/de/5', subdomain: '5-de', sync_level: 1, parent: 21 },
    { id: 106, name: 'RT 6 Augsburg', path: 'rt/de/6', subdomain: '6-de', sync_level: 1, parent: 21 },
  ];

  const firstNames = ['Jan', 'Lukas', 'Felix', 'Moritz', 'Paul', 'Tim', 'Jonas', 'Max', 'Ben', 'Leon'];
  const lastNames = ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker'];

  const members: MockMember[] = [
    {
      id: 1001,
      first_name: 'Anna',
      last_name: 'Admin',
      clubId: 101,
      active: true,
      username: 'admin',
      password: 'admin',
      tfa: '123456',
      member_until_date: '2030-12-31',
      functions: [
        { functionId: 1, functionName: 'Präsident', levelId: 10, start_date: '2025-01-01', end_date: null },
        {
          functionId: 3,
          functionName: 'Sekretär',
          levelId: 101,
          start_date: '2020-01-01',
          end_date: '2021-12-31',
        },
      ],
    },
    {
      id: 1002,
      first_name: 'Max',
      last_name: 'Mitglied',
      clubId: 102,
      active: true,
      username: 'mitglied',
      password: 'mitglied',
      member_until_date: '2030-12-31',
      functions: [
        { functionId: 1, functionName: 'Präsident', levelId: 20, start_date: '2025-01-01', end_date: null },
      ],
    },
    {
      id: 1003,
      first_name: 'Ingo',
      last_name: 'Inaktiv',
      clubId: 103,
      active: false,
      username: 'inaktiv',
      password: 'inaktiv',
    },
  ];

  let id = 2000;
  const clubs = levels.filter((l) => l.sync_level === 1);
  clubs.forEach((club, ci) => {
    for (let i = 0; i < 4; i++) {
      members.push({
        id: id++,
        first_name: firstNames[(ci * 4 + i) % firstNames.length]!,
        last_name: lastNames[(ci + i) % lastNames.length]!,
        clubId: club.id,
        active: true,
      });
    }
    members.push({
      id: id++,
      first_name: 'Ehren',
      last_name: `Mitglied ${club.id}`,
      clubId: club.id,
      active: true,
      honorary: true,
    });
  });

  // Vorstände: Präsident je Tisch (erstes Mitglied), Präsident Distrikt Süd, Schatzmeister RTD.
  const fn = (functionId: number, levelId: number): MockFunction => ({
    functionId,
    functionName: FUNCTIONS.find((f) => f.id === functionId)!.name,
    levelId,
    start_date: '2025-01-01',
    end_date: null,
  });
  for (const club of clubs) {
    const first = members.find((m) => m.clubId === club.id && m.id >= 2000 && !m.honorary)!;
    first.functions = [fn(1, club.id)];
  }
  const sued = members.find((m) => m.clubId === 104 && m.id >= 2000 && !m.functions)!;
  sued.functions = [fn(1, 21), fn(2, 104)];
  const kasse = members.find((m) => m.clubId === 105 && m.id >= 2000 && !m.functions)!;
  kasse.functions = [fn(4, 10)];
  // Vizepräsident Distrikt Nord (darf bei Filter „Präsident“ nicht erfasst werden).
  const vize = members.find((m) => m.clubId === 103 && m.id >= 2000 && !m.functions)!;
  vize.functions = [fn(2, 20)];

  return { levels, members };
}

export type MockData = ReturnType<typeof createMockData>;
