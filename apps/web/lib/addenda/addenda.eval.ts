import { afterAll, expect, it } from "vitest";
import { extractAddendum, ADDENDUM_PROMPT_VERSION } from "@prova/integrations";
import { normaliseReference } from "@/lib/addenda-overlap";
import { ADDENDUM_CASES, type AddendumCase } from "./addendumCases";
import { addendumPdf } from "./addendumFixtures";

/**
 * CAN THE ADDENDUM READER BE TRUSTED NOT TO INVENT A CHANGE?
 *
 * ── WHAT IS MEASURED, AND WHY IT IS NOT ACCURACY ──
 *
 * `docs/ai/DECISIONS.md` says the metric for this work is FALSE CONFIDENCE, not
 * accuracy, and the reason carries over exactly: a reader that is 85% right and
 * reads as certain is worse than one that is 70% right and says which 30% it is
 * unsure of. An estimator acts on the certain ones.
 *
 * So the scoring is deliberately asymmetric:
 *
 *   INVENTED  — an item for a reference the letter names and explicitly does NOT
 *               change. FATAL. It sends somebody to re-check work nothing
 *               touched, on a bid, against a deadline.
 *   OVERCLAIMED — an invented item carried at HIGH confidence, or any item above
 *               a case's stated ceiling. THE HEADLINE. This is false confidence
 *               with the evidence attached.
 *   MISSED    — an expected reference the reader did not list. Reported, NOT
 *               fatal: a change this did not surface is a person reading the
 *               letter themselves, which is what they do today. The feature is
 *               not worse than nothing when it is quiet; it is worse than
 *               nothing when it is confidently wrong.
 *   EXTRA     — an item that is neither expected nor forbidden. Reported, not
 *               fatal. A model may legitimately split one change into two, or
 *               name something the case author did not think to list, and
 *               scoring that as invention would punish it for being thorough.
 *
 * ── A SCORING BUG THIS FILE WAS BUILT TO AVOID ──
 *
 * The plan-sheet eval shipped reporting "2 hedged when right" as a weakness, and
 * it was a bug in my own metric: it counted LOW on the two sheets that print no
 * number, where LOW is the CORRECT answer and the case required it. The report
 * demanded honesty and scored it as a failing three lines apart.
 *
 * So `underclaimed` here is only ever counted where a CONFIDENT ANSWER WAS
 * AVAILABLE — a case with expected items and no ceiling. On `garbled` and
 * `not-an-addendum`, LOW and an empty list are what the case is asking for.
 *
 * ── HOW TO RUN IT, AND WHAT IT COSTS ──
 *
 *     ANTHROPIC_API_KEY=… pnpm --filter @prova/web exec \
 *       vitest run --config vitest.eval.config.mts lib/addenda/addenda.eval.ts
 *
 * NAME THE FILE. `pnpm ask:eval` runs every `*.eval.ts` — five of them now.
 *
 * ONE OPUS CALL PER CASE in `addendumCases.ts`. The count lives in that list
 * rather than in this sentence, because a number written into prose rots faster
 * than the claim it decorates; the report prints `requested N, returned N` from
 * the list itself. No retries, no loop. `modelFor("ADDENDUM_READ")` is what
 * production resolves, so this measures what actually runs rather than a better
 * model standing in for it.
 *
 * It REFUSES TO START without a key rather than passing on nothing: a green run
 * of zero cases and a green run of seven look identical in a terminal.
 *
 * ── WHAT IT CANNOT TELL YOU ──
 *
 * These are SYNTHETIC letters and deliberately so — a GC's addendum is somebody
 * else's bid document and must never be a fixture. They are clean digital text
 * apart from one deliberately garbled case, and they are SHORT. A real addendum
 * runs to twelve pages with attachments, and nothing here measures whether the
 * reader holds up over that length, nor whether it handles a genuine scan. What
 * it measures is the JUDGEMENT: a cross-reference mistaken for a change, an item
 * invented to look thorough, a date silently converted, a garbled page read
 * confidently. Those are where a wrong answer reaches a bid.
 */

type Verdict = {
  id: string;
  why: string;
  found: string[];
  invented: string[];
  missed: string[];
  extra: string[];
  wrongKind: string[];
  overclaimed: string[];
  underclaimed: boolean;
  badLabel: string[];
  dateNotes: string[];
  itemCount: number;
  readingReason: string;
};

const verdicts: Verdict[] = [];

function requireApiKey(): void {
  // The posture every eval here takes, for the reason they all give: absence of
  // a failure is not a pass.
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new Error("ANTHROPIC_API_KEY is not set: the addendum eval did not run. It is not a pass.");
  }
}

/** Compared the way the app compares them, so the eval cannot be kinder than
 *  production: `addenda-overlap.ts` is what groups these for real. */
const key = (s: string) => normaliseReference(s);

/** Dates are kept AS PRINTED, so this only forgives whitespace and the curly
 *  quotes a PDF font substitution can introduce — never a reformatting. */
function sameish(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const flat = (s: string) =>
    s.replace(/[‘’“”]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
  return flat(a) === flat(b);
}

async function runCase(kase: AddendumCase): Promise<void> {
  const extraction = await extractAddendum({
    fileBase64: addendumPdf(kase.lines).toString("base64"),
    mediaType: "application/pdf",
    fileName: `${kase.id}.pdf`,
  });

  const expectedKeys = new Map(kase.expected.map((e) => [key(e.reference), e.kind]));
  const forbidden = new Set((kase.absent ?? []).map(key));

  const found: string[] = [];
  const invented: string[] = [];
  const extra: string[] = [];
  const wrongKind: string[] = [];
  const overclaimed: string[] = [];
  const badLabel: string[] = [];

  const seen = new Set<string>();
  for (const item of extraction.items) {
    const k = key(item.reference);
    seen.add(k);

    if (forbidden.has(k)) {
      invented.push(`${item.reference} (${item.confidence}) — ${item.summary}`);
      // An invented item carried confidently is the thing this eval exists for.
      if (item.confidence === "HIGH") overclaimed.push(`invented "${item.reference}" at HIGH`);
    } else if (expectedKeys.has(k)) {
      found.push(item.reference);
      const want = expectedKeys.get(k)!;
      if (item.referenceKind !== want) {
        wrongKind.push(`${item.reference}: got ${item.referenceKind}, wanted ${want}`);
      }
    } else {
      extra.push(`${item.reference} (${item.confidence}) — ${item.summary}`);
    }

    if (kase.ceiling === "LOW" && item.confidence !== "LOW") {
      overclaimed.push(`"${item.reference}" at ${item.confidence} on a document the case caps at LOW`);
    }
    if (kase.ceiling === "MEDIUM" && item.confidence === "HIGH") {
      overclaimed.push(`"${item.reference}" at HIGH on a document the case caps at MEDIUM`);
    }

    for (const forbiddenLabel of kase.forbiddenLabels ?? []) {
      if (item.label && key(item.label) === key(forbiddenLabel)) {
        badLabel.push(`reported "${item.label}", which the document does not contain`);
      }
    }
  }

  const missed = [...expectedKeys.keys()]
    .filter((k) => !seen.has(k))
    .map((k) => kase.expected.find((e) => key(e.reference) === k)!.reference);

  const dateNotes: string[] = [];
  if (kase.issueDateText !== undefined && !sameish(extraction.issueDateText, kase.issueDateText)) {
    dateNotes.push(`issue date: got ${JSON.stringify(extraction.issueDateText)}, wanted ${JSON.stringify(kase.issueDateText)}`);
  }
  if (kase.bidDateText !== undefined && !sameish(extraction.bidDateText, kase.bidDateText)) {
    dateNotes.push(`bid date: got ${JSON.stringify(extraction.bidDateText)}, wanted ${JSON.stringify(kase.bidDateText)}`);
  }

  // UNDERCLAIMED ONLY WHERE A CONFIDENT ANSWER WAS AVAILABLE. On a garbled page
  // or a document that is not an addendum, hedging is the correct answer and
  // counting it as a weakness is the plan-sheet eval's own scoring bug.
  const confidentAnswerAvailable = kase.expected.length > 0 && !kase.ceiling;
  const underclaimed =
    confidentAnswerAvailable &&
    found.length > 0 &&
    extraction.items
      .filter((i) => expectedKeys.has(key(i.reference)))
      .every((i) => i.confidence === "LOW");

  verdicts.push({
    id: kase.id,
    why: kase.why,
    found,
    invented,
    missed,
    extra,
    wrongKind,
    overclaimed,
    underclaimed,
    badLabel,
    dateNotes,
    itemCount: extraction.items.length,
    readingReason: extraction.readingReason,
  });
}

for (const kase of ADDENDUM_CASES) {
  it(`reads ${kase.id}`, async () => {
    requireApiKey();
    await runCase(kase);
  }, 180_000);
}

afterAll(() => {
  if (verdicts.length === 0) return;

  const invented = verdicts.flatMap((v) => v.invented);
  const overclaimed = verdicts.flatMap((v) => v.overclaimed);
  const badLabel = verdicts.flatMap((v) => v.badLabel);
  const missed = verdicts.flatMap((v) => v.missed);
  const extra = verdicts.flatMap((v) => v.extra);
  const wrongKind = verdicts.flatMap((v) => v.wrongKind);
  const dateNotes = verdicts.flatMap((v) => v.dateNotes);
  const foundCount = verdicts.reduce((n, v) => n + v.found.length, 0);
  const wanted = ADDENDUM_CASES.reduce((n, k) => n + k.expected.length, 0);

  const lines: string[] = [];
  lines.push("");
  lines.push(`addendum eval (${ADDENDUM_PROMPT_VERSION})`);
  // COUNTED FIRST, AND OUT OF THE CASE LIST. Every other number below is over
  // the whole suite only if this line says so — a run where three cases died
  // and four passed must not read as a clean four.
  lines.push(`  requested ${ADDENDUM_CASES.length}, returned ${verdicts.length}`);
  lines.push(`  items:       ${foundCount} of ${wanted} expected references found, ${missed.length} missed`);
  lines.push(`  INVENTED:    ${invented.length}   (a change the letter does not make — fatal)`);
  lines.push(`  OVERCLAIMED: ${overclaimed.length}   (the metric that matters)`);
  lines.push(`  bad labels:  ${badLabel.length}   (an item number the document does not contain)`);
  lines.push(`  extra:       ${extra.length}   (reported, not fatal)`);
  lines.push(`  wrong kind:  ${wrongKind.length}   (reported, not fatal)`);
  lines.push(`  date notes:  ${dateNotes.length}   (a date converted rather than copied)`);
  lines.push("");
  for (const v of verdicts) {
    lines.push(`  ${v.id} — ${v.itemCount} item(s)`);
    lines.push(`    for: ${v.why}`);
    if (v.found.length) lines.push(`    found: ${v.found.join(", ")}`);
    if (v.invented.length) lines.push(`    INVENTED: ${v.invented.join(" | ")}`);
    if (v.overclaimed.length) lines.push(`    OVERCLAIMED: ${v.overclaimed.join(" | ")}`);
    if (v.badLabel.length) lines.push(`    BAD LABEL: ${v.badLabel.join(" | ")}`);
    if (v.missed.length) lines.push(`    missed: ${v.missed.join(", ")}`);
    if (v.extra.length) lines.push(`    extra: ${v.extra.join(" | ")}`);
    if (v.wrongKind.length) lines.push(`    wrong kind: ${v.wrongKind.join(" | ")}`);
    if (v.dateNotes.length) lines.push(`    dates: ${v.dateNotes.join(" | ")}`);
    if (v.underclaimed) lines.push(`    hedged where a confident answer was available`);
    lines.push(`    reading: ${v.readingReason}`);
  }
  lines.push("");
  console.log(lines.join("\n"));

  // THE COUNT BEFORE THE CONTENT. A missing verdict is its own failure state and
  // must never be folded into a clean number — CLAUDE.md's rule, from a review
  // that reported "0 confirmed, 10 refuted" when the agents had died before
  // writing a verdict.
  expect(verdicts.length, "every case returned a verdict").toBe(ADDENDUM_CASES.length);

  // The two that fail the run. Everything else is reported and read by a person.
  expect(invented, "the reader invented a change the letter does not make").toEqual([]);
  expect(overclaimed, "the reader was confident about something it should not have been").toEqual([]);
  expect(badLabel, "the reader produced an item number the document does not contain").toEqual([]);
});
