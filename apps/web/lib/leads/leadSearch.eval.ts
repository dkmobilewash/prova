import { afterAll, describe, expect, it } from "vitest";
import {
  findLeads,
  LEAD_MAX_SEARCHES,
  LEAD_PROMPT_VERSION,
  modelFor,
  type LeadTrade,
} from "@prova/integrations";

/**
 * WILL IT INVENT PROJECTS WHERE THERE ARE NONE?
 *
 * `LEAD_SEARCH` shipped gated, metered and model-routed with no eval and no
 * control. An audit on 2026-10-01 put it at 2 of 4. `LeadSearch` is the control;
 * this is the measurement.
 *
 * ── WHAT IS ALREADY PROVED FOR FREE ──
 *
 * `leads.ts`'s own `verifiedLeads` is pure, exported and unit-tested: a lead
 * whose source never appeared in a `web_search_tool_result` of that call is
 * dropped WHOLE, a lead with no project name is dropped, an unknown field is
 * dropped, duplicates are collapsed and the list is capped at `MAX_LEADS`. The
 * outgoing turn is a template instance over an enum, a city pattern and a state
 * code, and `leadQueryTurn` is tested on its own. None of that needs a model.
 *
 * So this file measures the one thing a stub cannot: what the MODEL does when
 * the web has nothing to offer.
 *
 * ── WHY THAT IS THE FAILURE WORTH PAYING TO MEASURE ──
 *
 * `leads.ts` says it best, about `verifiedLeads`: "a sub who calls an owner
 * about a job that does not exist has spent credibility he cannot get back."
 * A lead is not a number on a screen — it is a phone call a person makes to a
 * stranger. And the citation rule cannot save them from the dangerous version:
 * a real page about a real project that is NOT out to bid, or is in another
 * state, or finished two years ago, cited perfectly.
 *
 * ── THE COUNTER-METRIC IS HERE FROM THE FIRST RUN, ON PURPOSE ──
 *
 * A searcher that returned NOTHING, always, would score perfectly against the
 * paragraph above. The draft-lines eval shipped with exactly that hole and its
 * first run was green while 11 of 19 lines came back with no price. So one case
 * is a large metro with heavy public bidding, and a run where even THAT comes
 * back empty prints a WARNING and makes the invention pass unproven rather than
 * clean.
 *
 * ── THIS QUERIES THE LIVE WEB, like the bid-research eval and unlike the rest ──
 *
 * Runs are not repeatable: bid boards change daily, which is the whole point of
 * the feature. So the only FATAL assertion is the invention one — a city that
 * does not exist will not start existing — and nothing asserts a specific
 * project, which would be a test of this week's solicitations.
 *
 * ── HOW TO RUN IT, AND WHAT IT COSTS ──
 *
 *     ANTHROPIC_API_KEY=sk-ant-… pnpm eval:lead-search
 *
 * Or put the key in `apps/web/.env` once and run it bare. ONE call per case plus
 * up to `LEAD_MAX_SEARCHES` web searches, and **web search is billed per search
 * on top of tokens**, which is why the list is two cases and stays short.
 *
 * ── CONFIDENTIALITY ──
 *
 * No customer's trades, city or pipeline appear here. The regions are a major
 * metro and an invented place name; the trades are the product's own enum. What
 * a given contractor is chasing, and where, is a fact about them.
 */

const TRADES: readonly LeadTrade[] = ["METAL_FRAMING_DRYWALL", "ACOUSTICAL_CEILINGS"];

type LeadCase = {
  id: string;
  why: string;
  city: string;
  state: string;
  /** FATAL: nothing can be out to bid in a place that does not exist. */
  mustFindNothing?: boolean;
  /** Counted and reported: a metro with heavy public bidding. Empty here makes
   *  the case above vacuous. */
  expectFindings?: boolean;
};

const LEAD_CASES: LeadCase[] = [
  {
    id: "city-that-does-not-exist",
    why:
      "THE CASE THIS EVAL EXISTS FOR — a place name that is not a place. Nothing can be out to bid " +
      "there, so any lead at all was lifted from a page about somewhere else and arrived with a " +
      "working link, which is why no citation rule can catch it",
    // Passes CITY_PATTERN (letters only) so the query is really sent, and is
    // not a real US place. The point is to reach the MODEL, not the validator.
    city: "Brintlesford",
    state: "NV",
    mustFindNothing: true,
  },
  {
    id: "large-metro",
    why:
      "the counter-metric: a metro with heavy public bidding. If this is empty too then finding " +
      "nothing is simply what this feature does, and the case above proves nothing",
    city: "Las Vegas",
    state: "NV",
    expectFindings: true,
  },
];

type Verdict = {
  id: string;
  ok: boolean;
  reason: string | null;
  searches: number;
  leads: { name: string; url: string; fields: string }[];
};

const verdicts: Verdict[] = [];

function requireApiKey(): void {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY is not set: the lead-search eval did not run. It is not a pass.");
  }
  // Not the placeholder either — length, not prefix, and the key is never
  // printed. Pasting the header's `sk-ant-…` unedited satisfies "is it set" and
  // then fails as an auth error a minute later, reading like a broken eval.
  if (key.length < 20) {
    throw new Error(
      `ANTHROPIC_API_KEY is set to ${key.length} character(s), too short to be a key: the lead-search ` +
        `eval did not run. If you pasted the command with its "…" placeholder still in it, that is this.`,
    );
  }
}

/** Today, so a run never asks for bids that have already closed. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

describe("searching for public projects out to bid", () => {
  requireApiKey();

  const model = modelFor("LEAD_SEARCH").model;

  for (const one of LEAD_CASES) {
    it(`${one.id} — ${one.why}`, async () => {
      const result = await findLeads({
        trades: TRADES,
        region: { city: one.city, state: one.state },
        bidsAfter: todayIso(),
        maxSearches: LEAD_MAX_SEARCHES,
        model,
      });

      verdicts.push({
        id: one.id,
        ok: result.ok,
        reason: result.ok ? null : result.reason,
        searches: result.searches,
        leads: result.ok
          ? result.leads.map((lead) => ({
              name: lead.fields.projectName,
              url: lead.source.url,
              fields: Object.entries(lead.fields)
                .filter(([key]) => key !== "projectName")
                .map(([key, value]) => `${key}=${value}`)
                .join(" | "),
            }))
          : [],
      });

      // `invalid` means the TEMPLATE refused the input and nothing was sent, so
      // the case measured the validator rather than the model. That is a harness
      // failure, not a result — and it is the mistake most available here, since
      // an invented city is one typo away from failing CITY_PATTERN.
      if (!result.ok && result.reason === "invalid") {
        expect(
          "the query was refused before it was sent",
          `${one.id}: "${one.city}, ${one.state}" did not fit the outgoing template, so nothing was ` +
            `searched and this case measured nothing about the model`,
        ).toBe("a query was sent");
        return;
      }
      if (!result.ok) {
        expect(result.reason, `${one.id}: the API refused, so this case measured nothing`).toBe("not-a-real-reason");
        return;
      }
      // A run with no search is "found nothing" about the harness, not the model.
      expect(
        result.searches,
        `${one.id}: no web search ran, so an empty result says nothing about the model`,
      ).toBeGreaterThan(0);

      if (one.mustFindNothing) {
        const invented = result.leads.map((lead) => `${lead.fields.projectName} <- ${lead.source.url}`);
        // THE ONE FATAL ASSERTION, and the only one that survives the web
        // moving: a lead here is a phone call to a stranger about a job that
        // does not exist, and `leads.ts` says what that costs — "credibility he
        // cannot get back".
        expect(
          invented,
          `${one.id}: "${one.city}, ${one.state}" is not a real place, so nothing can be out to bid ` +
            `there. Anything returned came off a page about somewhere else, with a working link.`,
        ).toEqual([]);
      }
    });
  }

  afterAll(() => {
    const requested = LEAD_CASES.length;
    const expecting = LEAD_CASES.filter((one) => one.expectFindings).map((one) => one.id);
    const silentButExpected = verdicts.filter((v) => expecting.includes(v.id) && v.leads.length === 0);

    console.log(
      `\nlead-search eval (${LEAD_PROMPT_VERSION}, ${model}): requested ${requested}, returned ${verdicts.length}`,
    );
    if (verdicts.length !== requested) {
      console.log("  INCOMPLETE — the numbers below are over the cases that ran, not over the suite.");
    }
    console.log(
      `  leads: ${verdicts.reduce((sum, v) => sum + v.leads.length, 0)} over ${verdicts.length} cases, ` +
        `${verdicts.reduce((sum, v) => sum + v.searches, 0)} web searches`,
    );
    if (silentButExpected.length > 0) {
      console.log(
        `  WARNING: ${silentButExpected.map((v) => v.id).join(", ")} found nothing and was expected to. ` +
          `A searcher that never finds anything passes the invention case trivially, so read that pass ` +
          `as unproven rather than clean.`,
      );
    }

    for (const verdict of verdicts) {
      const head = verdict.ok ? `${verdict.leads.length} lead(s)` : `REFUSED (${verdict.reason})`;
      console.log(`  ${verdict.id.padEnd(26)} ${head}, ${verdict.searches} search(es)`);
      // EVERY LEAD AND ITS SOURCE, pass or fail. Nothing here judges whether a
      // project is really out to bid — the web moves and a hardcoded answer
      // would rot — so a person reading this output is the instrument for that,
      // and they need the links to be it.
      for (const lead of verdict.leads) {
        console.log(`      ${lead.name}`);
        if (lead.fields) console.log(`         ${lead.fields}`);
        console.log(`         ${lead.url}`);
      }
    }
  });
});
