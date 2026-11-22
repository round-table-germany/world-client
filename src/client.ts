import { TtlCache } from './cache.js';
import { SlidingWindowLimiter } from './limiter.js';
import type {
  FavoriteType,
  PrivacyField,
  PrivacyLevel,
  WorldAddress,
  WorldBillingAddressUpdate,
  WorldCreated,
  WorldCustomFieldValue,
  WorldDirectoryHit,
  WorldEducation,
  WorldEvent,
  WorldEventSearch,
  WorldFamily,
  WorldFavorites,
  WorldFunctionConfig,
  WorldLevelDetails,
  WorldLevelRef,
  WorldLocationUpdate,
  WorldLoginSuccess,
  WorldMemberSearch,
  WorldMemberSummary,
  WorldMyLevels,
  WorldMyProfile,
  WorldNearbyMember,
  WorldPage,
  WorldPersonalUpdate,
  WorldPhoneUpdate,
  WorldSecondaryEmail,
  WorldSocialMediaUpdate,
  WorldWork,
} from './types.js';

/** Familie Round Table (Standard für `family`). */
export const ROUND_TABLE_FAMILY = 0;

/** Produktive Basis-URL der .WORLD-App-API. */
export const DEFAULT_BASE_URL = 'https://api.roundtable.world/v1/app/';

/** Basis-URL der Demo-Umgebung von .WORLD. */
export const DEMO_BASE_URL = 'https://api.roundtable-demo.world/v1/app/';

export class WorldApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'WorldApiError';
  }
}

/** 403: Token abgelaufen/ungültig, Mitglied inaktiv oder kein Zugriff. */
export class WorldForbiddenError extends WorldApiError {
  constructor(message = 'Zugriff verweigert') {
    super(message, 403);
    this.name = 'WorldForbiddenError';
  }
}

/** .WORLD nicht erreichbar, Zeitüberschreitung oder Rate-Limit erschöpft. */
export class WorldUnavailableError extends WorldApiError {
  constructor(message: string, status = 0) {
    super(message, status);
    this.name = 'WorldUnavailableError';
  }
}

export type LoginResult =
  | { kind: 'ok'; data: WorldLoginSuccess }
  | { kind: 'tfa_required' }
  | { kind: 'failed'; message: string; code?: string };

export interface WorldClientOptions {
  /** Basis-URL der API, muss mit "/" enden (Standard: DEFAULT_BASE_URL). */
  baseUrl?: string;
  /** Familie, deren Mitglieder sich anmelden dürfen (`sync_family`, Standard: 0 = Round Table). */
  family?: number;
  fetch?: typeof fetch;
  /** Anfragen pro Token und Minute (API-Limit 100). */
  requestsPerMinute?: number;
  /** Anfragen pro Token und Minute an `geolocation/…` (eigenes API-Limit 8, zusätzlich zum Standard-Limit). */
  geolocationRequestsPerMinute?: number;
  timeoutMs?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Wiederholungsregel einer Anfrage:
 * - `all`: bei 429, 502/503/504 und Netzfehlern (lesende Aufrufe)
 * - `throttle`: nur bei 429 – die Anfrage wurde abgewiesen, bevor sie etwas bewirkt hat (schreibende Aufrufe)
 * - `none`: nie (Login: 2FA-Codes, Sperren)
 */
type RetryPolicy = 'all' | 'throttle' | 'none';

interface RequestOptions {
  retry?: RetryPolicy;
  /** Zusätzlich die Geolocation-Drossel anwenden. */
  geo?: boolean;
}

type Body = FormData | object | undefined;

export class WorldClient {
  private readonly fetchImpl: typeof fetch;
  private readonly limiter: SlidingWindowLimiter;
  private readonly geoLimiter: SlidingWindowLimiter;
  private readonly cache = new TtlCache<unknown>();
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly baseUrl: string;
  private readonly family: number;

  constructor(private readonly opts: WorldClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.family = opts.family ?? ROUND_TABLE_FAMILY;
    this.fetchImpl = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.limiter = new SlidingWindowLimiter(opts.requestsPerMinute ?? 90, MINUTE, Date.now, this.sleep);
    this.geoLimiter = new SlidingWindowLimiter(
      opts.geolocationRequestsPerMinute ?? 8,
      MINUTE,
      Date.now,
      this.sleep,
    );
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  // ---------- Authentifizierung ----------

  async login(username: string, password: string, tfaCode?: string): Promise<LoginResult> {
    // tfa_code nur mitsenden, wenn gesetzt: .WORLD lehnt ein leeres Feld mit "Invalid input data" ab
    // und antwortet ohne Feld mit "tfa_required", falls das Konto 2FA nutzt.
    const res = await this.raw(
      'POST',
      'login/',
      null,
      {
        username,
        password,
        sync_family: this.family,
        ...(tfaCode ? { tfa_code: tfaCode } : {}),
      },
      // Login nie automatisch wiederholen (2FA-Codes, Sperren).
      { retry: 'none' },
    );
    if (res.status === 200) return { kind: 'ok', data: res.body as WorldLoginSuccess };
    const body = (res.body ?? {}) as { code?: string; error_message?: string };
    if (res.status === 400 && body.code === 'tfa_required') return { kind: 'tfa_required' };
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return {
        kind: 'failed',
        message: body.error_message ?? 'Anmeldung fehlgeschlagen',
        ...(body.code ? { code: body.code } : {}),
      };
    }
    throw new WorldUnavailableError(`Login: unerwartete Antwort ${res.status}`, res.status);
  }

  // ---------- Eigene Daten ----------

  myProfile(localToken: string): Promise<WorldMyProfile> {
    return this.get<WorldMyProfile>('my-profile/', localToken);
  }

  myLevels(globalToken: string): Promise<WorldMyLevels> {
    return this.get<WorldMyLevels>('my-levels/', globalToken);
  }

  // ---------- Mitglieder ----------

  /** Profil eines Mitglieds; wirft WorldForbiddenError bei inaktivem Mitglied (oder fehlendem Zugriff). */
  member(globalToken: string, memberId: number): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(`members/${memberId}/`, globalToken);
  }

  async searchMembers(
    globalToken: string,
    search: WorldMemberSearch,
    offset = 0,
  ): Promise<WorldPage<WorldMemberSummary>> {
    return this.search<WorldPage<WorldMemberSummary>>(
      `members/search/?limit=25&offset=${offset}`,
      globalToken,
      {
        level: null,
        query: '',
        club_number: null,
        job_sector: null,
        job_function: null,
        phone: null,
        city: null,
        function_name: null,
        function_between_start: null,
        function_between_end: null,
        order_by: 'last_name',
        ...search,
      },
    );
  }

  functionsConfig(globalToken: string): Promise<WorldFunctionConfig[]> {
    return this.cached('functions', 24 * HOUR, () =>
      this.get<WorldFunctionConfig[]>('members/config/functions/', globalToken),
    );
  }

  // ---------- Verzeichnis ----------

  level(globalToken: string, levelId: number, { fresh = false } = {}): Promise<WorldLevelDetails> {
    const load = () => this.get<WorldLevelDetails>(`directory/${levelId}/`, globalToken);
    return fresh ? load() : this.cached(`level:${levelId}`, HOUR, load);
  }

  associationClubs(globalToken: string, associationId: number): Promise<WorldLevelRef[]> {
    return this.cached(`assoc-clubs:${associationId}`, 24 * HOUR, () =>
      this.get<WorldLevelRef[]>(`directory/association-clubs/${associationId}/`, globalToken),
    );
  }

  /** Alle Familien (Round Table International, 41 Club International, …); 24 h gecacht. */
  allFamilies(globalToken: string): Promise<WorldFamily[]> {
    return this.cached('families', 24 * HOUR, () =>
      this.get<WorldFamily[]>('directory/all-families/', globalToken),
    );
  }

  /** Clubs nach Namen suchen (25 pro Seite, nach Name sortiert). */
  searchDirectory(globalToken: string, query: string, offset = 0): Promise<WorldPage<WorldDirectoryHit>> {
    return this.search<WorldPage<WorldDirectoryHit>>(
      `directory/search/?limit=25&offset=${offset}`,
      globalToken,
      {
        query,
      },
    );
  }

  /**
   * Kurzinfos zu mehreren Ebenen mit einem Aufruf (spart Rate-Limit gegenüber vielen level()-Aufrufen).
   * Das Antwortformat ist von .WORLD nicht dokumentiert, daher `unknown`.
   */
  async queryLevels(globalToken: string, levelIds: readonly number[]): Promise<unknown> {
    if (levelIds.length === 0) return [];
    return this.get<unknown>(`directory/query/${levelIds.join(',')}/`, globalToken);
  }

  // ---------- Veranstaltungen ----------

  searchEvents(globalToken: string, search: WorldEventSearch, offset = 0): Promise<WorldPage<WorldEvent>> {
    return this.search<WorldPage<WorldEvent>>(`events/search/?limit=10&offset=${offset}`, globalToken, {
      query: '',
      start_date: null,
      end_date: null,
      organising_level: null,
      organising_region: null,
      organising_sync_level: null,
      event_type: null,
      ...search,
    });
  }

  statutoryEvents(globalToken: string, query = '', offset = 0): Promise<WorldPage<WorldEvent>> {
    return this.search<WorldPage<WorldEvent>>(`events/statutory/?limit=10&offset=${offset}`, globalToken, {
      query,
    });
  }

  /** Standardliste: kommende 12 Monate, eigene Assoziation (10 pro Seite). */
  listEvents(globalToken: string, query = '', offset = 0): Promise<WorldPage<WorldEvent>> {
    return this.search<WorldPage<WorldEvent>>(`events/list/?limit=10&offset=${offset}`, globalToken, {
      query,
    });
  }

  /** Veranstaltungen, zu denen der Nutzer angemeldet ist (−50 bis +400 Tage, 10 pro Seite). */
  attendingEvents(globalToken: string, query = '', offset = 0): Promise<WorldPage<WorldEvent>> {
    return this.search<WorldPage<WorldEvent>>(`events/attending/?limit=10&offset=${offset}`, globalToken, {
      query,
    });
  }

  /** Bis zu 3 hervorgehobene kommende Veranstaltungen (nicht paginiert). */
  async highlightedEvents(globalToken: string): Promise<WorldEvent[]> {
    const res = await this.get<{ results?: WorldEvent[] } | null>('events/highlighted/', globalToken);
    return res?.results ?? [];
  }

  // ---------- Benachrichtigungen ----------

  /** Geburtstagshinweise für Favoriten ein- oder ausschalten. */
  async setBirthdayNotifications(globalToken: string, enabled: boolean): Promise<void> {
    await this.post('notifications/birthday/', globalToken, { enabled });
  }

  // ---------- Favoriten ----------

  favorites(globalToken: string): Promise<WorldFavorites> {
    return this.get<WorldFavorites>('favorites/', globalToken);
  }

  async addFavorite(globalToken: string, type: FavoriteType, id: number): Promise<void> {
    await this.post(`favorites/${type}/${id}/`, globalToken, undefined);
    this.cache.deletePrefix('level:'); // is_favorite in Mitgliederlisten
  }

  async removeFavorite(globalToken: string, type: FavoriteType, id: number): Promise<void> {
    await this.delete(`favorites/${type}/${id}/`, globalToken);
    this.cache.deletePrefix('level:');
  }

  // ---------- Eigenes Profil bearbeiten (lokales Token) ----------

  async setCrossFamilySharing(localToken: string, enabled: boolean): Promise<void> {
    await this.post('update-profile/cross-family-sharing/', localToken, { enabled });
  }

  /** Sichtbarkeit eines Felds; `all` setzt `cross_family_optin` voraus. */
  async setPrivacy(localToken: string, field: PrivacyField, level: PrivacyLevel): Promise<void> {
    await this.post('update-profile/privacy-settings/', localToken, { field, level });
  }

  async updatePersonal(localToken: string, data: WorldPersonalUpdate): Promise<void> {
    await this.post('update-profile/edit/personal/', localToken, data);
    this.cache.deletePrefix('level:'); // Name in Mitgliederlisten
  }

  async updateAddress(localToken: string, address: WorldAddress): Promise<void> {
    await this.post('update-profile/edit/address/', localToken, address);
  }

  async updateBillingAddress(localToken: string, data: WorldBillingAddressUpdate): Promise<void> {
    await this.post('update-profile/edit/billing-address/', localToken, data);
  }

  async updatePhone(localToken: string, data: WorldPhoneUpdate): Promise<void> {
    await this.post('update-profile/edit/phone/', localToken, data);
  }

  /**
   * Neue Primär-E-Mail; .WORLD verschickt eine Bestätigungs-Mail. Ist die Adresse schon vergeben,
   * wirft der Aufruf einen WorldApiError mit `status` 400 und dem `code` von .WORLD.
   */
  async updatePrimaryEmail(localToken: string, email: string): Promise<void> {
    await this.post('update-profile/edit/primary-email/', localToken, { email });
  }

  /** Neues Profilbild (JPG oder PNG; .WORLD verkleinert auf höchstens 640×640). */
  async updateProfilePic(localToken: string, image: Blob, filename = 'profile.jpg'): Promise<void> {
    const form = new FormData();
    form.append('profile_pic', image, filename);
    await this.post('update-profile/edit/profile-pic/', localToken, form);
    this.cache.deletePrefix('level:'); // profile_pic_url in Mitgliederlisten
  }

  async updateSocialMedia(localToken: string, data: WorldSocialMediaUpdate): Promise<void> {
    await this.post('update-profile/edit/social-media/', localToken, data);
  }

  addSecondaryEmail(localToken: string, data: WorldSecondaryEmail): Promise<WorldCreated> {
    return this.post<WorldCreated>('update-profile/secondary-emails/', localToken, data);
  }

  async updateSecondaryEmail(localToken: string, id: number, data: WorldSecondaryEmail): Promise<void> {
    await this.put(`update-profile/secondary-emails/${id}/`, localToken, data);
  }

  async deleteSecondaryEmail(localToken: string, id: number): Promise<void> {
    await this.delete(`update-profile/secondary-emails/${id}/`, localToken);
  }

  addEducation(localToken: string, data: WorldEducation): Promise<WorldCreated> {
    return this.post<WorldCreated>('update-profile/education/', localToken, data);
  }

  async updateEducation(localToken: string, id: number, data: WorldEducation): Promise<void> {
    await this.put(`update-profile/education/${id}/`, localToken, data);
  }

  async deleteEducation(localToken: string, id: number): Promise<void> {
    await this.delete(`update-profile/education/${id}/`, localToken);
  }

  addWork(localToken: string, data: WorldWork): Promise<WorldCreated> {
    return this.post<WorldCreated>('update-profile/work/', localToken, data);
  }

  async updateWork(localToken: string, id: number, data: WorldWork): Promise<void> {
    await this.put(`update-profile/work/${id}/`, localToken, data);
  }

  async deleteWork(localToken: string, id: number): Promise<void> {
    await this.delete(`update-profile/work/${id}/`, localToken);
  }

  /**
   * Wert eines eigenen Felds (`custom-<id>` in `my-profile/`). Format je Feldtyp: text, textarea, link, date,
   * datetime und choices_single als string, choices_multi kommagetrennt, int/auto als Zahl, bool als boolean.
   */
  async updateCustomField(localToken: string, fieldId: number, value: WorldCustomFieldValue): Promise<void> {
    await this.post(`update-profile/custom-field/${fieldId}/`, localToken, { value });
  }

  // ---------- Geolocation (eigene Drossel) ----------

  async setGeolocationPermission(globalToken: string, enabled: boolean): Promise<void> {
    await this.request(
      'POST',
      'geolocation/set-permission/',
      globalToken,
      { enabled },
      { retry: 'throttle', geo: true },
    );
  }

  /** Eigene Position melden; Ortsname und Land (Geocoding) liefert der Aufrufer. */
  async updateLocation(globalToken: string, data: WorldLocationUpdate): Promise<void> {
    await this.request('POST', 'geolocation/update-location/', globalToken, data, {
      retry: 'throttle',
      geo: true,
    });
  }

  /**
   * Bis zu 20 Mitglieder im Umkreis von 100 km. Wirft WorldForbiddenError ohne Freigabe
   * oder ohne gemeldete Position aus den letzten 7 Tagen.
   */
  async nearbyMembers(globalToken: string): Promise<WorldNearbyMember[]> {
    const res = await this.request<WorldNearbyMember[] | null>(
      'GET',
      'geolocation/nearby-members/',
      globalToken,
      undefined,
      { geo: true },
    );
    return res ?? [];
  }

  // ---------- Paginierung ----------

  /**
   * Durchläuft alle Seiten eines paginierten Endpunkts, z. B.
   * `for await (const m of world.paginate((o) => world.searchMembers(token, { query }, o))) { … }`
   */
  async *paginate<T>(fetchPage: (offset: number) => Promise<WorldPage<T>>): AsyncGenerator<T> {
    let offset = 0;
    for (;;) {
      const page = await fetchPage(offset);
      yield* page.results;
      if (!page.next || page.results.length === 0) return;
      offset += page.results.length;
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  // ---------- Intern ----------

  private async cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    return (await this.cache.getOrLoad(key, ttlMs, load)) as T;
  }

  private get<T>(path: string, token: string): Promise<T> {
    return this.request<T>('GET', path, token);
  }

  /** Lesender POST (Suche, Liste): darf wiederholt werden. */
  private search<T>(path: string, token: string, body: object): Promise<T> {
    return this.request<T>('POST', path, token, body, { retry: 'all' });
  }

  /** Schreibender POST: nur bei 429 wiederholen, damit nichts doppelt angelegt wird. */
  private post<T = unknown>(path: string, token: string, body: Body): Promise<T> {
    return this.request<T>('POST', path, token, body, { retry: 'throttle' });
  }

  private put<T = unknown>(path: string, token: string, body: object): Promise<T> {
    return this.request<T>('PUT', path, token, body, { retry: 'throttle' });
  }

  private delete<T = unknown>(path: string, token: string): Promise<T> {
    return this.request<T>('DELETE', path, token, undefined, { retry: 'throttle' });
  }

  private async request<T>(
    method: string,
    path: string,
    token: string,
    body?: Body,
    opts: RequestOptions = {},
  ): Promise<T> {
    const res = await this.raw(method, path, token, body, opts);
    // Leere Antworten (204, 201 ohne Inhalt) liefern null.
    if (res.status >= 200 && res.status < 300) return res.body as T;
    const err = (res.body ?? {}) as { code?: unknown; error_message?: unknown };
    const code = typeof err.code === 'string' ? err.code : undefined;
    const message = typeof err.error_message === 'string' ? err.error_message : undefined;
    if (res.status === 403 || res.status === 401) throw new WorldForbiddenError(message);
    if (res.status === 404) throw new WorldApiError('Nicht gefunden', 404, code);
    if (res.status === 429 || res.status >= 500) {
      throw new WorldUnavailableError(`.WORLD antwortet mit ${res.status}`, res.status);
    }
    throw new WorldApiError(message ?? `.WORLD antwortet mit ${res.status}`, res.status, code);
  }

  /** Führt die Anfrage aus – mit Drossel pro Token, Zeitlimit und Wiederholung laut `retry`. */
  private async raw(
    method: string,
    path: string,
    token: string | null,
    body?: Body,
    { retry = 'all', geo = false }: RequestOptions = {},
  ): Promise<{ status: number; body: unknown }> {
    const url = new URL(path, this.baseUrl).toString();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Token ${token}`;
    // Bei FormData setzt fetch den Content-Type samt boundary selbst.
    const isForm = body instanceof FormData;
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    const payload = body === undefined ? undefined : isForm ? body : JSON.stringify(body);

    for (let attempt = 0; ; attempt++) {
      if (token) {
        if (geo) await this.geoLimiter.acquire(token);
        await this.limiter.acquire(token);
      }
      let status: number;
      let parsed: unknown = null;
      let retryAfterMs: number | null = null;
      try {
        const res = await this.fetchImpl(url, {
          method,
          headers,
          body: payload,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        status = res.status;
        const text = await res.text();
        if (text) {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = null;
          }
        }
        const ra = res.headers.get('retry-after');
        if (ra && /^\d+$/.test(ra)) retryAfterMs = Number(ra) * 1000;
      } catch (err) {
        // Bei Netzfehlern ist unklar, ob die Anfrage angekommen ist: schreibende Aufrufe nicht wiederholen.
        if (retry !== 'all' || attempt >= this.maxRetries) {
          throw new WorldUnavailableError(`.WORLD nicht erreichbar: ${(err as Error).message}`);
        }
        await this.sleep(this.backoff(attempt));
        continue;
      }
      const retryable =
        retry === 'all'
          ? status === 429 || status === 502 || status === 503 || status === 504
          : retry === 'throttle' && status === 429;
      if (retryable && attempt < this.maxRetries) {
        this.opts.log?.('.WORLD-Anfrage wird wiederholt', { path: stripQuery(path), status, attempt });
        await this.sleep(retryAfterMs ?? this.backoff(attempt));
        continue;
      }
      return { status, body: parsed };
    }
  }

  private backoff(attempt: number): number {
    return Math.min(1000 * 2 ** attempt, 15_000) + Math.floor(Math.random() * 250);
  }
}

function stripQuery(path: string): string {
  const i = path.indexOf('?');
  return i === -1 ? path : path.slice(0, i);
}
