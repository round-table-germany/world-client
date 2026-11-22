import crypto from 'node:crypto';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { createMockData, FUNCTIONS, type MockData, type MockLevel, type MockMember } from './data.js';

export { createMockData } from './data.js';
export type { MockData, MockMember, MockLevel } from './data.js';

/**
 * Nachbau der .WORLD-API (Pfade unter /v1/app/) für Entwicklung und Tests.
 * Bildet die dokumentierten Endpunkte und Fehlerfälle nach (2FA, inaktive Mitglieder, 403, 429).
 */
export interface WorldMock {
  app: ReturnType<typeof Fastify>;
  data: MockData;
  /** Anzahl bearbeiteter Anfragen pro Pfad (ohne Query). */
  calls: Map<string, number>;
  /** Die nächsten n Anfragen (außer Login) mit 429 beantworten. */
  failNext(n: number, status?: number): void;
  /** Basis-URL nach listen(), z. B. http://127.0.0.1:1234/v1/app/ */
  baseUrl: string;
  listen(port?: number): Promise<string>;
  close(): Promise<void>;
}

export function createWorldMock(data: MockData = createMockData()): WorldMock {
  const app = Fastify({ logger: false });
  const tokens = new Map<string, { memberId: number; type: 'global' | 'local' }>();
  const calls = new Map<string, number>();
  let failures: { n: number; status: number } = { n: 0, status: 429 };

  const levelById = (id: number) => data.levels.find((l) => l.id === id);
  const memberById = (id: number) => data.members.find((m) => m.id === id);
  const levelRef = (l: MockLevel) => ({
    id: l.id,
    name: l.name,
    path: l.path,
    subdomain: l.subdomain,
    logo: null,
    sync_family: 0,
    sync_level: l.sync_level,
  });
  const ancestor = (levelId: number, syncLevel: number): MockLevel | undefined => {
    let l = levelById(levelId);
    while (l && l.sync_level < syncLevel) l = l.parent ? levelById(l.parent) : undefined;
    return l && l.sync_level === syncLevel ? l : undefined;
  };
  const summary = (m: MockMember) => ({
    id: m.id,
    first_name: m.first_name,
    last_name: m.last_name,
    profile_pic_url: `https://example.com/pics/${m.id}.jpg`,
    is_favorite: false,
    level: levelRef(levelById(m.clubId)!),
  });
  // Ämter als Einträge mit combination (Amt + Ebene); die Mock-ID ist functionId * 1000 + levelId.
  const groupsValues = (m: MockMember) => ({
    groups: (m.functions ?? []).map((f) => {
      const level = levelById(f.levelId)!;
      return {
        combination: {
          id: f.functionId * 1000 + f.levelId,
          function: { id: f.functionId, name: f.functionName },
          level: { id: level.id, name: level.name, sync_level: level.sync_level },
        },
        start_date: f.start_date,
        end_date: f.end_date,
      };
    }),
  });
  const profile = (m: MockMember) => ({
    cross_family_optin: false,
    profile_categories: [
      {
        category_name: 'Profile Picture',
        display_order: 0,
        code: 'profile_pic',
        can_edit: true,
        values: { profile_pic_url: `https://example.com/pics/${m.id}.jpg` },
      },
      {
        category_name: 'Personal Information',
        display_order: 3,
        code: 'personal',
        can_edit: true,
        values: {
          first_name: m.first_name,
          last_name: m.last_name,
          member_start_date: '2015-01-01',
          member_until_date: m.member_until_date ?? '2030-12-31',
        },
      },
      { category_name: 'Groups', display_order: 6, code: 'groups', can_edit: false, values: groupsValues(m) },
    ],
    privacy_settings: [],
  });

  const auth = (req: FastifyRequest, reply: FastifyReply, type: 'global' | 'local'): MockMember | null => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Token ') ? header.slice(6) : '';
    const t = tokens.get(token);
    const m = t ? memberById(t.memberId) : undefined;
    if (!t || t.type !== type || !m || !m.active) {
      void reply.code(403).send({ detail: 'Authentication credentials were not provided.' });
      return null;
    }
    return m;
  };

  const paginate = <T>(req: FastifyRequest, items: T[], defaultLimit: number) => {
    const q = req.query as Record<string, string | undefined>;
    const limit = Number(q.limit ?? defaultLimit);
    const offset = Number(q.offset ?? 0);
    const next = offset + limit < items.length ? `?limit=${limit}&offset=${offset + limit}` : null;
    return { count: items.length, next, previous: null, results: items.slice(offset, offset + limit) };
  };

  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0]!;
    calls.set(path, (calls.get(path) ?? 0) + 1);
    if (failures.n > 0 && !path.endsWith('/login/')) {
      failures.n--;
      return reply.code(failures.status).send({ detail: 'Request was throttled.' });
    }
  });

  app.register(
    async (r) => {
      r.post('/login/', async (req, reply) => {
        const b = (req.body ?? {}) as Record<string, unknown>;
        // Wie die echte API: ein leeres tfa_code-Feld ist ungültig (ohne Code muss das Feld fehlen).
        if ('tfa_code' in b && (typeof b.tfa_code !== 'string' || b.tfa_code === '')) {
          return reply.code(400).send({ error_message: 'Invalid input data' });
        }
        const m = data.members.find((x) => x.username && x.username === b.username);
        if (!m || m.password !== b.password || b.sync_family !== 0) {
          return reply
            .code(400)
            .send({ code: 'login_failed', error_message: 'Invalid username or password' });
        }
        if (!m.active) {
          return reply
            .code(400)
            .send({ code: 'login_failed', error_message: 'Only active members can login' });
        }
        if (m.tfa && b.tfa_code !== m.tfa) {
          return reply
            .code(400)
            .send({ code: 'tfa_required', error_message: 'Two-factor authentication code is required' });
        }
        const g = crypto.randomBytes(16).toString('hex');
        const l = crypto.randomBytes(16).toString('hex');
        tokens.set(g, { memberId: m.id, type: 'global' });
        tokens.set(l, { memberId: m.id, type: 'local' });
        const club = levelById(m.clubId)!;
        return {
          global_auth_token: g,
          local_auth_token: l,
          me: {
            id: m.id,
            first_name: m.first_name,
            last_name: m.last_name,
            level_id: club.id,
            cross_family_optin: false,
            geolocation_optin: false,
          },
          club: { id: club.id, name: club.name, path: club.path },
        };
      });

      r.get('/my-profile/', async (req, reply) => {
        const m = auth(req, reply, 'local');
        return m ? profile(m) : reply;
      });

      r.get('/my-levels/', async (req, reply) => {
        const m = auth(req, reply, 'global');
        if (!m) return reply;
        const pick = (s: number) => {
          const l = ancestor(m.clubId, s);
          return l ? levelRef(l) : null;
        };
        return { club: pick(1), area: pick(2), association: pick(3), family: pick(4) };
      });

      r.get('/members/config/functions/', async (req, reply) => {
        if (!auth(req, reply, 'global')) return reply;
        return FUNCTIONS;
      });

      r.post('/members/search/', async (req, reply) => {
        if (!auth(req, reply, 'global')) return reply;
        const b = (req.body ?? {}) as Record<string, unknown>;
        const q = typeof b.query === 'string' ? b.query.toLowerCase() : '';
        const level = typeof b.level === 'number' ? b.level : null;
        const items = data.members
          .filter((m) => m.active && !m.honorary)
          .filter((m) => !q || `${m.first_name} ${m.last_name}`.toLowerCase().includes(q))
          .filter((m) => level === null || m.clubId === level || ancestor(m.clubId, 2)?.id === level)
          .sort((a, b2) => a.last_name.localeCompare(b2.last_name))
          .map(summary);
        return paginate(req, items, 25);
      });

      r.get('/members/:id/', async (req, reply) => {
        if (!auth(req, reply, 'global')) return reply;
        const m = memberById(Number((req.params as { id: string }).id));
        if (!m || !m.active) return reply.code(403).send({ detail: 'Forbidden' });
        const p = profile(m);
        return { ...p, profile_categories: p.profile_categories };
      });

      r.get('/directory/association-clubs/:id/', async (req, reply) => {
        if (!auth(req, reply, 'global')) return reply;
        const id = Number((req.params as { id: string }).id);
        return data.levels.filter((l) => l.sync_level === 1 && ancestor(l.id, 3)?.id === id).map(levelRef);
      });

      r.get('/directory/:id/', async (req, reply) => {
        if (!auth(req, reply, 'global')) return reply;
        const l = levelById(Number((req.params as { id: string }).id));
        if (!l) return reply.code(404).send({ detail: 'Not found.' });
        const clubMembers = data.members.filter((m) => m.clubId === l.id && m.active);
        return {
          ...levelRef(l),
          hostname: `${l.subdomain}.roundtable.world`,
          sync_parent: l.parent,
          children: data.levels.filter((c) => c.parent === l.id).map(levelRef),
          details: {},
          // Vorstand: aktuelle Ämter auf genau dieser Ebene (Form angenommen, siehe apps/server/src/world/board.ts).
          board: data.members
            .filter((m) => m.active)
            .flatMap((m) =>
              (m.functions ?? [])
                .filter((f) => f.levelId === l.id && (!f.end_date || f.end_date >= '2026-01-01'))
                .map((f) => ({
                  id: 9000 + m.id,
                  member: summary(m),
                  function: { id: f.functionId, name: f.functionName },
                  start_date: f.start_date,
                  end_date: f.end_date,
                })),
            ),
          board_assistants: [],
          honorary_members: l.sync_level === 1 ? clubMembers.filter((m) => m.honorary).map(summary) : [],
          members: l.sync_level === 1 ? clubMembers.filter((m) => !m.honorary).map(summary) : [],
        };
      });

      const events = [
        {
          id: 501,
          name: 'Distriktsversammlung Nord',
          description: '<p>Frühjahrs-DV</p>',
          internal_type: 'internal',
          start_date: '2027-03-14T10:00:00Z',
          end_date: '2027-03-14T16:00:00Z',
          event_type: 'as-statutory',
          club: { id: 20, name: 'Distrikt Nord' },
          shared_with_type: 'area',
          shared_with_level: levelRef(levelById(20)!),
        },
        {
          id: 502,
          name: 'Halbjahrestreffen RTD',
          description: '<p>HJT</p>',
          internal_type: 'internal',
          start_date: '2027-05-01T09:00:00Z',
          end_date: '2027-05-02T14:00:00Z',
          event_type: 'hym',
          club: { id: 10, name: 'Round Table Deutschland' },
          shared_with_type: 'association',
          shared_with_level: levelRef(levelById(10)!),
        },
      ];
      const eventSearch = async (req: FastifyRequest, reply: FastifyReply) => {
        if (!auth(req, reply, 'global')) return reply;
        const b = (req.body ?? {}) as Record<string, unknown>;
        const q = typeof b.query === 'string' ? b.query.toLowerCase() : '';
        return paginate(
          req,
          events.filter((e) => !q || e.name.toLowerCase().includes(q)),
          10,
        );
      };
      r.post('/events/search/', eventSearch);
      r.post('/events/statutory/', eventSearch);
      r.post('/events/list/', eventSearch);
    },
    { prefix: '/v1/app' },
  );

  const mock: WorldMock = {
    app,
    data,
    calls,
    baseUrl: '',
    failNext(n, status = 429) {
      failures = { n, status };
    },
    async listen(port = 0) {
      const address = await app.listen({ host: '127.0.0.1', port });
      mock.baseUrl = `${address}/v1/app/`;
      return mock.baseUrl;
    },
    async close() {
      await app.close();
    },
  };
  return mock;
}
