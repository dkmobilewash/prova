import { prisma, type TradeScope } from "@prova/db";
import { createBidPursuit } from "@/lib/actions/bidPursuits";
import {
  CITY_PATTERN,
  LEAD_SIZE_BANDS,
  normaliseUrl,
  US_STATE_CODES,
  type FoundLead,
  type LeadSizeBand,
  type LeadTrade,
} from "@prova/integrations";
import { dayLabel } from "../dates";
import { isWebLink, keepSuggestions, type WebSuggestion } from "../webSuggestions";
import { formDataFrom, throughAction } from "./adapter";
import { readTrade, TRADE_LABELS } from "./bids";
import type {
  CommandContext,
  CommandInput,
  DirectCommandDefinition,
  Executed,
  PreviewLine,
  ResolvedPayload,
  Resolution,
} from "../commands";

/**
 * Lead search, stage 1: "what should we be bidding that nobody told us
 * about" — one region, on demand, no new table. Cyrus's lane (AI).
 *
 * The whole design is arranged around one sentence: THE RISK IS PRECISION,
 * NOT RECALL. Five real leads beat twenty with four bad ones, because a
 * list with an awarded project, a roofing job and a duplicate on it makes
 * every other answer the same assistant gives look untrustworthy. So:
 *
 *   - WHAT LEAVES is decided here, in code, from a fixed vocabulary: the
 *     trades the person NAMED (their words mapped to the five-member enum
 *     by `readTrade`, the same regex set `log_bid_invitation` uses — a word
 *     that names none of them is a question back, never a guess), a city
 *     and a two-letter state (the person's, or the company's HQ from the
 *     Company row when they did not say one), the company's own
 *     public-works answer if it has one, a size BAND only if the person
 *     said one, and today. Nothing derived from their jobs, their prices
 *     or their history — a size band computed from their median job would
 *     be a low-resolution leak of their median job, so it is asked for and
 *     never inferred. The `LeadFinder` type on the context carries exactly
 *     these fields and nothing else (lib/ask/commands.ts).
 *
 *   - WHAT COMES BACK is a claim per row. `findLeads` has already dropped
 *     every lead whose source did not come back from that call's own
 *     search (packages/integrations/src/leads.ts). This file adds the
 *     three decisions the model is never allowed to make because it was
 *     never told who the company is:
 *       · TRADE RELEVANCE, from `readTrade` over the scope and name. A
 *         lead that matches none of the five is shown in a "couldn't
 *         tell" group, last — never asserted as in-trade, never silently
 *         dropped either, because that group is also the review surface
 *         for a missing word in TRADE_WORDS.
 *       · THE BID DATE, compared in code against today. A past date is
 *         badged and sorted last, never hidden: a page can be stale, and a
 *         date can be read off the wrong line.
 *       · DEDUPE against what the company already has: its pursuits (not
 *         DROPPED), its jobs and its logged bid invitations. HIDDEN only on
 *         exact evidence — the same source URL already noted on a pursuit,
 *         or the same normalised project name. Anything fuzzier is BADGED
 *         ("looks like Northgate Medical, already on your pipeline") and
 *         shown, never hidden. The two error modes are not symmetric: a
 *         false duplicate hides a real job the sub then never learns
 *         about, silently, which is the failure that kills the feature; a
 *         false new lead costs one glance and one untick. Same asymmetry
 *         as the two-step delete everywhere else in this app — refuse to
 *         do the irreversible thing quietly.
 *
 *   - NOTHING IS WRITTEN UNTIL THE TAP, and the tap writes ONLY BidPursuit
 *     rows at WATCHING, one per lead left ticked, through the existing
 *     `createBidPursuit` action — its capability check, its parsers, its
 *     sentences. The page's source URL goes in the pursuit's note, which is
 *     also what makes the URL dedupe above work on the next pass. A lead
 *     is not a job and not an invitation: it is the head of the pipeline,
 *     which is what pursuits.prisma says a pursuit is.
 *
 *   - WHEN THE WEB HAS NOTHING IT SAYS SO. No padding, no "similar
 *     projects": an empty pass is a refusal in words, and "the lookup is
 *     unavailable" is a different sentence from "nothing turned up".
 *
 * NOT SalesLead. That is Prova's own CRM for selling Prova. Nothing here
 * reads a sales model, and nothing here is called "lead" in the schema
 * because there is no schema: stage 1 has no memory, by design, so what
 * it costs and how good the leads are can be measured before a table and
 * a schedule are decided (the spec's §11).
 */

const str = (payload: ResolvedPayload, key: string): string | null =>
  typeof payload[key] === "string" ? (payload[key] as string) : null;

/** A fixed radius, not a setting: the spec's one-region stage. */
const RADIUS_MILES = 40;
const MAX_NOTE_CHARS = 1000;
const FUZZY_BADGE_AT = 0.5;

// ------------------------------------------------------------ input parsers

const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};

/** "Long Beach, CA", "Long Beach CA", "Long Beach, California", with or
 * without a trailing zip — as a city and a two-letter code, or null. The
 * city must fit CITY_PATTERN: this is the last thing between a typed
 * string and the outgoing query, and it is a pattern, not a trim. */
export function parseRegion(text: string): { city: string; state: string } | null {
  if (/[\r\n\t]/.test(text)) return null;
  const cleaned = text.trim().replace(/ {2,}/g, " ").replace(/,?\s*\d{5}(?:-\d{4})?$/, "").replace(/,?\s*(?:usa|us|united states)$/i, "");
  const comma = cleaned.lastIndexOf(",");
  let city: string;
  let stateText: string;
  if (comma > 0) {
    city = cleaned.slice(0, comma).trim();
    stateText = cleaned.slice(comma + 1).trim();
  } else {
    const space = cleaned.lastIndexOf(" ");
    if (space < 1) return null;
    city = cleaned.slice(0, space).trim();
    stateText = cleaned.slice(space + 1).trim();
  }
  const state = readState(stateText);
  if (!state || !CITY_PATTERN.test(city)) return null;
  return { city, state };
}

/** A two-letter code or a state's name, as a code. */
export function readState(text: string): string | null {
  const words = text.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
  if (!words) return null;
  const code = words.toUpperCase();
  if (code.length === 2 && US_STATE_CODES.has(code)) return code;
  return STATE_NAMES[words] ?? null;
}

/** The person's words for one or more trades, as enum members, or the
 * piece that named none of the five. "drywall and ceilings" is two;
 * "interior finishes" is a question back. */
export function readTrades(text: string): { trades: LeadTrade[] } | { unknown: string } {
  const pieces = text
    .split(/\s*(?:,|;|\/|\+|&|\band\b|\bor\b)\s*/i)
    .map((piece) => piece.trim())
    .filter(Boolean);
  const trades: LeadTrade[] = [];
  for (const piece of pieces) {
    const read = readTrade(piece);
    if (read.kind === "unknown") return { unknown: piece };
    const scopes: (TradeScope | null)[] = read.kind === "one" ? [read.scope] : read.scopes;
    for (const scope of scopes) if (scope && !trades.includes(scope)) trades.push(scope);
  }
  return { trades };
}

/** "public only" → true; "private" alone → false; "either", "both", "any",
 * or public AND private together → undefined (no filter); anything else
 * → null (unreadable, so ask). */
export function readPublicWork(text: string): boolean | undefined | null {
  const words = text.trim().toLowerCase();
  if (!words) return null;
  if (/\b(?:either|both|any|all|everything|whatever)\b/.test(words)) return undefined;
  const isPublic = /\bpublic\b/.test(words);
  const isPrivate = /\bprivate\b/.test(words);
  if (isPublic && isPrivate) return undefined;
  if (isPrivate) return false;
  if (isPublic) return true;
  return null;
}

/** The person's words for a size band, or null. Bands only — a figure the
 * person names is rounded to a band here and never sent as a number. */
export function readSizeBand(text: string): LeadSizeBand | null {
  const words = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!words) return null;
  const asEnum = words.toUpperCase().replace(/ /g, "_");
  if ((LEAD_SIZE_BANDS as readonly string[]).includes(asEnum)) return asEnum as LeadSizeBand;
  const million = /\b1\s*(?:m\b|mil\b|million\b|,000,000\b)/;
  if (/\b(?:under|below|less than|up to|small)\b/.test(words) && /250/.test(words)) return "UNDER_250K";
  if (/250/.test(words) && million.test(words)) return "FROM_250K_TO_1M";
  if (/\b(?:over|above|more than|at least|large|big)\b/.test(words) && million.test(words)) return "OVER_1M";
  if (/^(?:under|below|less than|up to) 250k?$/.test(words)) return "UNDER_250K";
  return null;
}

const SIZE_BAND_LABELS: Record<LeadSizeBand, string> = {
  UNDER_250K: "under $250,000",
  FROM_250K_TO_1M: "$250,000 to $1,000,000",
  OVER_1M: "over $1,000,000",
};

// ------------------------------------------------------------- the bid date

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

const isoDay = (y: number, m: number, d: number): string | null => {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
};

/** A bid date AS A PAGE STATED IT, as an ISO day, or null when it cannot be
 * read with certainty — a date with no year is null rather than guessed,
 * because a guessed year on a pursuit is a wrong alert later. Only ever
 * used to badge and sort; a null never hides a lead. */
export function readBidDay(text: string): string | null {
  const words = text.trim().toLowerCase();
  let m = words.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return isoDay(Number(m[1]), Number(m[2]), Number(m[3]));
  m = words.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/);
  if (m) return isoDay(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[1]), Number(m[2]));
  m = words.match(/\b([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
  if (m && MONTHS[m[1]]) return isoDay(Number(m[3]), MONTHS[m[1]], Number(m[2]));
  m = words.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?,?\s+(\d{4})\b/);
  if (m && MONTHS[m[2]]) return isoDay(Number(m[3]), MONTHS[m[2]], Number(m[1]));
  return null;
}

// ------------------------------------------------------------------ dedupe

const STOP_WORDS = new Set(["project", "projects", "phase", "building", "bldg", "the", "of", "and", "a", "an", "at", "for", "new", "no", "ph"]);

export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

/** The exact-match key: lowercase, punctuation stripped, generic words
 * dropped. "The Northgate Medical Project" and "Northgate Medical" are one
 * name; "Northgate Medical Phase II" is not, and is badged instead. */
export function normaliseName(name: string): string {
  return nameTokens(name).join(" ");
}

/** Token overlap (Jaccard), 0..1. For a BADGE only, never for hiding. */
export function nameOverlap(a: string, b: string): number {
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let both = 0;
  for (const token of ta) if (tb.has(token)) both += 1;
  return both / (ta.size + tb.size - both);
}

/** Every http(s) URL in a note, normalised. */
export function urlsIn(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
    const key = normaliseUrl(match[0]);
    if (key) out.push(key);
  }
  return out;
}

export type KnownRecord = { name: string; kind: "pipeline" | "job" | "bid"; href: string; urls?: string[] };

export type Placement =
  | { hidden: true; because: "url" | "name"; like: KnownRecord }
  | { hidden: false; like: KnownRecord | null };

const KIND_WORDS: Record<KnownRecord["kind"], string> = {
  pipeline: "already on your pipeline",
  job: "already one of your jobs",
  bid: "already a logged bid invitation",
};

/** Where one found lead stands against what the company already has.
 * Pure and exported: the hide/badge asymmetry above is the part worth a
 * test of its own. */
export function placeAgainstKnown(lead: { projectName: string; sourceUrl: string }, known: readonly KnownRecord[]): Placement {
  const url = normaliseUrl(lead.sourceUrl);
  if (url) {
    const byUrl = known.find((record) => record.urls?.includes(url));
    if (byUrl) return { hidden: true, because: "url", like: byUrl };
  }
  const key = normaliseName(lead.projectName);
  if (key) {
    const byName = known.find((record) => normaliseName(record.name) === key);
    if (byName) return { hidden: true, because: "name", like: byName };
  }
  let best: { record: KnownRecord; score: number } | null = null;
  for (const record of known) {
    const score = nameOverlap(lead.projectName, record.name);
    if (score >= FUZZY_BADGE_AT && (!best || score > best.score)) best = { record, score };
  }
  return { hidden: false, like: best?.record ?? null };
}

async function knownRecords(companyId: string): Promise<KnownRecord[]> {
  const [pursuits, jobs, invitations] = await Promise.all([
    prisma.bidPursuit.findMany({
      where: { companyId, stage: { not: "DROPPED" } },
      select: { projectName: true, note: true },
      take: 500,
    }),
    prisma.job.findMany({ where: { companyId }, select: { name: true }, take: 500 }),
    prisma.bidInvitation.findMany({ where: { companyId }, select: { projectName: true }, take: 500 }),
  ]);
  return [
    ...pursuits.map((row) => ({ name: row.projectName, kind: "pipeline" as const, href: "/pipeline", urls: urlsIn(row.note) })),
    ...jobs.map((row) => ({ name: row.name, kind: "job" as const, href: "/jobs" })),
    ...invitations.map((row) => ({ name: row.projectName, kind: "bid" as const, href: "/bids" })),
  ];
}

// --------------------------------------------------------- the card's rows

/** One lead as the server holds it between card and tap. Strings only,
 * re-parsed in `execute`. */
type StoredLead = {
  key: string;
  projectName: string;
  location: string | null;
  owner: string | null;
  bidDate: string | null;
  /** ISO day read off `bidDate`, or null. */
  bidDay: string | null;
  scopeSummary: string | null;
  sizeText: string | null;
  deliveryMethod: string | null;
  sourceUrl: string;
  sourceTitle: string;
};

type Judged = {
  lead: StoredLead;
  /** Decided by code from the page's own words; empty means "couldn't
   * tell". */
  trades: TradeScope[];
  datePassed: boolean;
  like: KnownRecord | null;
};

function judge(found: FoundLead, index: number, today: string, known: readonly KnownRecord[]): { judged: Judged } | { hidden: Placement & { hidden: true } } {
  const f = found.fields;
  const lead: StoredLead = {
    key: `lead-${index + 1}`,
    projectName: f.projectName,
    location: f.location ?? null,
    owner: f.owner ?? null,
    bidDate: f.bidDate ?? null,
    bidDay: f.bidDate ? readBidDay(f.bidDate) : null,
    scopeSummary: f.scopeSummary ?? null,
    sizeText: f.sizeText ?? null,
    deliveryMethod: f.deliveryMethod ?? null,
    sourceUrl: found.source.url,
    sourceTitle: found.source.title,
  };
  const placement = placeAgainstKnown({ projectName: lead.projectName, sourceUrl: lead.sourceUrl }, known);
  if (placement.hidden) return { hidden: placement };
  const read = readTrade(`${lead.scopeSummary ?? ""} ${lead.projectName}`);
  const trades = read.kind === "one" ? (read.scope ? [read.scope] : []) : read.kind === "several" ? read.scopes : [];
  return {
    judged: {
      lead,
      trades,
      datePassed: lead.bidDay !== null && lead.bidDay < today,
      like: placement.like,
    },
  };
}

/** In-trade and open first; then in-trade with a date that may have
 * passed; then the "couldn't tell" group, open before passed. Within a
 * group, the model's order (it was asked for most relevant first). */
function rank(j: Judged): number {
  return (j.trades.length === 0 ? 2 : 0) + (j.datePassed ? 1 : 0);
}

function suggestionFor(j: Judged): WebSuggestion {
  const { lead } = j;
  const parts: string[] = [];
  parts.push(j.trades.length > 0 ? j.trades.map((t) => TRADE_LABELS[t]).join(", ") : "trade: couldn't tell from the page");
  if (lead.location) parts.push(lead.location);
  if (lead.owner) parts.push(`owner ${lead.owner}`);
  if (lead.bidDate) parts.push(j.datePassed ? `bid date shown as ${lead.bidDate} — check, it may have passed` : `bids ${lead.bidDate}`);
  if (lead.sizeText) parts.push(lead.sizeText);
  if (lead.deliveryMethod) parts.push(lead.deliveryMethod);
  if (lead.scopeSummary) parts.push(lead.scopeSummary);
  if (j.like) parts.push(`looks like "${j.like.name}", ${KIND_WORDS[j.like.kind]} — check before adding`);
  return {
    key: lead.key,
    label: lead.projectName,
    value: parts.join(" · "),
    sources: [{ title: lead.sourceTitle, url: lead.sourceUrl }],
  };
}

// --------------------------------------------------------------- resolve

async function resolveFindBidLeads(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  // The trades: the person's words or nothing. Asked, never derived —
  // CompanyTradeScope is empty in every account and inferring from job
  // history would send a fact about their books.
  if (!input.trades) {
    return { kind: "need", missing: "which trades to look for — drywall, plaster, EIFS, ceilings, fireproofing, or several" };
  }
  const trades = readTrades(input.trades);
  if ("unknown" in trades) {
    return {
      kind: "need",
      missing: `which of the five trades "${trades.unknown}" means — drywall, plaster, EIFS, ceilings or fireproofing`,
    };
  }
  if (trades.trades.length === 0) {
    return { kind: "need", missing: "at least one trade to look for — drywall, plaster, EIFS, ceilings or fireproofing" };
  }

  const company = await prisma.company.findUnique({
    where: { id: ctx.companyId },
    select: { hqCity: true, hqState: true, doesPublicWork: true },
  });

  // The region: the person's, or the company's HQ city. Never an address.
  let region: { city: string; state: string } | null = null;
  let regionFrom: "person" | "hq" = "person";
  if (input.region) {
    region = parseRegion(input.region);
    if (!region) {
      return { kind: "need", missing: `the area as a city and a two-letter state, like "Long Beach, CA" — "${input.region}" isn't one this app can read` };
    }
  } else if (company?.hqCity && company.hqState) {
    const state = readState(company.hqState);
    const city = company.hqCity.trim().replace(/ {2,}/g, " ");
    if (state && CITY_PATTERN.test(city)) {
      region = { city, state };
      regionFrom = "hq";
    }
  }
  if (!region) {
    return {
      kind: "need",
      missing: "which city and state to look in, like \"Long Beach, CA\" — the company profile has no head-office city to use",
    };
  }

  // Public works: the person's word, else the company's own onboarding
  // answer, else a question. Null on the row is "not answered", which is
  // not a filter — it is a question here rather than a silent "either".
  let publicWorkOnly: boolean | undefined;
  if (input.publicWork) {
    const read = readPublicWork(input.publicWork);
    if (read === null) return { kind: "need", missing: `whether to look at public works only, or private work too — "${input.publicWork}" isn't clear` };
    publicWorkOnly = read;
  } else if (company?.doesPublicWork === true) {
    publicWorkOnly = true;
  } else if (company?.doesPublicWork === false) {
    publicWorkOnly = false;
  } else {
    return { kind: "need", missing: "whether to look at public works only, or private work too" };
  }

  let sizeBand: LeadSizeBand | undefined;
  if (input.sizeBand) {
    const read = readSizeBand(input.sizeBand);
    if (!read) return { kind: "need", missing: `the project size as a band — under $250k, $250k to $1M, or over $1M — "${input.sizeBand}" isn't one` };
    sizeBand = read;
  }

  const tradeLabels = trades.trades.map((t) => TRADE_LABELS[t]).join(", ");
  const where = `${region.city}, ${region.state}`;

  if (!ctx.leads) {
    return { kind: "refuse", reason: "The web lookup isn't available on this request, so nothing was searched. Ask again from the assistant box." };
  }

  let result: Awaited<ReturnType<NonNullable<CommandContext["leads"]>>>;
  try {
    result = await ctx.leads({
      trades: trades.trades,
      region: { ...region, radiusMiles: RADIUS_MILES },
      sizeBand,
      publicWorkOnly,
      bidsAfter: ctx.today,
    });
  } catch (err) {
    console.error("[ask] lead search threw", err);
    return { kind: "refuse", reason: "The web lookup failed part-way, so nothing was searched to the end. Try again in a minute." };
  }
  if (!result.ok) {
    return {
      kind: "refuse",
      reason:
        result.reason === "unavailable"
          ? "The web lookup is unavailable right now — that is different from nothing turning up. Try again later."
          : result.reason === "invalid"
            ? `The area "${where}" or the trades couldn't be turned into a search this app is willing to send. Say the city and a two-letter state.`
            : "The web lookup failed. Nothing was found and nothing was saved; try again in a minute.",
    };
  }
  if (result.leads.length === 0) {
    return {
      kind: "refuse",
      reason: `Nothing out to bid turned up for ${tradeLabels} around ${where} — no page in the search named a project. That's a real empty, not a filter: try a wider area or another trade, or ask again next week.`,
    };
  }

  // Dedupe and judge, in code.
  const known = await knownRecords(ctx.companyId);
  const judged: Judged[] = [];
  const hidden: (Placement & { hidden: true })[] = [];
  result.leads.forEach((found, index) => {
    const outcome = judge(found, index, ctx.today, known);
    if ("hidden" in outcome) hidden.push(outcome.hidden);
    else judged.push(outcome.judged);
  });
  if (judged.length === 0) {
    return {
      kind: "refuse",
      reason: `The web turned up ${hidden.length === 1 ? "one project" : `${hidden.length} projects`} for ${tradeLabels} around ${where}, and every one is already on your pipeline, jobs or bids. Nothing new.`,
      href: "/pipeline",
    };
  }
  judged.sort((a, b) => rank(a) - rank(b));

  const suggestions = judged.map(suggestionFor);
  const unknownTrade = judged.filter((j) => j.trades.length === 0).length;
  const passed = judged.filter((j) => j.datePassed).length;
  const fuzzy = judged.filter((j) => j.like).length;

  const preview: PreviewLine[] = [
    { label: "Trades", value: tradeLabels },
    { label: "Area", value: `${where}, within ${RADIUS_MILES} miles${regionFrom === "hq" ? " (your head office)" : ""}` },
    { label: "Public works", value: publicWorkOnly === true ? "public works only" : publicWorkOnly === false ? "private work — public too" : "either" },
    { label: "Project size", value: sizeBand ? SIZE_BAND_LABELS[sizeBand] : "any" },
    { label: "Bidding on or after", value: dayLabel(ctx.today) },
    {
      label: "Found",
      value:
        `${judged.length} ${judged.length === 1 ? "project" : "projects"} out to bid` +
        (hidden.length > 0 ? `, ${hidden.length} more hidden as already on your pipeline, jobs or bids` : ""),
    },
  ];
  if (unknownTrade > 0) {
    preview.push({ label: "Couldn't tell the trade", value: `${unknownTrade} — shown last, not counted as in-trade` });
  }

  const warnings: string[] = [
    "Each lead is a page on the web, not a fact. Open the source before you call anyone. Untick any you don't want; the rest are added to the pursuit list as Watching when you tap.",
  ];
  if (passed > 0) warnings.push(`${passed} ${passed === 1 ? "shows" : "show"} a bid date that may already have passed — sorted last, check before adding.`);
  if (fuzzy > 0) warnings.push(`${fuzzy} ${fuzzy === 1 ? "looks" : "look"} like something already on your list; it's shown rather than hidden so you can decide.`);

  const resolved: ResolvedPayload = {
    trades: trades.trades,
    region,
    publicWorkOnly: publicWorkOnly ?? null,
    sizeBand: sizeBand ?? null,
    bidsAfter: ctx.today,
    webSuggestions: suggestions,
    leads: judged.map((j) => j.lead),
  };

  return { kind: "ready", resolved, preview, warnings, suggestions };
}

// --------------------------------------------------------------- execute

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The stored leads, re-parsed rather than cast: JSON read back out of a
 * row. A lead whose source is not an http(s) link is not one this code
 * wrote and is skipped. */
function storedLeads(payload: ResolvedPayload): StoredLead[] {
  if (!Array.isArray(payload.leads)) return [];
  const out: StoredLead[] = [];
  for (const entry of payload.leads) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const text = (key: string): string | null => (typeof e[key] === "string" && (e[key] as string).trim() ? (e[key] as string) : null);
    const key = text("key");
    const projectName = text("projectName");
    const sourceUrl = e.sourceUrl;
    if (!key || !projectName || !isWebLink(sourceUrl)) continue;
    const bidDay = text("bidDay");
    out.push({
      key,
      projectName,
      location: text("location"),
      owner: text("owner"),
      bidDate: text("bidDate"),
      bidDay: bidDay && ISO_DAY.test(bidDay) ? bidDay : null,
      scopeSummary: text("scopeSummary"),
      sizeText: text("sizeText"),
      deliveryMethod: text("deliveryMethod"),
      sourceUrl,
      sourceTitle: text("sourceTitle") ?? sourceUrl,
    });
  }
  return out;
}

/** The pursuit's note: where it was found first (which is also the URL
 * the next pass dedupes on), then what the page said. */
export function pursuitNoteFor(lead: Pick<StoredLead, "sourceUrl" | "scopeSummary" | "sizeText" | "deliveryMethod" | "location">): string {
  const lines = [`Found on the web: ${lead.sourceUrl}`];
  const said = [lead.location, lead.scopeSummary, lead.sizeText, lead.deliveryMethod].filter((s): s is string => Boolean(s));
  if (said.length > 0) lines.push(said.join(" · "));
  const note = lines.join("\n");
  return note.length <= MAX_NOTE_CHARS ? note : `${note.slice(0, MAX_NOTE_CHARS - 1)}…`;
}

async function executeFindBidLeads(ctx: CommandContext, payload: ResolvedPayload): Promise<Executed> {
  // `confirmAskProposal` has already removed the unticked keys. Only what
  // is still ticked, and only now that the person tapped.
  const kept = new Set(keepSuggestions(payload.webSuggestions).map((s) => s.key));
  const leads = storedLeads(payload).filter((lead) => kept.has(lead.key));
  if (leads.length === 0) {
    return { ok: false, error: "Every lead was unticked, so there is nothing to add. Ask again if you want a fresh search." };
  }

  const added: string[] = [];
  const failed: string[] = [];
  for (const lead of leads) {
    const result = await throughAction("Add pursuit", () =>
      createBidPursuit(
        formDataFrom({
          projectName: lead.projectName,
          stage: "WATCHING",
          owner: lead.owner,
          // Entered from the page, never stamped — and only when the
          // page's date read as a full calendar day.
          expectedBidDate: lead.bidDay,
          note: pursuitNoteFor(lead),
        }),
      ),
    );
    if (result.ok) added.push(lead.projectName);
    else failed.push(`${lead.projectName} (${result.error})`);
  }

  if (added.length === 0) {
    return { ok: false, error: `Nothing was added. ${failed.join("; ")}` };
  }
  const first = await prisma.bidPursuit.findFirst({
    where: { companyId: ctx.companyId, projectName: added[0] },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const message =
    `Added ${added.length === 1 ? added[0] : `${added.length} projects`} to the pursuit list as Watching` +
    (added.length > 1 ? `: ${added.join(", ")}` : "") +
    `. Each one's source page is in its note.` +
    (failed.length > 0 ? ` Not added: ${failed.join("; ")}.` : "");
  return {
    ok: true,
    message,
    created: {
      label: added.length === 1 ? added[0] : `${added.length} pursuits`,
      href: "/pipeline",
      targetType: "BidPursuit",
      targetId: first?.id ?? added[0],
    },
  };
}

export const findBidLeadsCommand: DirectCommandDefinition = {
  name: "find_bid_leads",
  description:
    "Searches the PUBLIC web for construction projects currently OUT TO BID — advertised, not yet awarded — in the trades and area the person names, that the company may not have heard of: 'what should we be bidding', 'find work out to bid near us', 'any drywall jobs bidding in Long Beach'. Pass the trades in the person's own words ('drywall and ceilings'), the city and state if they said one (otherwise the company's head office is used), and 'public only' or 'private too' if they said. Ask for the trades if missing. Each lead shows the web page it came from; the person unticks any they don't want and the tap adds the rest to the pursuit list (the Pipeline page) as Watching. Does NOT look up a project the person already named (that is start a bid / create_estimate_job with a location), does not log a bid invitation, does not create a job or contact, never invents a project, and sends nothing.",
  capability: "MANAGE_ESTIMATING",
  tier: "T1_DRAFT",
  mode: "DIRECT",
  action: "createBidPursuit",
  core: "createBidPursuit",
  title: "Work out to bid, found on the web",
  verb: "Searching the web for work out to bid",
  button: "Add to pursuit list",
  input_schema: {
    type: "object",
    properties: {
      trades: {
        type: "string",
        description:
          "The trades to look for, in the person's own words, several separated by commas or 'and' — 'drywall', 'framing', 'plaster', 'stucco', 'EIFS', 'ceilings', 'fireproofing'. Required: ask if they did not say.",
      },
      region: {
        type: "string",
        description:
          "The city and state to look in, as the person said it, e.g. 'Long Beach, CA' or 'Reno Nevada'. Omit if not said — the company's head office is used.",
      },
      publicWork: {
        type: "string",
        description:
          "Only if the person said: 'public only', 'private too', 'either'. Omit otherwise — the company's own setting is used, or they are asked.",
      },
      sizeBand: {
        type: "string",
        description:
          "Only if the person said a project size, in their words: 'under 250k', '250k to 1M', 'over 1M'. Omit otherwise; never estimate one.",
      },
    },
  },
  resolve: resolveFindBidLeads,
  execute: executeFindBidLeads,
};

export const leadCommands: DirectCommandDefinition[] = [findBidLeadsCommand];
