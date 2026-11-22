import { TtlCache } from './cache.js';
import { SlidingWindowLimiter } from './limiter.js';
import type {
  WorldEvent,
  WorldEventSearch,
  WorldFunctionConfig,
  WorldLevelDetails,
  WorldLevelRef,
  WorldLoginSuccess,
  WorldMemberSearch,
  WorldMemberSummary,
  WorldMyLevels,
  WorldMyProfile,
  WorldPage,
} from './types.js';

/** Familie Round Table (Standard für `family`). */
export const ROUND_TABLE_FAMILY = 0;

/** Produktive Basis-URL der .WORLD-App-API. */
export const DEFAULT_BASE_URL = 'https://api.roundtable.world/v1/app/';

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
  { kind: 'ok'; data: WorldLoginSuccess } | { kind: 'tfa_required' } | { kind: 'failed'; message: string };

export interface WorldClientOptions {
  /** Basis-URL der API, muss mit "/" enden (Standard: DEFAULT_BASE_URL). */
  baseUrl?: string;
  /** Familie, deren Mitglieder sich anmelden dürfen (`sync_family`, Standard: 0 = Round Table). */
  family?: number;
  fetch?: typeof fetch;
  /** Anfragen pro Token und Minute (API-Limit 100). */
  requestsPerMinute?: number;
  timeoutMs?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export class WorldClient {
  private readonly fetchImpl: typeof fetch;
  private readonly limiter: SlidingWindowLimiter;
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
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  // ---------- Authentifizierung ----------

  async login(username: string, password: string, tfaCode?: string): Promise<LoginResult> {
    // tfa_code nur mitsenden, wenn gesetzt: .WORLD lehnt ein leeres Feld mit "Invalid input data" ab
    // und antwortet ohne Feld mit "tfa_required", falls das Konto 2FA nutzt.
    const res = await this.raw('POST', 'login/', null, {
      username,
      password,
      sync_family: this.family,
      ...(tfaCode ? { tfa_code: tfaCode } : {}),
    });
    if (res.status === 200) return { kind: 'ok', data: res.body as WorldLoginSuccess };
    const body = (res.body ?? {}) as { code?: string; error_message?: string };
    if (res.status === 400 && body.code === 'tfa_required') return { kind: 'tfa_required' };
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return { kind: 'failed', message: body.error_message ?? 'Anmeldung fehlgeschlagen' };
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
    return this.post<WorldPage<WorldMemberSummary>>(
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

  // ---------- Veranstaltungen ----------

  searchEvents(globalToken: string, search: WorldEventSearch, offset = 0): Promise<WorldPage<WorldEvent>> {
    return this.post<WorldPage<WorldEvent>>(`events/search/?limit=10&offset=${offset}`, globalToken, {
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
    return this.post<WorldPage<WorldEvent>>(`events/statutory/?limit=10&offset=${offset}`, globalToken, {
      query,
    });
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

  private post<T>(path: string, token: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, token, body);
  }

  private async request<T>(method: string, path: string, token: string, body?: unknown): Promise<T> {
    const res = await this.raw(method, path, token, body);
    if (res.status >= 200 && res.status < 300) return res.body as T;
    if (res.status === 403 || res.status === 401) throw new WorldForbiddenError();
    if (res.status === 404) throw new WorldApiError('Nicht gefunden', 404);
    if (res.status === 429 || res.status >= 500) {
      throw new WorldUnavailableError(`.WORLD antwortet mit ${res.status}`, res.status);
    }
    throw new WorldApiError(`.WORLD antwortet mit ${res.status}`, res.status);
  }

  /** Führt die Anfrage aus – mit Drossel pro Token, Zeitlimit und Wiederholung bei 429/5xx/Netzfehler. */
  private async raw(
    method: string,
    path: string,
    token: string | null,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const url = new URL(path, this.baseUrl).toString();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Token ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    for (let attempt = 0; ; attempt++) {
      if (token) await this.limiter.acquire(token);
      let status: number;
      let parsed: unknown = null;
      let retryAfterMs: number | null = null;
      try {
        const res = await this.fetchImpl(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
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
        if (attempt >= this.maxRetries) {
          throw new WorldUnavailableError(`.WORLD nicht erreichbar: ${(err as Error).message}`);
        }
        await this.sleep(this.backoff(attempt));
        continue;
      }
      const retryable = status === 429 || status === 502 || status === 503 || status === 504;
      // Login nie automatisch wiederholen (2FA-Codes, Sperren).
      if (retryable && path !== 'login/' && attempt < this.maxRetries) {
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
