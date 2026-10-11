import { bareDomain, findDomain } from "./domain";
import { patternCandidates } from "./patterns";
import { UnsafeUrlError, type Lookup } from "./safeFetch";
import { emailsOnSite } from "./site";
import { verifyEmail, type Verdict } from "./verify";

/**
 * ONE LEAD IN, ONE EMAIL (OR ONE SENTENCE SAYING WHY NOT) OUT.
 *
 * Order: the lead's own website, else a search for it; the addresses that site
 * prints; failing those, guesses from the owner's name; then the verifier, at
 * most six calls, stopping at the first address it accepts. Every outcome
 * carries a sentence, because the result is shown to a person who has to decide
 * whether to send to it — "guessed and unverified" must never read like
 * "printed on their contact page".
 *
 * Network is injected so this runs in a test with none.
 */

export const MAX_VERIFICATIONS = 6;

export type FindDeps = {
  fetch?: typeof fetch;
  lookup?: Lookup;
  searchKey?: string;
  verifyKey?: string;
  /** `performance.now()` value after which no new network step starts. */
  deadline?: number;
};

export type FindOutcome =
  | {
      found: true;
      email: string;
      source: "site" | "pattern";
      /** null = nothing verified it (no key); never stored as verified. */
      verdict: Exclude<Verdict, "unusable"> | null;
      domain: string;
      domainWasFound: boolean;
      tried: string[];
      note: string;
    }
  | { found: false; domain: string | null; domainWasFound: boolean; tried: string[]; note: string };

function pageWords(page: string): string {
  if (page === "/") return "their home page";
  return `their ${page.slice(1).replace(/-/g, " ")} page`;
}

export async function findEmailForLead(
  lead: { companyName: string; city: string | null; contactName: string | null; website: string | null },
  deps: FindDeps = {},
): Promise<FindOutcome> {
  const tried: string[] = [];
  const outOfTime = () => deps.deadline !== undefined && performance.now() > deps.deadline;

  let domain = lead.website ? bareDomain(lead.website) : null;
  const domainWasFound = domain === null;
  if (!domain) {
    const found = await findDomain({ name: lead.companyName, city: lead.city }, deps.searchKey, deps.fetch);
    if (!found.ok) return { found: false, domain: null, domainWasFound: false, tried, note: cap(found.why) + "." };
    domain = found.domain;
  }
  const none = (note: string): FindOutcome => ({ found: false, domain, domainWasFound, tried, note });

  let candidates: { email: string; source: "site" | "pattern"; page?: string }[];
  try {
    const onSite = outOfTime() ? [] : await emailsOnSite(domain, { fetch: deps.fetch, lookup: deps.lookup });
    candidates = onSite.map((s) => ({ email: s.email, source: "site" as const, page: s.page }));
  } catch (err) {
    if (err instanceof UnsafeUrlError) return none(`${err.message} Nothing was fetched.`);
    throw err;
  }
  if (candidates.length === 0) {
    candidates = patternCandidates(lead.contactName, domain).map((email) => ({ email, source: "pattern" as const }));
  }
  if (candidates.length === 0) return none(`${domain} has no address on its site and there is no owner name to guess from.`);

  const say = (c: (typeof candidates)[number], verdict: string) =>
    c.source === "site"
      ? `Found ${c.email} on ${pageWords(c.page ?? "/")}, ${verdict}.`
      : `Guessed ${c.email} from the owner's name — ${verdict}.`;

  if (!deps.verifyKey) {
    const c = candidates[0];
    return {
      found: true, email: c.email, source: c.source, verdict: null, domain, domainWasFound, tried: [c.email],
      note: say(c, c.source === "site" ? "unverified (no verifier key set)" : "unverified, no verifier key set"),
    };
  }

  let timedOut = false;
  for (const c of candidates.slice(0, MAX_VERIFICATIONS)) {
    if (outOfTime()) {
      timedOut = true;
      break;
    }
    tried.push(c.email);
    const { verdict } = await verifyEmail(c.email, deps.verifyKey, deps.fetch);
    if (verdict === "unusable") continue;
    // A catch-all domain answers catch_all for every address, so trying the
    // next five would spend five credits to learn nothing.
    const words = verdict === "deliverable" ? "verified deliverable" : "the domain accepts every address (catch-all), so it is accepted but not proven";
    return { found: true, email: c.email, source: c.source, verdict, domain, domainWasFound, tried, note: say(c, words) };
  }
  if (timedOut) return none("Ran out of time before verifying every candidate — try again.");
  return none(`Every candidate bounced or could not be confirmed (${tried.join(", ")}).`);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
