import { afterAll, describe, expect, it } from "vitest";
import {
  draftEstimateLineItems,
  DRAFT_LINES_PROMPT_VERSION,
  modelFor,
  type DraftLineItem,
} from "@prova/integrations";
import { DRAFT_LINE_CASES, type DraftLineCase } from "./draftLineCases";

/**
 * DOES THE DRAFTER CLAIM THIS COMPANY'S OWN PRICES FOR WORK IT HAS NEVER PRICED?
 *
 * `FEATURE-AUDIT.md` carries "draft estimate line items from text" as Built, and it
 * is. What it had no instrument for was whether the output is any good — the
 * routing eval (`lib/ask/eval/cases.ts`, `cmd-draft-lines`) proves the assistant
 * picks this command and says nothing whatever about what the command then
 * produces. This is the missing half.
 *
 * ── THE METRIC, AND WHY IT IS THIS ONE ──
 *
 * `docs/ai/DECISIONS.md`: "the metric I care most about is false confidence, not
 * accuracy. A count that is 85% accurate and says so is useful; a count that is
 * 85% accurate and reads as certain is a wrong bid."
 *
 * For this feature false confidence has a precise form: `priceBasis:
 * "COMPANY_CATALOG"` on a line whose price did not come from the catalog. That is
 * the strongest badge the UI shows, `PriceBasisBadge` renders it as this company's
 * own verified price, and `draft-lines.ts` copies the matched entry's unit price,
 * budgeted cost, labour hours, craft and cost category onto the line. So ONE wrong
 * match writes five wrong fields and labels them trustworthy.
 *
 * It is also the one failure the deterministic guards cannot reach. They downgrade
 * a catalog id that was not in the list — a hallucinated id becomes null and the
 * basis degrades to GENERAL_KNOWLEDGE. A REAL id for the WRONG WORK survives all of
 * it: the id resolves, the foreign key is valid, nothing is missing. The system
 * prompt names the case ("a catalog entry for 5/8" type X board is not a match for
 * acoustic ceiling tile") and a rule stated in a prompt is a hope until something
 * scores it.
 *
 * ── FATAL VERSUS REPORTED, ON ONE RULE ──
 *
 * Fatal is where the estimator CANNOT catch it; reported is where they can.
 *
 *   OVERCLAIMED   COMPANY_CATALOG against an entry that is not this work, or a
 *                 basis the case's evidence cannot support (HISTORICAL_BID with no
 *                 won bids). The estimator's defence against a bad draft is reading
 *                 it, and this is the field that tells them not to bother.
 *                 **Fatal.**
 *   FOREIGN       a priced line for work this sub does not self-perform —
 *                 electrical, glazing, painting. On a real bid that is money given
 *                 to another trade, and it reads like scope rather than an error.
 *                 **Fatal.**
 *   INVENTED      a price where the scope supports none. The prompt says "a missing
 *                 price is fine; an invented one is not". **Fatal.**
 *   CATCH-ALL     one line where the scope plainly holds several. Bad, and wholly
 *                 visible — the estimator splits it. **Reported.**
 *   PRICE DRIFT   claimed the catalog and then quoted a different number. Harmless
 *                 downstream, because `draft-lines.ts` writes the ENTRY's price and
 *                 ignores the model's. **Reported**, because it is a signal the
 *                 match was reasoned about loosely even when it was right.
 *
 * ── HOW TO RUN IT, AND WHAT IT COSTS ──
 *
 *     ANTHROPIC_API_KEY=sk-ant-… pnpm eval:draft-lines
 *
 * Or put the key in `apps/web/.env` once and run `pnpm eval:draft-lines` with
 * nothing in front of it — `vitest.eval.config.mts` reads that file, and its header
 * records why: a long key pasted in front of a long pnpm command produced
 * `zsh: command not found: --filter` twice on two different days. A real
 * environment variable still wins.
 *
 * ONE CALL PER CASE in `draftLineCases.ts`, on whatever `modelFor` resolves for
 * this feature — Opus 5 today, which is the expensive end and the point: this
 * measures what production runs, not a cheaper stand-in. The count lives in that
 * list and the report prints `requested N, returned N` from it.
 *
 * ── WHAT IT CANNOT TELL YOU ──
 *
 * The scopes are SYNTHETIC, and they must be: a customer's scope of work is
 * confidential and never a fixture. They are also clean prose, where a real GC's
 * scope paragraph is a scanned exhibit with cross-references. So this measures the
 * JUDGEMENT — whether near-miss catalog work is matched anyway, whether another
 * trade's scope gets absorbed, whether a price appears with nothing behind it — and
 * not extraction from an ugly document.
 *
 * It says nothing about whether the QUANTITIES are right. A quantity off a scope
 * paragraph is a guess by construction, the lines are written `aiDrafted: true` for
 * exactly that reason, and `takeoff.ts` already carries this repo's rule about
 * measurement: a tool that is slightly wrong is worse than no tool. Grading
 * quantities here would be inventing a ground truth nobody measured.
 */

type Verdict = {
  id: string;
  lines: number;
  overclaimed: string[];
  foreign: string[];
  invented: string[];
  catchAll: boolean;
  priceDrift: string[];
  /** Lines with no price. The safe failure, and the one the first version of this
   *  file could not see at all. */
  unpriced: number;
  /** A case where a price was available and NOT ONE line carried one. */
  refusedAll: boolean;
  /** The case constrained `allowedBases` and no line carried any basis, so that
   *  constraint checked nothing. Its own vacuity, reported rather than hidden. */
  basisCheckVacuous: boolean;
  basisTally: Record<string, number>;
  got: DraftLineItem[];
};

const verdicts: Verdict[] = [];

function requireApiKey(): void {
  // The posture every eval here takes, for the reason they all give: absence of a
  // failure is not a pass.
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY is not set: the draft-lines eval did not run. It is not a pass.");
  }
  // AND NOT THE PLACEHOLDER — the header writes the key as `sk-ant-…`, and pasting
  // it unedited satisfies "is it set" and then fails as an auth error a minute
  // later, which reads like a broken eval rather than an unedited command. Checked
  // by length, not by prefix, so a key format change does not make this lie. The
  // key itself is never printed.
  if (key.length < 20) {
    throw new Error(
      `ANTHROPIC_API_KEY is set to ${key.length} character(s), which is too short to be a key: the ` +
        `draft-lines eval did not run. If you pasted the command with its "…" placeholder still in it, that is this.`,
    );
  }
}

/** Case-insensitive substring, the way a person would skim for the word. */
function mentions(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function grade(one: DraftLineCase, lines: DraftLineItem[]): Verdict {
  const claimable = new Set(one.claimableCatalogIds);
  const priceById = new Map(one.catalogEntries.map((entry) => [entry.id, entry.defaultUnitPrice]));

  const overclaimed: string[] = [];
  const foreign: string[] = [];
  const invented: string[] = [];
  const priceDrift: string[] = [];
  const basisTally: Record<string, number> = {};

  for (const line of lines) {
    const basis = line.priceBasis ?? "none";
    basisTally[basis] = (basisTally[basis] ?? 0) + 1;

    // THE HEADLINE. A COMPANY_CATALOG badge that survived the downgrade always has
    // a real id behind it, so the only question left is whether that entry is this
    // work — which is the question no code downstream can ask.
    if (line.priceBasis === "COMPANY_CATALOG") {
      if (!line.catalogEntryId) {
        overclaimed.push(`"${line.description}" claims COMPANY_CATALOG with no entry`);
      } else if (!claimable.has(line.catalogEntryId)) {
        const entry = one.catalogEntries.find((e) => e.id === line.catalogEntryId);
        overclaimed.push(
          `"${line.description}" claims COMPANY_CATALOG against ${line.catalogEntryId}` +
            (entry ? ` (${entry.description})` : ""),
        );
      }
    }

    // A basis the case's own evidence cannot support. HISTORICAL_BID with no won
    // bids in the list is the same lie as the one above, one notch weaker.
    if (one.allowedBases && line.priceBasis && !one.allowedBases.includes(line.priceBasis)) {
      overclaimed.push(`"${line.description}" claims ${line.priceBasis}, unsupported here`);
    }

    for (const term of one.foreignScope ?? []) {
      if (mentions(line.description, term)) {
        foreign.push(`"${line.description}" prices ${term}`);
        break;
      }
    }

    if (one.expectNoPrice && line.unitPrice != null) {
      invented.push(`"${line.description}" priced at ${line.unitPrice} with nothing to price from`);
    }

    // Reported only: the caller overwrites this with the entry's own price.
    if (line.priceBasis === "COMPANY_CATALOG" && line.catalogEntryId && claimable.has(line.catalogEntryId)) {
      const want = priceById.get(line.catalogEntryId);
      if (want != null && line.unitPrice != null && Math.abs(line.unitPrice - want) > 0.011) {
        priceDrift.push(`"${line.description}" quoted ${line.unitPrice}, catalog says ${want}`);
      }
    }
  }

  const unpriced = lines.filter((line) => line.unitPrice == null).length;

  return {
    id: one.id,
    lines: lines.length,
    overclaimed,
    foreign,
    invented,
    catchAll: one.minLines != null && lines.length < one.minLines,
    priceDrift,
    unpriced,
    // A price was there to be given and none was. Reported, never fatal — see
    // `pricedExpected` in the case list for why the safe direction stays safe.
    refusedAll: one.pricedExpected === true && unpriced === lines.length,
    // THE CHECK ADMITTING WHEN IT CHECKED NOTHING. `allowedBases` only constrains
    // a line that HAS a basis, so a case where every line declined to price
    // satisfied it without examining anything — which is how the first run passed
    // `no-catalog-no-history` while that case saw zero GENERAL_KNOWLEDGE bases.
    basisCheckVacuous: one.allowedBases != null && lines.every((line) => line.priceBasis == null),
    basisTally,
    got: lines,
  };
}

describe("drafting estimate lines from a scope of work", () => {
  requireApiKey();

  // DERIVED, NOT HARDCODED, so this cannot quietly stop measuring production. If
  // the feature's default model changes, this eval changes with it.
  const model = modelFor("DRAFT_ESTIMATE_LINES").model;

  for (const one of DRAFT_LINE_CASES) {
    it(`${one.id} — ${one.why}`, async () => {
      const lines = await draftEstimateLineItems(
        one.scopeText,
        { catalogEntries: one.catalogEntries, wonBids: one.wonBids },
        undefined,
        model,
      );

      // A CASE THAT DREW NO LINES IS NOT A PASS. The drafter throws on an empty
      // result, so reaching here with zero means the shape changed under us.
      expect(lines.length, `${one.id}: the drafter returned no lines at all`).toBeGreaterThan(0);

      const verdict = grade(one, lines);
      verdicts.push(verdict);

      // FATAL — false confidence. Graded first and separately because DECISIONS.md
      // says it is the metric that matters more than correctness.
      expect(
        verdict.overclaimed,
        `${one.id}: a COMPANY_CATALOG badge is this company's own verified price, and ` +
          `draft-lines.ts copies that entry's cost, hours, craft and cost category onto the line — ` +
          `so a wrong match writes five wrong fields and tells the estimator to trust them. ${one.why}`,
      ).toEqual([]);

      // FATAL — pricing another trade's scope.
      expect(
        verdict.foreign,
        `${one.id}: this company self-performs framing/drywall, plaster, EIFS, ceilings and ` +
          `fireproofing only. A line for anybody else's work reads as scope on the bid, not as an error.`,
      ).toEqual([]);

      // FATAL — a number with nothing behind it.
      expect(
        verdict.invented,
        `${one.id}: the prompt's own rule is that a missing price is fine and an invented one is not`,
      ).toEqual([]);
    });
  }

  afterAll(() => {
    // VERDICTS RETURNED AGAINST VERDICTS REQUESTED, FIRST — CLAUDE.md's rule for
    // anything that aggregates. A run that died on a rate limit after two cases
    // must not read as two passes.
    const requested = DRAFT_LINE_CASES.length;
    const tally = {
      overclaimed: verdicts.filter((v) => v.overclaimed.length > 0).length,
      foreign: verdicts.filter((v) => v.foreign.length > 0).length,
      invented: verdicts.filter((v) => v.invented.length > 0).length,
      catchAll: verdicts.filter((v) => v.catchAll).length,
      priceDrift: verdicts.reduce((sum, v) => sum + v.priceDrift.length, 0),
      lines: verdicts.reduce((sum, v) => sum + v.lines, 0),
      unpriced: verdicts.reduce((sum, v) => sum + v.unpriced, 0),
      refusedAll: verdicts.filter((v) => v.refusedAll).length,
      vacuous: verdicts.filter((v) => v.basisCheckVacuous).length,
    };

    console.log(
      `\ndraft-lines eval (${DRAFT_LINES_PROMPT_VERSION}, ${model}): requested ${requested}, returned ${verdicts.length}`,
    );
    if (verdicts.length !== requested) {
      console.log("  INCOMPLETE — the numbers below are over the cases that ran, not over the suite.");
    }
    console.log(`  false confidence: ${tally.overclaimed} OVERCLAIMED`);
    console.log(`  scope:            ${tally.foreign} priced another trade's work, ${tally.invented} INVENTED a price`);
    console.log(
      `  structure:        ${tally.catchAll} collapsed to a catch-all, ${tally.priceDrift} price drift ` +
        `(both reported, not fatal) — ${tally.lines} lines over ${verdicts.length} cases`,
    );
    // THE SAFE FAILURE, PRINTED AS LOUDLY AS THE UNSAFE ONE. Without this line a
    // drafter that priced nothing at all would read as a flawless run.
    console.log(
      `  silence:          ${tally.unpriced} of ${tally.lines} lines carried NO PRICE; ` +
        `${tally.refusedAll} case(s) where a price was available and none was given`,
    );
    if (tally.vacuous > 0) {
      console.log(
        `  NOTE:             ${tally.vacuous} case(s) constrained allowedBases and saw no basis at all, ` +
          `so that constraint examined nothing on them`,
      );
    }

    for (const v of verdicts) {
      const bases = Object.entries(v.basisTally)
        .map(([basis, n]) => `${basis}×${n}`)
        .join(" ");
      const flags =
        (v.overclaimed.length ? "  <- OVERCLAIMED" : "") +
        (v.foreign.length ? "  <- FOREIGN SCOPE" : "") +
        (v.invented.length ? "  <- INVENTED PRICE" : "") +
        (v.catchAll ? "  <- catch-all" : "") +
        (v.refusedAll ? "  <- priced NOTHING" : "") +
        (v.basisCheckVacuous ? "  <- basis check vacuous" : "");
      console.log(`  ${v.id.padEnd(26)} ${String(v.lines).padStart(2)} lines  ${bases}${flags}`);
      for (const note of [...v.overclaimed, ...v.foreign, ...v.invented, ...v.priceDrift]) {
        console.log(`      ${note}`);
      }
      // THE LINES THEMSELVES on anything that went wrong: a failure here can be the
      // prompt, the model, or a case whose catalog is genuinely ambiguous, and a
      // verdict alone cannot tell the three apart.
      if (v.overclaimed.length || v.foreign.length || v.invented.length || v.catchAll || v.refusedAll) {
        for (const line of v.got) {
          console.log(
            `      · ${line.description} | ${line.quantity} ${line.unit ?? "-"} | ` +
              `${line.unitPrice ?? "no price"} | ${line.priceBasis ?? "no basis"} | ` +
              `${line.catalogEntryId ?? "no entry"} | ${line.tradeScope ?? "no trade"}`,
          );
        }
      }
    }
  });
});
