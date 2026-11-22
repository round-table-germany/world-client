import crypto from 'node:crypto';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import {
  createMockData,
  CUSTOM_FIELDS,
  FAMILIES,
  FUNCTIONS,
  type MockData,
  type MockLevel,
  type MockMember,
} from './data.js';

export { createMockData } from './data.js';
export type { MockData, MockMember, MockLevel } from './data.js';

/**
 * Nachbau der .WORLD-API (Pfade unter /v1/app/) für Entwicklung und Tests.
 * Bildet die dokumentierten Endpunkte und Fehlerfälle nach (2FA, inaktive Mitglieder, 403, 429,
 * 400 mit code/error_message, Geolocation-Limit 8/min). Schreibende Aufrufe ändern einen Zustand im Speicher.
 */
export interface WorldMock {
  app: ReturnType<typeof Fastify>;
  data: MockData;
  /** Anzahl bearbeiteter Anfragen pro Pfad (ohne Query). */
  calls: Map<string, number>;
  /** Die nächsten n Anfragen (außer Login) mit 429 (oder `status`) beantworten. */
  failNext(n: number, status?: number): void;
  /** Basis-URL nach listen(), z. B. http://127.0.0.1:1234/v1/app/ */
  baseUrl: string;
  listen(port?: number): Promise<string>;
  close(): Promise<void>;
}

const GEO_LIMIT = 8;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const PRIVACY_LEVELS = ['all', 'public', 'association', 'area', 'club', 'favorites', 'private'];
const PRIVACY_FIELD =
  /^(education|company-position|gender|birth_date|birth_place|(address|phone|secondary-email|custom-field-category)-\d+)$/;

interface Address {
  street1: string;
  street2: string;
  country_code: string;
  postal_code: string;
  city: string;
}

/** Veränderlicher Zustand eines Mitglieds (Favoriten, Profilangaben, Einstellungen, Position). */
interface MemberState {
  favoriteMembers: Set<number>;
  favoriteLevels: Set<number>;
  birthdayNotifications: boolean;
  crossFamily: boolean;
  geolocation: boolean;
  location: {
    coords: { latitude: number; longitude: number };
    location: unknown;
    speed: number;
    at: number;
  } | null;
  privacy: Map<string, string>;
  title: string;
  gender: string;
  birthPlace: string;
  email: string;
  picVersion: number;
  address: Address | null;
  billing: { email: string; address: Record<string, unknown> } | null;
  phone: { home: string; mobile: string };
  social: Record<string, string>;
  secondaryEmails: Map<number, Record<string, unknown>>;
  education: Map<number, Record<string, unknown>>;
  work: Map<number, Record<string, unknown>>;
  custom: Map<number, unknown>;
  attending: Set<number>;
}

export function createWorldMock(data: MockData = createMockData()): WorldMock {
  const app = Fastify({ logger: false });
  const tokens = new Map<string, { memberId: number; type: 'global' | 'local' }>();
  const calls = new Map<string, number>();
  const geoCalls = new Map<string, number[]>();
  const states = new Map<number, MemberState>();
  let failures: { n: number; status: number } = { n: 0, status: 429 };
  let nextId = 70_000;

  // Profilbild-Upload ohne Zusatzpaket: multipart als Rohdaten annehmen.
  app.addContentTypeParser('multipart/form-data', { parseAs: 'buffer' }, (_req, body, done) =>
    done(null, body),
  );

  const levelById = (id: number) => data.levels.find((l) => l.id === id);
  const memberById = (id: number) => data.members.find((m) => m.id === id);
  const state = (m: MockMember): MemberState => {
    let s = states.get(m.id);
    if (!s) {
      s = {
        favoriteMembers: new Set(),
        favoriteLevels: new Set(),
        birthdayNotifications: false,
        crossFamily: false,
        geolocation: false,
        location: null,
        privacy: new Map(),
        title: '',
        gender: 'U',
        birthPlace: '',
        email: `${m.username ?? m.id}@example.com`,
        picVersion: 1,
        address: null,
        billing: null,
        phone: { home: '', mobile: '' },
        social: {},
        secondaryEmails: new Map(),
        education: new Map(),
        work: new Map(),
        custom: new Map(),
        attending: new Set(m.id === 1001 ? [502] : []),
      };
      states.set(m.id, s);
    }
    return s;
  };
  const picUrl = (m: MockMember) => {
    const v = state(m).picVersion;
    return `https://example.com/pics/${m.id}.jpg${v > 1 ? `?v=${v}` : ''}`;
  };
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
  const summary = (m: MockMember, viewer?: MockMember) => ({
    id: m.id,
    first_name: m.first_name,
    last_name: m.last_name,
    profile_pic_url: picUrl(m),
    is_favorite: viewer ? state(viewer).favoriteMembers.has(m.id) : false,
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
  const entries = (map: Map<number, Record<string, unknown>>) => [...map].map(([id, v]) => ({ id, ...v }));
  /** Profil; `own` = eigenes Profil (sonst ohne Rechnungsadresse und private E-Mail). */
  const profile = (m: MockMember, own: boolean) => {
    const s = state(m);
    return {
      cross_family_optin: s.crossFamily,
      profile_categories: [
        {
          category_name: 'Profile Picture',
          display_order: 0,
          code: 'profile_pic',
          can_edit: true,
          values: {
            profile_pic_url: picUrl(m),
            facebook_url: s.social.social_media_facebook || null,
            twitter_url: s.social.social_media_twitter || null,
            linkedin_url: s.social.social_media_linkedin || null,
            instagram_url: s.social.social_media_instagram || null,
          },
        },
        {
          category_name: 'Personal Information',
          display_order: 3,
          code: 'personal',
          can_edit: true,
          values: {
            title: s.title,
            first_name: m.first_name,
            last_name: m.last_name,
            gender: s.gender,
            birth_place: s.birthPlace,
            member_start_date: '2015-01-01',
            member_until_date: m.member_until_date ?? '2030-12-31',
          },
        },
        {
          category_name: 'Address',
          display_order: 4,
          code: 'address',
          can_edit: true,
          values: {
            home_address: s.address,
            billing_address: own ? s.billing : null,
            phones: s.phone,
            email: s.email,
            email_private: null,
            secondary_emails: entries(s.secondaryEmails),
          },
        },
        {
          category_name: 'Groups',
          display_order: 6,
          code: 'groups',
          can_edit: false,
          values: groupsValues(m),
        },
        { category_name: 'Work', display_order: 7, code: 'work', can_edit: true, values: entries(s.work) },
        {
          category_name: 'Education',
          display_order: 8,
          code: 'education',
          can_edit: true,
          values: entries(s.education),
        },
        // Aufbau der eigenen Felder ist nicht dokumentiert; angenommen: eine Kategorie mit Feldliste.
        {
          category_name: 'Weitere Angaben',
          display_order: 9,
          code: 'custom-1',
          can_edit: true,
          values: CUSTOM_FIELDS.map((f) => ({ ...f, value: s.custom.get(f.id) ?? null })),
        },
      ],
      privacy_settings: [...s.privacy].map(([type, level]) => ({ type, level })),
    };
  };

  const tokenOf = (req: FastifyRequest) => {
    const header = req.headers.authorization ?? '';
    return header.startsWith('Token ') ? header.slice(6) : '';
  };
  const auth = (req: FastifyRequest, reply: FastifyReply, type: 'global' | 'local'): MockMember | null => {
    const t = tokens.get(tokenOf(req));
    const m = t ? memberById(t.memberId) : undefined;
    if (!t || t.type !== type || !m || !m.active) {
      void reply.code(403).send({ detail: 'Authentication credentials were not provided.' });
      return null;
    }
    return m;
  };
  /** Wie `auth`, zusätzlich das Geolocation-Limit (8 / Token / Minute). */
  const geoAuth = (req: FastifyRequest, reply: FastifyReply): MockMember | null => {
    const m = auth(req, reply, 'global');
    if (!m) return null;
    const now = Date.now();
    const list = (geoCalls.get(tokenOf(req)) ?? []).filter((t) => now - t < MINUTE);
    if (list.length >= GEO_LIMIT) {
      geoCalls.set(tokenOf(req), list);
      void reply.code(429).send({ detail: 'Request was throttled.' });
      return null;
    }
    list.push(now);
    geoCalls.set(tokenOf(req), list);
    return m;
  };

  const invalid = (reply: FastifyReply, message: string, code = 'invalid_input') =>
    reply.code(400).send({ code, error_message: message });
  const body = (req: FastifyRequest) => (req.body ?? {}) as Record<string, unknown>;
  const idParam = (req: FastifyRequest) => Number((req.params as { id: string }).id);
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const isAddress = (v: unknown): v is Address =>
    !!v &&
    typeof v === 'object' &&
    ['street1', 'country_code', 'postal_code', 'city'].every(
      (k) => typeof (v as Record<string, unknown>)[k] === 'string',
    );

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
        const b = body(req);
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
        const s = state(m);
        return {
          global_auth_token: g,
          local_auth_token: l,
          me: {
            id: m.id,
            first_name: m.first_name,
            last_name: m.last_name,
            level_id: club.id,
            cross_family_optin: s.crossFamily,
            geolocation_optin: s.geolocation,
          },
          club: { id: club.id, name: club.name, path: club.path },
        };
      });

      // ---------- Eigenes Profil ----------

      r.get('/my-profile/', async (req, reply) => {
        const m = auth(req, reply, 'local');
        return m ? profile(m, true) : reply;
      });

      r.post('/update-profile/cross-family-sharing/', async (req, reply) => {
        const m = auth(req, reply, 'local');
        if (!m) return reply;
        const { enabled } = body(req);
        if (typeof enabled !== 'boolean') return invalid(reply, 'enabled must be a boolean');
        const s = state(m);
        s.crossFamily = enabled;
        // Ohne Freigabe ist "all" nicht mehr zulässig.
        if (!enabled) for (const [k, v] of s.privacy) if (v === 'all') s.privacy.set(k, 'public');
        return {};
      });

      r.post('/update-profile/privacy-settings/', async (req, reply) => {
        const m = auth(req, reply, 'local');
        if (!m) return reply;
        const { field, level } = body(req);
        if (typeof field !== 'string' || !PRIVACY_FIELD.test(field)) return invalid(reply, 'Invalid field');
        if (typeof level !== 'string' || !PRIVACY_LEVELS.includes(level))
          return invalid(reply, 'Invalid level');
        const s = state(m);
        if (level === 'all' && !s.crossFamily) {
          return invalid(reply, 'Cross-family sharing is not enabled', 'cross_family_required');
        }
        s.privacy.set(field, level);
        return {};
      });

      r.post('/update-profile/edit/personal/', async (req, reply) => {
        const m = auth(req, reply, 'local');
        if (!m) return reply;
        const b = body(req);
        if (!str(b.first_name) || !str(b.last_name))
          return invalid(reply, 'first_name and last_name are required');
        if (!['M', 'F', 'U', 'X'].includes(str(b.gender))) return invalid(reply, 'Invalid gender');
        const s = state(m);
        m.first_name = str(b.first_name);
        m.last_name = str(b.last_name);
        s.title = str(b.title);
        s.gender = str(b.gender);
        s.birthPlace = str(b.birth_place);
        return {};
      });

      r.post('/update-profile/edit/address/', async (req, reply) => {
        const m = auth(req, reply, 'local');
        if (!m) return reply;
        const b = body(req);
        if (!isAddress(b)) return invalid(reply, 'Invalid address');
        state(m).address = {
          street1: b.street1,
          street2: str(b.street2),
          country_code: b.country_code,
          postal_code: b.postal_code,
          city: b.city,
        };
        return {};
      });

      r.post('/update-profile/edit/billing-address/', async (req, reply) => {
        const m = auth(req, reply, 'local');
        if (!m) return reply;
        const b = body(req);
        if (typeof b.email !== 'string' || !isAddress(b.address))
          return invalid(reply, 'Invalid billing address');
        state(m).billing = {
          email: b.email,
          address: { ...(b.address as unknown as Record<string, unknown>) },
        };
        return {};
      });

      r.post('/update-profile/edit/phone/', async (req, reply) => {
        const m = auth(req, reply, 'local');
        if (!m) return reply;
        const b = body(req);
        state(m).phone = { home: str(b.home), mobile: str(b.mobile) };
        return {};
      });

      r.post('/update-profile/edit/primary-email/', async (req, reply) => {
        const m = auth(req, reply, 'local');
        if (!m) return reply;
        const email = str(body(req).email).toLowerCase();
        if (!/^[^@\s]+@[^@\s]+$/.test(email)) return invalid(reply, 'Invalid email');
        const taken = data.members.some((o) => o.id !== m.id && state(o).email.toLowerCase() === email);
        if (taken) return invalid(reply, 'This email address is already in use', 'email_in_use');
        // Die echte API ändert die Adresse erst nach Bestätigung; der Mock übernimmt sie sofort.
        state(m).email = email;
        return {};
      });

      r.post('/update-profile/edit/profile-pic/', async (req, reply) => {
        const m = auth(req, reply, 'local');
        if (!m) return reply;
        const raw = req.body;
        if (!Buffer.isBuffer(raw) || !raw.includes('name="profile_pic"')) {
          return invalid(reply, 'profile_pic is required');
        }
        state(m).picVersion++;
        return {};
      });

      r.post('/update-profile/edit/social-media/', async (req, reply) => {
        const m = auth(req, reply, 'local');
        if (!m) return reply;
        const b = body(req);
        const keys = [
          'social_media_facebook',
          'social_media_twitter',
          'social_media_linkedin',
          'social_media_instagram',
        ];
        state(m).social = Object.fromEntries(keys.map((k) => [k, str(b[k])]));
        return {};
      });

      /** Anlegen (201 { id }), Ändern und Löschen einer Liste im Profil. */
      const crud = (
        path: string,
        list: (s: MemberState) => Map<number, Record<string, unknown>>,
        validate: (b: Record<string, unknown>) => string | null,
      ) => {
        r.post(`/update-profile/${path}/`, async (req, reply) => {
          const m = auth(req, reply, 'local');
          if (!m) return reply;
          const b = body(req);
          const error = validate(b);
          if (error) return invalid(reply, error);
          const id = nextId++;
          list(state(m)).set(id, { ...b });
          return reply.code(201).send({ id });
        });
        r.put(`/update-profile/${path}/:id/`, async (req, reply) => {
          const m = auth(req, reply, 'local');
          if (!m) return reply;
          const map = list(state(m));
          const id = idParam(req);
          if (!map.has(id)) return reply.code(404).send({ detail: 'Not found.' });
          const b = body(req);
          const error = validate(b);
          if (error) return invalid(reply, error);
          map.set(id, { ...b });
          return {};
        });
        r.delete(`/update-profile/${path}/:id/`, async (req, reply) => {
          const m = auth(req, reply, 'local');
          if (!m) return reply;
          if (!list(state(m)).delete(idParam(req))) return reply.code(404).send({ detail: 'Not found.' });
          return reply.code(204).send();
        });
      };
      crud(
        'secondary-emails',
        (s) => s.secondaryEmails,
        (b) =>
          !['home', 'work', 'other'].includes(str(b.type))
            ? 'Invalid type'
            : !str(b.value).includes('@')
              ? 'Invalid email'
              : typeof b.cc !== 'boolean'
                ? 'cc must be a boolean'
                : null,
      );
      crud(
        'education',
        (s) => s.education,
        (b) =>
          !str(b.education_name) || !str(b.school_name)
            ? 'education_name and school_name are required'
            : null,
      );
      crud(
        'work',
        (s) => s.work,
        (b) => (!str(b.name) || !str(b.begin_date) ? 'name and begin_date are required' : null),
      );

      r.post('/update-profile/custom-field/:id/', async (req, reply) => {
        const m = auth(req, reply, 'local');
        if (!m) return reply;
        const field = CUSTOM_FIELDS.find((f) => f.id === idParam(req));
        if (!field) return reply.code(404).send({ detail: 'Not found.' });
        const { value } = body(req);
        const ok =
          field.type === 'bool'
            ? typeof value === 'boolean'
            : field.type === 'int'
              ? Number.isInteger(value)
              : field.type === 'choices_single'
                ? field.options.includes(str(value))
                : field.type === 'choices_multi'
                  ? typeof value === 'string' &&
                    value.split(',').every((v) => field.options.includes(v.trim()))
                  : typeof value === 'string';
        if (!ok) return invalid(reply, `Invalid value for ${field.type}`);
        state(m).custom.set(field.id, value);
        return {};
      });

      // ---------- Ebenen und Mitglieder ----------

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
        const viewer = auth(req, reply, 'global');
        if (!viewer) return reply;
        const b = body(req);
        const q = typeof b.query === 'string' ? b.query.toLowerCase() : '';
        const level = typeof b.level === 'number' ? b.level : null;
        const items = data.members
          .filter((m) => m.active && !m.honorary)
          .filter((m) => !q || `${m.first_name} ${m.last_name}`.toLowerCase().includes(q))
          .filter((m) => level === null || m.clubId === level || ancestor(m.clubId, 2)?.id === level)
          .sort((a, b2) => a.last_name.localeCompare(b2.last_name))
          .map((m) => summary(m, viewer));
        return paginate(req, items, 25);
      });

      r.get('/members/:id/', async (req, reply) => {
        if (!auth(req, reply, 'global')) return reply;
        const m = memberById(idParam(req));
        if (!m || !m.active) return reply.code(403).send({ detail: 'Forbidden' });
        return profile(m, false);
      });

      // ---------- Verzeichnis ----------

      r.get('/directory/all-families/', async (req, reply) => {
        if (!auth(req, reply, 'global')) return reply;
        return FAMILIES;
      });

      r.post('/directory/search/', async (req, reply) => {
        if (!auth(req, reply, 'global')) return reply;
        const q = str(body(req).query).toLowerCase();
        const items = data.levels
          .filter((l) => l.sync_level === 1 && (!q || l.name.toLowerCase().includes(q)))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((l) => ({ id: l.id, name: l.name, logo: null, path: l.path }));
        return paginate(req, items, 25);
      });

      // Antwortformat der echten API ist nicht dokumentiert; der Mock liefert Ebenen-Kurzinfos.
      r.get('/directory/query/:ids/', async (req, reply) => {
        if (!auth(req, reply, 'global')) return reply;
        const ids = (req.params as { ids: string }).ids.split(',').map(Number);
        return ids
          .map(levelById)
          .filter((l): l is MockLevel => !!l)
          .map(levelRef);
      });

      r.get('/directory/association-clubs/:id/', async (req, reply) => {
        if (!auth(req, reply, 'global')) return reply;
        const id = idParam(req);
        return data.levels.filter((l) => l.sync_level === 1 && ancestor(l.id, 3)?.id === id).map(levelRef);
      });

      r.get('/directory/:id/', async (req, reply) => {
        const viewer = auth(req, reply, 'global');
        if (!viewer) return reply;
        const l = levelById(idParam(req));
        if (!l) return reply.code(404).send({ detail: 'Not found.' });
        const clubMembers = data.members.filter((m) => m.clubId === l.id && m.active);
        return {
          ...levelRef(l),
          hostname: `${l.subdomain}.roundtable.world`,
          sync_parent: l.parent,
          children: data.levels.filter((c) => c.parent === l.id).map(levelRef),
          details: {},
          // Vorstand: aktuelle Ämter auf genau dieser Ebene (Form angenommen, siehe board.ts).
          board: data.members
            .filter((m) => m.active)
            .flatMap((m) =>
              (m.functions ?? [])
                .filter((f) => f.levelId === l.id && (!f.end_date || f.end_date >= '2026-01-01'))
                .map((f) => ({
                  id: 9000 + m.id,
                  member: summary(m, viewer),
                  function: { id: f.functionId, name: f.functionName },
                  start_date: f.start_date,
                  end_date: f.end_date,
                })),
            ),
          board_assistants: [],
          honorary_members:
            l.sync_level === 1 ? clubMembers.filter((m) => m.honorary).map((m) => summary(m, viewer)) : [],
          members:
            l.sync_level === 1 ? clubMembers.filter((m) => !m.honorary).map((m) => summary(m, viewer)) : [],
        };
      });

      // ---------- Favoriten ----------

      r.get('/favorites/', async (req, reply) => {
        const m = auth(req, reply, 'global');
        if (!m) return reply;
        const s = state(m);
        return {
          favorite_members: [...s.favoriteMembers].map(memberById).flatMap((f) =>
            f
              ? [
                  {
                    id: f.id,
                    first_name: f.first_name,
                    last_name: f.last_name,
                    profile_pic_url: picUrl(f),
                    club_path: levelById(f.clubId)!.path,
                  },
                ]
              : [],
          ),
          favorite_levels: [...s.favoriteLevels]
            .map(levelById)
            .flatMap((l) => (l ? [{ id: l.id, name: l.name, logo_url: null, path: l.path }] : [])),
        };
      });

      const favoriteTarget = (req: FastifyRequest) => {
        const { type, id } = req.params as { type: string; id: string };
        const n = Number(id);
        if (type === 'member')
          return memberById(n)?.active ? { set: 'favoriteMembers' as const, id: n } : null;
        if (type === 'level') return levelById(n) ? { set: 'favoriteLevels' as const, id: n } : null;
        return null;
      };
      r.post('/favorites/:type/:id/', async (req, reply) => {
        const m = auth(req, reply, 'global');
        if (!m) return reply;
        const t = favoriteTarget(req);
        if (!t) return reply.code(404).send({ detail: 'Not found.' });
        state(m)[t.set].add(t.id);
        return reply.code(201).send();
      });
      r.delete('/favorites/:type/:id/', async (req, reply) => {
        const m = auth(req, reply, 'global');
        if (!m) return reply;
        const t = favoriteTarget(req);
        if (!t) return reply.code(404).send({ detail: 'Not found.' });
        state(m)[t.set].delete(t.id);
        return reply.code(204).send();
      });

      // ---------- Benachrichtigungen ----------

      r.post('/notifications/birthday/', async (req, reply) => {
        const m = auth(req, reply, 'global');
        if (!m) return reply;
        const { enabled } = body(req);
        if (typeof enabled !== 'boolean') return invalid(reply, 'enabled must be a boolean');
        state(m).birthdayNotifications = enabled;
        return {};
      });

      // ---------- Veranstaltungen ----------

      const event = (
        id: number,
        name: string,
        eventType: string,
        levelId: number,
        start: string,
        end: string,
        extra: Record<string, unknown> = {},
      ) => {
        const level = levelById(levelId)!;
        return {
          id,
          name,
          description: `<p>${name}</p>`,
          internal_type: 'internal',
          cover_picture_url: null,
          external_url: null,
          start_date: start,
          end_date: end,
          event_type: eventType,
          club: { id: level.id, name: level.name },
          shared_with_type: ['club', 'area', 'association', 'family'][level.sync_level - 1],
          shared_with_level: levelRef(level),
          has_signup: false,
          signup_start_date: null,
          signup_deadline: null,
          signup_status: null,
          is_registration_active: false,
          highlighted: false,
          ...extra,
        };
      };
      const events = [
        event(
          501,
          'Distriktsversammlung Nord',
          'as-statutory',
          20,
          '2027-03-14T10:00:00Z',
          '2027-03-14T16:00:00Z',
        ),
        event(502, 'Halbjahrestreffen RTD', 'hym', 10, '2027-05-01T09:00:00Z', '2027-05-02T14:00:00Z', {
          highlighted: true,
          has_signup: true,
          signup_deadline: '2027-04-15T23:59:00Z',
          is_registration_active: true,
        }),
        event(503, 'Tischabend RT 1', 'number', 101, '2027-01-12T19:00:00Z', '2027-01-12T23:00:00Z'),
      ];
      const STATUTORY = ['club_agm', 'hym', 'wm', 'agm', 'as-statutory', 'statutory'];
      const eventList =
        (filter: (e: (typeof events)[number], m: MockMember) => boolean) =>
        async (req: FastifyRequest, reply: FastifyReply) => {
          const m = auth(req, reply, 'global');
          if (!m) return reply;
          const q = str(body(req).query).toLowerCase();
          const items = events
            .filter((e) => filter(e, m) && (!q || e.name.toLowerCase().includes(q)))
            .map((e) => ({ ...e, signup_status: state(m).attending.has(e.id) ? 1 : e.signup_status }));
          return paginate(req, items, 10);
        };
      r.post(
        '/events/search/',
        eventList(() => true),
      );
      r.post(
        '/events/statutory/',
        eventList((e) => STATUTORY.includes(e.event_type)),
      );
      r.post(
        '/events/list/',
        eventList(() => true),
      );
      r.post(
        '/events/attending/',
        eventList((e, m) => state(m).attending.has(e.id)),
      );
      r.get('/events/highlighted/', async (req, reply) => {
        if (!auth(req, reply, 'global')) return reply;
        return { results: events.filter((e) => e.highlighted).slice(0, 3) };
      });

      // ---------- Geolocation (8 Anfragen / Token / Minute) ----------

      r.post('/geolocation/set-permission/', async (req, reply) => {
        const m = geoAuth(req, reply);
        if (!m) return reply;
        const { enabled } = body(req);
        if (typeof enabled !== 'boolean') return invalid(reply, 'enabled must be a boolean');
        const s = state(m);
        s.geolocation = enabled;
        if (!enabled) s.location = null;
        return {};
      });

      r.post('/geolocation/update-location/', async (req, reply) => {
        const m = geoAuth(req, reply);
        if (!m) return reply;
        const b = body(req) as {
          coords?: { latitude?: unknown; longitude?: unknown };
          location?: { name?: unknown; country?: unknown };
          speed?: unknown;
          accuracy?: unknown;
        };
        const { latitude, longitude } = b.coords ?? {};
        if (
          typeof latitude !== 'number' ||
          typeof longitude !== 'number' ||
          typeof b.location?.name !== 'string' ||
          typeof b.location?.country !== 'string' ||
          typeof b.speed !== 'number' ||
          typeof b.accuracy !== 'number'
        ) {
          return invalid(reply, 'coords, location, speed and accuracy are required');
        }
        const s = state(m);
        if (!s.geolocation) return reply.code(403).send({ detail: 'Geolocation permission not given.' });
        s.location = {
          coords: { latitude, longitude },
          location: { name: b.location.name, country: b.location.country },
          speed: b.speed,
          at: Date.now(),
        };
        return {};
      });

      r.get('/geolocation/nearby-members/', async (req, reply) => {
        const m = geoAuth(req, reply);
        if (!m) return reply;
        const warm = (s: MemberState) => s.geolocation && s.location && Date.now() - s.location.at < 7 * DAY;
        const own = state(m);
        if (!warm(own)) return reply.code(403).send({ detail: 'No valid location.' });
        const here = own.location!.coords;
        return data.members
          .filter((o) => o.id !== m.id && o.active && warm(state(o)))
          .map((o) => {
            const loc = state(o).location!;
            return {
              member: summary(o, m),
              distance: Math.round(distanceKm(here, loc.coords) * 10) / 10,
              speed: loc.speed,
              lastseen: new Date(loc.at).toISOString(),
              coords: loc.coords,
              location: loc.location,
            };
          })
          .filter((n) => n.distance <= 100)
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 20);
      });
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

/** Entfernung zweier Koordinaten in km (Haversine). */
function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
