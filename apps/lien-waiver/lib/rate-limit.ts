import { createHash } from "node:crypto";

/**
 * Rate limits for the two public endpoints that write and send email.
 *
 * A small table rather than a vendor (Diego, 2026-10-08: "testable,
 * portable"). The tool deliberately has NO lead database -- leads go to an
 * inbox and a Resend audience -- so this table holds nothing about anyone:
 * a key is a salted SHA-256 of "ip:<address>" or "email:<address>", and a
 * timestamp. Rows older than two days are deleted as new ones arrive.
 *
 * Insert-then-count, so the check is one round trip and two simultaneous
 * requests cannot both slip under the limit by reading the same count.
 * It counts ATTEMPTS: a refused request still uses up its slot, which is
 * what a limit on a bot should do.
 *
 * FAILS CLOSED IN PRODUCTION. With no database configured, production
 * refuses to send rather than sending without a limit -- the endpoint
 * would otherwise be an open relay that mails any address a PDF. A
 * preview, a laptop and the tests use an in-memory store.
 */

export const LIMITS = {
  /** PDFs made per IP address per hour. Generous: a sub doing a month's
   * waivers for six jobs makes a dozen in a sitting. */
  pdfPerIpPerHour: 30,
  /** Emails sent to one address per day. */
  emailsPerAddressPerDay: 5,
  /** "Notify me" sign-ups per IP per hour. */
  notifyPerIpPerHour: 5,
} as const;

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

export interface RateStore {
  /** Record an attempt for `key` and return how many attempts it has made
   * in the last `windowMs`, this one included. */
  hit(key: string, windowMs: number): Promise<number>;
}

export class MemoryRateStore implements RateStore {
  private events = new Map<string, number[]>();
  constructor(private now: () => number = Date.now) {}
  async hit(key: string, windowMs: number): Promise<number> {
    const now = this.now();
    const kept = (this.events.get(key) ?? []).filter((at) => at > now - windowMs);
    kept.push(now);
    this.events.set(key, kept);
    return kept.length;
  }
}

export class PostgresRateStore implements RateStore {
  private ready: Promise<void> | null = null;
  constructor(private query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>) {}

  private ensure(): Promise<void> {
    // Created on first use so a fresh database needs no setup step. Two
    // statements, both idempotent.
    this.ready ??= this.query(
      `CREATE TABLE IF NOT EXISTS lien_tool_rate_event (
         key text NOT NULL,
         at timestamptz NOT NULL DEFAULT now()
       )`,
    ).then(() => this.query(`CREATE INDEX IF NOT EXISTS lien_tool_rate_event_key_at ON lien_tool_rate_event (key, at)`).then(() => undefined));
    return this.ready;
  }

  async hit(key: string, windowMs: number): Promise<number> {
    await this.ensure();
    await this.query(`DELETE FROM lien_tool_rate_event WHERE at < now() - interval '2 days'`);
    await this.query(`INSERT INTO lien_tool_rate_event (key) VALUES ($1)`, [key]);
    const result = await this.query(
      `SELECT count(*)::int AS n FROM lien_tool_rate_event WHERE key = $1 AND at > now() - ($2::bigint * interval '1 millisecond')`,
      [key, windowMs],
    );
    return Number(result.rows[0]?.n ?? 0);
  }
}

/** The key stored for an IP or an email: salted so the table cannot be
 * reversed into a list of addresses by hashing guesses. */
export function rateKey(kind: "ip" | "email", value: string, salt: string): string {
  return createHash("sha256").update(`${salt}\u0000${kind}:${value.trim().toLowerCase()}`).digest("hex");
}

export async function underLimit(store: RateStore, key: string, limit: number, windowMs: number): Promise<boolean> {
  return (await store.hit(key, windowMs)) <= limit;
}

let shared: { store: RateStore; salt: string } | null | undefined;

/** The store this deployment uses, or null when production has none --
 * which the routes answer with a 503 rather than an unlimited send. */
export async function rateStore(env: Record<string, string | undefined> = process.env): Promise<{ store: RateStore; salt: string } | null> {
  if (shared !== undefined) return shared;
  const url = env.LIEN_TOOL_DATABASE_URL?.trim();
  const production = env.VERCEL_ENV === "production";
  const salt = env.RATE_LIMIT_SALT?.trim() || (production ? "" : "development-salt");
  if (production && (!url || !salt)) {
    shared = null;
    return shared;
  }
  if (url) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 10_000 });
    shared = { store: new PostgresRateStore((sql, params) => pool.query(sql, params)), salt };
  } else {
    shared = { store: new MemoryRateStore(), salt };
  }
  return shared;
}

/** The caller's address as Vercel reports it: the first hop of
 * x-forwarded-for, which Vercel sets and a client cannot prepend to. */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "unknown";
}
