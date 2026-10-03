import { afterAll, expect, it } from "vitest";
import { extractSpecSection, SPEC_SECTION_PROMPT_VERSION, modelFor } from "@prova/integrations";
import { requireEvalApiKey } from "@/lib/ai/evalApiKey";
import { SPEC_CASES, type SpecCase } from "./specCases";
import { specSectionPdf } from "./specFixtures";

// AT COLLECTION, before any case runs. A suite that needs a key it does not have
// must fail loudly rather than skip: a green run of zero cases and a green run
// of six look identical in a terminal, and the first reads as a clean bill.
requireEvalApiKey("spec-read eval");

/**
 * CAN THE SPEC READER BE TRUSTED NOT TO INVENT A REQUIREMENT?
 *
 * Run it deliberately, never in CI:
 *
 *     pnpm eval:specs
 *
 * ── THE METRIC IS FALSE CONFIDENCE, NOT RECALL ──
 *
 * `docs/ai/DECISIONS.md` in its own words: *"a count that is 85% accurate and
 * says so is useful; a count that is 85% accurate and reads as certain is a
 * wrong bid."* For this feature the shape is precise. A finding this section
 * does not contain sends an estimator to ADD MONEY for work nobody asked for —
 * and unlike a missed finding, they have no way to discover it was invented
 * short of re-reading the section themselves, which is the thing the feature
 * was supposed to save them.
 *
 * So the scoring is asymmetric, the same way the addendum and symbol evals are:
 *
 *   INVENTED  — a finding for a requirement the section explicitly says is NOT
 *               required. **FATAL.** The `names-and-excludes` case exists for
 *               this and nothing else.
 *   EAGER     — findings on a document that is not a spec section for these
 *               trades. **FATAL.** Reporting another trade's cost as yours is
 *               worse than reporting nothing, and `addenda.ts` and `quotes.ts`
 *               both carry this rule because a reader asked to find things will
 *               find things.
 *   OVERCLAIMED — a confidence above a case's ceiling. **FATAL** on the garbled
 *               page: a HIGH reading of text nobody can read is the whole
 *               failure mode.
 *   MISSED    — an expected kind the reader did not surface. **REPORTED, not
 *               fatal.** A requirement this did not surface is an estimator
 *               reading the section themselves, which is what they do today —
 *               the feature is not worse than nothing when it is quiet, it is
 *               worse than nothing when it is confidently wrong.
 *   EXTRA     — a finding neither expected nor forbidden. **REPORTED, not
 *               fatal.** A real section contains more than a case author
 *               thought to list, and scoring thoroughness as invention would
 *               punish the reader for being useful.
 *
 * ── AND A QUOTE IS NOT OPTIONAL ──
 *
 * Every finding must carry the sentence it was read from, and that sentence must
 * APPEAR IN THE DOCUMENT. This is the one assertion that cannot be satisfied by
 * a plausible-sounding answer: it is checked against the case's own source
 * lines, so a fabricated quote fails whatever else the finding got right. It is
 * also the cheapest possible guard against the failure the whole feature is
 * exposed to — a reader that paraphrases the spec into something it never said.
 *
 * ── WHAT IT CANNOT TELL YOU ──
 *
 * These are SYNTHETIC sections and short ones. A real section runs thirty to
 * sixty pages with cross-references into four others, and nothing here measures
 * whether the reader holds up over that length, nor whether it handles a real
 * scan. What it measures is the JUDGEMENT: a requirement invented, a
 * cross-reference read as a demand, another trade's scope claimed as yours, a
 * garbled page read confidently. Those are where a wrong answer reaches a bid.
 */

type Verdict = {
  id: string;
  why: string;
  found: { kind: string; label: string; confidence: string }[];
  invented: string[];
  missed: string[];
  extra: string[];
  unquoted: string[];
  overclaimed: string[];
  eager: boolean;
  readingReason: string;
};

const verdicts: Verdict[] = [];
const model = modelFor("SPEC_READ").model;
const RANK = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;

/** Whitespace-insensitive containment, because a PDF's extracted text wraps
 *  where the page wrapped and a quote copied off it will not match byte for
 *  byte. Never a looser match than that: the point is that the sentence IS in
 *  the document. */
const flat = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

async function runCase(kase: SpecCase): Promise<void> {
  const extraction = await extractSpecSection({
    fileBase64: specSectionPdf(kase.lines).toString("base64"),
    mediaType: "application/pdf",
    fileName: `${kase.id}.pdf`,
  });

  const source = flat(kase.lines.join(" "));
  const forbidden = (kase.forbidden ?? []).map(flat);

  const invented: string[] = [];
  const unquoted: string[] = [];
  const overclaimed: string[] = [];

  for (const finding of extraction.findings) {
    const haystack = flat(`${finding.label} ${finding.requirement} ${finding.whyItCosts}`);
    if (forbidden.some((phrase) => haystack.includes(phrase))) {
      invented.push(`${finding.kind}: ${finding.label}`);
    }
    // THE QUOTE MUST BE IN THE DOCUMENT. A short quote is not evidence of
    // anything — "Level 5" appears in a section that says Level 5 is not
    // required — so a floor is applied before the containment check.
    const quote = flat(finding.quote);
    if (quote.length < 12 || !source.includes(quote)) {
      unquoted.push(`${finding.kind}: "${finding.quote}"`);
    }
    if (kase.ceiling && RANK[finding.confidence] > RANK[kase.ceiling]) {
      overclaimed.push(`${finding.kind} at ${finding.confidence}`);
    }
  }

  const foundKinds = new Set(extraction.findings.map((f) => f.kind));
  const missed = kase.expectKinds.filter((kind) => !foundKinds.has(kind));
  const extra = [...foundKinds].filter((kind) => !(kase.expectKinds as string[]).includes(kind));

  verdicts.push({
    id: kase.id,
    why: kase.why,
    found: extraction.findings.map((f) => ({ kind: f.kind, label: f.label, confidence: f.confidence })),
    invented,
    missed,
    extra,
    unquoted,
    overclaimed,
    eager: (kase.expectEmpty ?? false) && extraction.findings.length > 0,
    readingReason: extraction.readingReason,
  });

  // ── THE FATAL ASSERTIONS, AND ONLY THESE ──
  expect(
    invented,
    `${kase.id}: reported a requirement this section explicitly does NOT impose. ` +
      `An invented finding sends somebody to add money for work nobody asked for, and they have no way ` +
      `to discover it short of re-reading the section — which is what this was supposed to save them.`,
  ).toEqual([]);

  expect(
    unquoted,
    `${kase.id}: a finding whose quote is not in the document. The quote is the only thing that makes a ` +
      `finding checkable, and one that is not on the page is a paraphrase presented as the spec's own words.`,
  ).toEqual([]);

  expect(
    overclaimed,
    `${kase.id}: confidence above this case's ceiling of ${kase.ceiling}. A confident reading of text ` +
      `nobody can read is the false-confidence failure this eval exists to find.`,
  ).toEqual([]);

  if (kase.expectEmpty) {
    expect(
      extraction.findings.map((f) => `${f.kind}: ${f.label}`),
      `${kase.id}: found cost drivers in a document that is not a spec section for these trades. ` +
        `Reporting somebody else's scope as yours is worse than reporting nothing. It said: ` +
        `"${extraction.readingReason}"`,
    ).toEqual([]);
  }

  // A reading must always say HOW it read, whatever it found.
  expect(extraction.readingReason.trim().length, `${kase.id}: no readingReason`).toBeGreaterThan(0);
}

for (const kase of SPEC_CASES) {
  it(
    `${kase.id} — ${kase.why}`,
    async () => {
      await runCase(kase);
    },
    180_000,
  );
}

afterAll(() => {
  // THE COUNT FIRST, before any score, so a partial run cannot read as a result.
  // #195's scar: a review reported "0 confirmed, 10 refuted" when every verifier
  // had died before writing a verdict, because the aggregator counted "no
  // verdict" as "refuted". Absence of a failure is not a pass.
  const requested = SPEC_CASES.length;
  const lines: string[] = [
    "",
    `spec-read eval — ${SPEC_SECTION_PROMPT_VERSION} on ${model}`,
    `verdicts: requested ${requested}, returned ${verdicts.length}`,
  ];
  if (verdicts.length !== requested) {
    lines.push(
      `  *** ${requested - verdicts.length} CASE(S) RETURNED NO VERDICT. Every number below is over a ` +
        `SUBSET and must not be read as a result. ***`,
    );
  }

  const total = (pick: (v: Verdict) => number) => verdicts.reduce((sum, v) => sum + pick(v), 0);
  lines.push(
    "",
    `INVENTED    ${total((v) => v.invented.length)}   <- fatal, and the one that matters`,
    `EAGER       ${verdicts.filter((v) => v.eager).length}   <- fatal: findings on a document of the wrong kind`,
    `UNQUOTED    ${total((v) => v.unquoted.length)}   <- fatal: a quote not in the document`,
    `OVERCLAIMED ${total((v) => v.overclaimed.length)}   <- fatal: confident on an unreadable page`,
    `missed      ${total((v) => v.missed.length)}   (reported, not fatal)`,
    `extra       ${total((v) => v.extra.length)}   (reported, not fatal — a section holds more than a case lists)`,
    "",
  );

  for (const v of verdicts) {
    lines.push(`${v.id}`);
    if (v.found.length === 0) {
      lines.push(`    nothing found — "${v.readingReason}"`);
    }
    for (const f of v.found) {
      lines.push(`    ${f.confidence.padEnd(6)} ${f.kind.padEnd(14)} ${f.label}`);
    }
    if (v.invented.length > 0) lines.push(`    INVENTED: ${v.invented.join("; ")}`);
    if (v.unquoted.length > 0) lines.push(`    UNQUOTED: ${v.unquoted.join("; ")}`);
    if (v.overclaimed.length > 0) lines.push(`    OVERCLAIMED: ${v.overclaimed.join("; ")}`);
    if (v.missed.length > 0) lines.push(`    missed: ${v.missed.join(", ")}`);
    if (v.extra.length > 0) lines.push(`    extra: ${v.extra.join(", ")}`);
  }

  lines.push(
    "",
    "BOUNDED: synthetic sections, short, clean apart from one deliberately garbled page.",
    "Nothing here measures whether the reader holds up over thirty pages with cross-references",
    "into four other sections, nor whether it handles a real scan. What it measures is the",
    "JUDGEMENT, which is where a wrong answer reaches a bid.",
    "",
  );
  console.log(lines.join("\n"));
});
