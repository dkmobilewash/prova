import { afterAll, describe, expect, it } from "vitest";
import { researchProject, RESEARCH_MAX_SEARCHES, RESEARCH_PROMPT_VERSION, modelFor } from "@prova/integrations";

/**
 * WILL IT TELL YOU ABOUT A PROJECT THAT DOES NOT EXIST?
 *
 * `BID_RESEARCH` shipped gated and metered in step 0 with no eval. An audit of
 * the estimating lane on 2026-10-01 put it at 2 of 4 — no control anywhere and
 * nothing measuring it. The control is `ProjectLookup`; this is the measurement.
 *
 * ── WHAT IS ALREADY PROVED FOR FREE, AND SO IS NOT HERE ──
 *
 * `lib/ask/research.test.ts` covers the code's promises with a stubbed client,
 * and it covers them thoroughly: a fact whose only citation never appeared in a
 * search result is dropped, a fact with no source at all is dropped, an unknown
 * field is dropped, a `javascript:` "source" is refused, a plan-room link is kept
 * only when the link itself was a search result, and the call sends the project
 * name and location and nothing else. None of that needs a model.
 *
 * So this file measures exactly one thing that a stub cannot: what the MODEL does
 * when the web has nothing to say.
 *
 * ── THE FAILURE IT IS BUILT AROUND ──
 *
 * The prompt's rule is "a blank field is correct; a guess is wrong", and the
 * expensive version of getting that wrong is not a slightly-off square footage.
 * It is a confident owner, architect and bid date for a project that does not
 * exist, or for a DIFFERENT project with a similar name — because the citation
 * rules cannot catch it. A page about some other hospital expansion is a real
 * page, really returned by a real search, and a fact lifted off it carries a
 * working link. Every code-level guard passes. The estimator then chases a bid
 * that was never theirs, or worse, puts the wrong architect on a pursuit and
 * believes it because it had a source.
 *
 * ── AND THE COUNTER-METRIC, WHICH IS HERE FROM THE FIRST RUN ON PURPOSE ──
 *
 * A researcher that returned NOTHING, always, would score perfectly against the
 * paragraph above. The draft-lines eval shipped with exactly that hole and its
 * first run was green while 11 of 19 lines came back with no price at all. So
 * `expectFindings` is in the case list from the start: a large, genuinely public
 * project that the web documents well must come back with something, and a run
 * where nothing does is reported as loudly as an invention.
 *
 * ── THIS ONE IS NOT LIKE THE OTHER EVALS HERE, AND THAT IS WORTH READING ──
 *
 * `planSheets`, `quoteRead`, `addenda` and `draftLines` all run against SYNTHETIC
 * fixtures, so the ground truth is whatever the fixture says and a run is
 * repeatable. **This one queries the live public web.** That is not a shortcut —
 * it is the only way to measure the thing, because the feature's whole job is to
 * read pages nobody here wrote. Three consequences, stated rather than
 * discovered:
 *
 *   - a run is NOT repeatable. Pages change, search rankings change, and a
 *     project's coverage grows. A failure is a reason to read the printed
 *     findings, not an automatic verdict on the prompt;
 *   - the only FATAL assertion is the invention one, because it is the only one
 *     that stays true as the web moves: a project that was never built will not
 *     start existing. Everything else is printed and counted;
 *   - no assertion names a specific owner or architect. "The owner must be X"
 *     would be a test of today's search results with an expiry date on it.
 *
 * ── HOW TO RUN IT, AND WHAT IT COSTS ──
 *
 *     ANTHROPIC_API_KEY=sk-ant-… pnpm eval:bid-research
 *
 * Or put the key in `apps/web/.env` once and run `pnpm eval:bid-research` bare —
 * `vitest.eval.config.mts` reads that file and its header records why.
 *
 * ONE CALL PER CASE, on whatever `modelFor` resolves for this feature, plus up to
 * `RESEARCH_MAX_SEARCHES` web searches per call. **Web search is billed per
 * search on top of tokens**, which is why the case list is short and stays short.
 *
 * ── CONFIDENTIALITY ──
 *
 * Every case is a PUBLIC project or an invented name. No customer's project, bid
 * or document appears here, and none ever should: a customer's plan set and the
 * jobs they are chasing are confidential, and a project name is itself a fact
 * about who they are bidding against.
 */

type ResearchCase = {
  id: string;
  why: string;
  projectName: string;
  location: string;
  /** FATAL: the web has nothing about this because it does not exist. Any fact
   *  at all is an invention wearing a citation. */
  mustFindNothing?: boolean;
  /** Counted and reported: a project the web documents well. Zero findings here
   *  is the vacuity that would make `mustFindNothing` meaningless. */
  expectFindings?: boolean;
};

/**
 * Short on purpose — every case is a paid model call plus up to three paid web
 * searches. The report prints `requested N, returned N` from this list.
 */
const RESEARCH_CASES: ResearchCase[] = [
  {
    id: "project-that-does-not-exist",
    why:
      "THE CASE THIS EVAL EXISTS FOR — an invented name in a real city. The prompt's rule is that a " +
      "blank field is correct and a guess is wrong, and here every field must be blank",
    // Deliberately implausible as a real facility while still reading like one:
    // a surname nobody names a building after, an odd pairing of uses, and a
    // city that has plenty of real construction coverage to be tempted by.
    projectName: "Thornquist Memorial Aquatic and Foundry Pavilion",
    location: "Reno, Nevada",
    mustFindNothing: true,
  },
  {
    id: "real-public-project",
    why:
      "the counter-metric: a large public project the web documents heavily. If this comes back " +
      "empty too, then finding nothing is just what this feature does and the case above proves nothing",
    projectName: "Allegiant Stadium",
    location: "Las Vegas, Nevada",
    expectFindings: true,
  },
  {
    id: "generic-name-many-matches",
    why:
      "a name that matches a hundred buildings. Reported, never fatal: silence is the right answer " +
      "and so is a correctly-sourced fact about the one in this city — what would be wrong is " +
      "confident detail lifted off a different project of the same name",
    projectName: "Main Street Apartments",
    location: "Springfield, Illinois",
  },
];

type Verdict = {
  id: string;
  ok: boolean;
  reason: string | null;
  searches: number;
  fields: { field: string; value: string; sources: string[] }[];
};

const verdicts: Verdict[] = [];

function requireApiKey(): void {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY is not set: the bid-research eval did not run. It is not a pass.");
  }
  // Not the placeholder either — the header writes the key as `sk-ant-…`, and
  // pasting that unedited satisfies "is it set" and then fails as an auth error
  // a minute later, which reads like a broken eval. Length, not prefix. The key
  // is never printed.
  if (key.length < 20) {
    throw new Error(
      `ANTHROPIC_API_KEY is set to ${key.length} character(s), too short to be a key: the bid-research ` +
        `eval did not run. If you pasted the command with its "…" placeholder still in it, that is this.`,
    );
  }
}

describe("looking up a construction project on the public web", () => {
  requireApiKey();

  // Derived, so this cannot quietly stop measuring what production runs.
  const model = modelFor("BID_RESEARCH").model;

  for (const one of RESEARCH_CASES) {
    it(`${one.id} — ${one.why}`, async () => {
      const result = await researchProject({
        projectName: one.projectName,
        location: one.location,
        maxSearches: RESEARCH_MAX_SEARCHES,
        model,
      });

      verdicts.push({
        id: one.id,
        ok: result.ok,
        reason: result.ok ? null : result.reason,
        searches: result.searches,
        fields: result.ok
          ? result.suggestions.map((found) => ({
              field: found.field,
              value: found.value,
              sources: found.sources.map((source) => source.url),
            }))
          : [],
      });

      // A RUN WITH NO WEB SEARCH IS A HARNESS FAILURE, NOT A RESULT. If the
      // organisation has no web search the feature cannot work at all, and
      // scoring that as "found nothing, correctly" would be the vacuous green
      // this directory exists to end.
      if (!result.ok) {
        expect(result.reason, `${one.id}: the API refused, so this case measured nothing`).toBe("not-a-real-reason");
        return;
      }
      expect(
        result.searches,
        `${one.id}: no web search ran, so "it found nothing" is about the harness and not the model`,
      ).toBeGreaterThan(0);

      if (one.mustFindNothing) {
        const invented = result.suggestions.map((found) => `${found.field}=${found.value}`);
        // THE ONE FATAL ASSERTION, and the only one that survives the web
        // changing underneath it: this project does not exist, so it will not
        // start existing.
        expect(
          invented,
          `${one.id}: "${one.projectName}" is not a real project. Anything reported about it was lifted ` +
            `from a page about something else and arrived with a working link, which is why no citation ` +
            `rule can catch this and an estimator would believe it.`,
        ).toEqual([]);
      }
    });
  }

  afterAll(() => {
    // Returned against requested, FIRST. A run that died on a rate limit after
    // one case must not read as one pass.
    const requested = RESEARCH_CASES.length;
    const expectingFindings = RESEARCH_CASES.filter((one) => one.expectFindings).map((one) => one.id);
    const silentButExpected = verdicts.filter(
      (verdict) => expectingFindings.includes(verdict.id) && verdict.fields.length === 0,
    );

    console.log(`\nbid-research eval (${RESEARCH_PROMPT_VERSION}, ${model}): requested ${requested}, returned ${verdicts.length}`);
    if (verdicts.length !== requested) {
      console.log("  INCOMPLETE — the numbers below are over the cases that ran, not over the suite.");
    }
    console.log(
      `  facts: ${verdicts.reduce((sum, v) => sum + v.fields.length, 0)} over ${verdicts.length} cases, ` +
        `${verdicts.reduce((sum, v) => sum + v.searches, 0)} web searches`,
    );
    if (silentButExpected.length > 0) {
      // THE VACUITY WARNING. If the well-documented project came back empty,
      // the invention case passed for the wrong reason.
      console.log(
        `  WARNING: ${silentButExpected.map((v) => v.id).join(", ")} found nothing, and ${""}` +
          `was expected to. A researcher that never finds anything passes the invention case trivially, ${""}` +
          `so read that pass as unproven rather than clean.`,
      );
    }

    for (const verdict of verdicts) {
      const head = verdict.ok ? `${verdict.fields.length} fact(s)` : `REFUSED (${verdict.reason})`;
      console.log(`  ${verdict.id.padEnd(30)} ${head}, ${verdict.searches} search(es)`);
      // EVERY FACT AND EVERY SOURCE PRINTED, on every case, pass or fail. No
      // assertion here judges whether an owner is the RIGHT owner — the web
      // moves and a hardcoded answer would rot — so a person reading this
      // output is the instrument for that, and they need the links.
      for (const fact of verdict.fields) {
        console.log(`      ${fact.field}: ${fact.value}`);
        for (const source of fact.sources) console.log(`         ${source}`);
      }
    }
  });
});
