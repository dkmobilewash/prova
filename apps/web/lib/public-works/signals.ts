/**
 * The pure half of the public-works engine: what a signal MEANS, which
 * slice of the state is stalest, and how a firm's name matches across two
 * registries that spell it differently. No network, no database — the sync
 * and the page both call this, and the tests pin it.
 */

export type SignalKind = "ECPR_FILING" | "PROJECT_LISTING";

export type Signal = {
  kind: SignalKind;
  project: string;
  awardingBody: string | null;
  primeContractor: string | null;
  occurredOn: Date;
};

/** 1 = in market this week; 2 = on the public-works record, not this week;
 * 3 = nothing public says they do prevailing-wage work. */
export type Tier = 1 | 2 | 3;

export const ECPR_WINDOW_DAYS = 60;
export const AWARD_WINDOW_DAYS = 180;

const DAY = 24 * 60 * 60 * 1000;

export function tierFor(signals: Signal[], today: Date): Tier {
  for (const s of signals) {
    const age = (today.getTime() - s.occurredOn.getTime()) / DAY;
    if (s.kind === "ECPR_FILING" && age <= ECPR_WINDOW_DAYS) return 1;
    if (s.kind === "PROJECT_LISTING" && age <= AWARD_WINDOW_DAYS) return 1;
  }
  return signals.length > 0 ? 2 : 3;
}

/** The newest signal, filings before listings on a tie, because a filing is
 * the firm doing the paperwork and a listing is a GC saying they will. */
export function leadSignal(signals: Signal[]): Signal | null {
  return (
    [...signals].sort((a, b) => b.occurredOn.getTime() - a.occurredOn.getTime() || (a.kind === "ECPR_FILING" ? -1 : 1))[0] ??
    null
  );
}

/** The sentence that opens the call or the email. Names the SOURCE — "on
 * the DIR list" — because a public fact with its source named reads as
 * research, and the same fact without one reads as surveillance. */
export function factFor(signals: Signal[]): string {
  const s = leadSignal(signals);
  if (!s) return "";
  const when = s.occurredOn.toISOString().slice(0, 10);
  if (s.kind === "ECPR_FILING") {
    return `filed certified payroll ${when} on ${s.project}${s.awardingBody ? ` for ${s.awardingBody}` : ""} (DIR eCPR list)`;
  }
  return `listed as a sub on ${s.project}${s.awardingBody ? ` (${s.awardingBody}` : ""}${
    s.primeContractor ? `${s.awardingBody ? ", " : " ("}GC ${s.primeContractor}` : ""
  }${s.awardingBody || s.primeContractor ? ")" : ""}, awarded ${when} (DIR project list)`;
}

/**
 * Names across CSLB and DIR: CSLB prints `BUSINESSNAME` upper-case and often
 * the DBA; DIR prints the legal entity as the firm typed it. Strip the
 * corporate furniture and punctuation and compare what is left. Measured
 * 2026-10-13: this matches 82% of the active trade filers; the rest are
 * truncated or legal-entity-only names.
 */
export function nameKey(name: string | null | undefined): string {
  let s = (name ?? "").toUpperCase().replace(/&/g, " AND ").replace(/'/g, "");
  s = s.replace(/\bDBA\b.*$/, "");
  s = s.replace(/\b(INC|INCORPORATED|CORP|CORPORATION|LLC|L L C|CO|COMPANY|LTD|THE|A CALIFORNIA CORPORATION)\b/g, " ");
  return s.replace(/[^A-Z0-9]/g, "");
}

/** A lookup from name key to licence, dropping keys two firms share —
 * a wrong match is worse than no match, because the fact goes in an email. */
export function nameIndex(firms: Array<{ licence: string; name: string; fullName: string | null }>): Map<string, string> {
  const seen = new Map<string, string | null>();
  for (const f of firms) {
    for (const key of new Set([nameKey(f.name), nameKey(f.fullName)])) {
      if (!key) continue;
      const prior = seen.get(key);
      seen.set(key, prior === undefined || prior === f.licence ? f.licence : null);
    }
  }
  const out = new Map<string, string>();
  for (const [k, v] of seen) if (v) out.set(k, v);
  return out;
}

/** California's 58 counties, as DIR spells them in the eCPR county filter. */
export const COUNTIES = [
  "Alameda", "Alpine", "Amador", "Butte", "Calaveras", "Colusa", "Contra Costa", "Del Norte", "El Dorado", "Fresno",
  "Glenn", "Humboldt", "Imperial", "Inyo", "Kern", "Kings", "Lake", "Lassen", "Los Angeles", "Madera", "Marin",
  "Mariposa", "Mendocino", "Merced", "Modoc", "Mono", "Monterey", "Napa", "Nevada", "Orange", "Placer", "Plumas",
  "Riverside", "Sacramento", "San Benito", "San Bernardino", "San Diego", "San Francisco", "San Joaquin",
  "San Luis Obispo", "San Mateo", "Santa Barbara", "Santa Clara", "Santa Cruz", "Shasta", "Sierra", "Siskiyou",
  "Solano", "Sonoma", "Stanislaus", "Sutter", "Tehama", "Trinity", "Tulare", "Tuolumne", "Ventura", "Yolo", "Yuba",
] as const;

export const SLICE_KEYS = {
  master: "cslb:master",
  personnel: "cslb:personnel",
  links: "dir:links",
  ecpr: (county: string) => `ecpr:${county}`,
} as const;

export const FIRM_REFRESH_DAYS = 7;
export const LINKS_REFRESH_DAYS = 7;
export const ECPR_REFRESH_DAYS = 7;

export type SliceState = { key: string; syncedAt: Date };

/**
 * Which slice to pull next. Firms before signals (a signal with no firm to
 * attach to is dropped), then the stalest thing. Returns null when nothing
 * is older than its refresh interval — the sync then does no network at all.
 */
export function nextSlice(states: SliceState[], now: Date): string | null {
  const at = new Map(states.map((s) => [s.key, s.syncedAt.getTime()]));
  const stale = (key: string, days: number) => now.getTime() - (at.get(key) ?? 0) > days * DAY;
  if (stale(SLICE_KEYS.master, FIRM_REFRESH_DAYS)) return SLICE_KEYS.master;
  if (stale(SLICE_KEYS.personnel, FIRM_REFRESH_DAYS)) return SLICE_KEYS.personnel;
  if (stale(SLICE_KEYS.links, LINKS_REFRESH_DAYS)) return SLICE_KEYS.links;
  let oldest: { key: string; t: number } | null = null;
  for (const county of COUNTIES) {
    const key = SLICE_KEYS.ecpr(county);
    const t = at.get(key) ?? 0;
    if (now.getTime() - t > ECPR_REFRESH_DAYS * DAY && (!oldest || t < oldest.t)) oldest = { key, t };
  }
  return oldest?.key ?? null;
}

/** Date windows for an eCPR query: one window, or halves when the last pull
 * of this county was capped. Recurses until a window is two days or less. */
export function ecprWindows(from: Date, to: Date, capped: boolean): Array<{ dateFrom: string; dateTo: string }> {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (!capped || to.getTime() - from.getTime() <= 2 * DAY) return [{ dateFrom: iso(from), dateTo: iso(to) }];
  const mid = new Date(from.getTime() + Math.floor((to.getTime() - from.getTime()) / 2));
  return [...ecprWindows(from, mid, true), ...ecprWindows(new Date(mid.getTime() + DAY), to, true)];
}
