/**
 * Gleitendes Fenster pro Schlüssel (Token): höchstens `max` Starts innerhalb von `windowMs`.
 * .WORLD erlaubt 100 Anfragen / Token / Minute; wir bleiben mit Puffer darunter.
 */
export class SlidingWindowLimiter {
  private readonly starts = new Map<string, number[]>();
  private readonly chains = new Map<string, Promise<void>>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** Wartet, bis für `key` eine weitere Anfrage erlaubt ist (Anfragen pro Schlüssel werden der Reihe nach freigegeben). */
  acquire(key: string): Promise<void> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(() => this.waitForSlot(key));
    // Kette nicht durch Fehler blockieren.
    this.chains.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }

  private async waitForSlot(key: string): Promise<void> {
    for (;;) {
      const t = this.now();
      const list = (this.starts.get(key) ?? []).filter((s) => t - s < this.windowMs);
      if (list.length < this.max) {
        list.push(t);
        this.starts.set(key, list);
        return;
      }
      const waitMs = this.windowMs - (t - list[0]!) + 5;
      this.starts.set(key, list);
      await this.sleep(waitMs);
    }
  }
}
