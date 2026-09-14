import type { IntakeKindValue } from "./review";

/**
 * What this office does that the classifier does not know.
 *
 * THE SUBSTRATE WAS ALREADY THERE, which is why this file is small.
 * `DocumentIntake` keeps `proposedKind` AND `acceptedKind` side by side, and
 * the schema says in so many words why: "the only way to know whether this
 * screen is any good is to be able to ask how often a person changed the
 * answer." Every correction anybody has ever made is already on disk. Until
 * now nothing read them back, so the same office corrected the same document
 * type every Monday forever.
 *
 * WHAT IT LEARNS, and deliberately only these two:
 *
 *   - a KIND, keyed on a word in the filename. "Every file with WAIVER in
 *     the name, that I was offered as a compliance document, I filed as a
 *     lien waiver."
 *   - a JOB, keyed on a word in the filename. Cyrus asked for this one by
 *     name: the office names its files after the GC or the site, and the
 *     classifier cannot know that "BRKT" is the Brackett job.
 *
 * It does NOT learn a confidence, a review order, or anything at all from a
 * row the person did not touch. A confirmation is agreement with a machine,
 * not an instruction; only a CORRECTION is a person saying something the
 * classifier did not know.
 *
 * ── THE RULE THAT MATTERS: BLANK WHEN AMBIGUOUS ─────────────────────────
 *
 * A learned rule is not a majority vote. One contradiction kills a rule
 * outright and it stays dead, rather than being outvoted later by more
 * examples. That is a deliberate trade against accuracy on paper, and the
 * reason is what these documents ARE: what gets filed through this screen is
 * certified payroll, a pay application, an executed subcontract — the
 * evidence records this repo's own rules say lock on creation and never
 * delete once sent. Guessing right nine times and wrong once is worse here
 * than not guessing, because the tenth is not a mistake you take back.
 *
 * So the bar is high on purpose: a rule needs `MIN_AGREEING` corrections
 * that ALL said the same thing, and nothing that ever said otherwise.
 *
 * ── AND IT NEVER OVERRIDES A CONFIDENT CLASSIFIER ───────────────────────
 *
 * Match first, learn second. A HIGH-confidence reading of the document's own
 * text beats a rule inferred from filenames, because the text is evidence
 * about THIS file and the rule is a habit about files that looked like it.
 * Learning only fills a gap — it moves an UNKNOWN, or a LOW/MEDIUM guess, and
 * stops there.
 */

/** One decision a person actually made: what they were offered, what they
 *  said, and what the file was called when they said it. */
export type Correction = {
  fileName: string;
  proposedKind: IntakeKindValue;
  /** Null for a row nobody has answered yet — ignored, not treated as
   *  agreement. */
  acceptedKind: IntakeKindValue | null;
  /** What the classifier guessed the job was, and what the person filed it
   *  against. A null `jobId` is "company paperwork", which is a real answer
   *  and is learned like any other. */
  jobHint: string | null;
  jobId: string | null;
};

/**
 * How many agreeing corrections make a habit.
 *
 * Two, not three, and not one. One is a typo or a one-off; this screen
 * takes eighty files at a time, so a single odd answer inside one folder is
 * ordinary. Three would mean an office that renames its files consistently
 * waits a month to be helped, and the contradiction rule below is what makes
 * two safe — a second example that DISAGREES does not weaken the rule, it
 * deletes it.
 */
export const MIN_AGREEING = 2;

/**
 * Words too common to key a rule on.
 *
 * "2026_invoice_riverside.pdf" tokenises to three words and only one of them
 * says anything. Without this list the first two corrections in a folder
 * teach it that everything called "pdf" or "final" or "2026" is whatever the
 * person happened to file first — which is exactly the confident-and-wrong
 * failure the contradiction rule exists to prevent, arriving through the
 * front door.
 */
const TOO_COMMON = new Set([
  "a", "an", "and", "the", "of", "for", "to", "from", "with",
  "doc", "docs", "document", "file", "files", "final", "copy", "scan", "scanned",
  "new", "old", "draft", "rev", "revised", "updated", "signed", "pdf", "jpg", "jpeg",
  "png", "img", "image", "photo", "attachment", "untitled", "version", "v",
]);

/** A word must be at least this long to key a rule. Two-letter fragments
 *  ("hb", "jr") collide across unrelated files far too easily. */
const MIN_TOKEN_LENGTH = 3;

/**
 * The filename as words a person would recognise.
 *
 * The extension goes, separators become gaps, digits-only chunks go (a date
 * or a sheet number is not a habit), and anything in TOO_COMMON goes. What
 * is left is the part of the name the office chose: a GC, a site, a document
 * word.
 *
 * Exported because the test suite asserts against it directly — a tokeniser
 * that silently returned nothing would make every rule below unlearnable and
 * every test about "no rule was learned" pass for the wrong reason.
 */
export function filenameTokens(fileName: string): string[] {
  const withoutExtension = fileName.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  const seen = new Set<string>();
  for (const raw of withoutExtension.split(/[^A-Za-z0-9]+/)) {
    const token = raw.toLowerCase();
    if (token.length < MIN_TOKEN_LENGTH) continue;
    if (/^\d+$/.test(token)) continue;
    if (TOO_COMMON.has(token)) continue;
    seen.add(token);
  }
  return [...seen];
}

/** A habit the office has, in a form the screen can act on AND say out
 *  loud. `examples` is the evidence for it, so the "what it learned" list
 *  can show the person their own filenames back. */
export type LearnedRule<T> = { token: string; value: T; timesAgreed: number; examples: string[] };

export type Learned = {
  kinds: LearnedRule<IntakeKindValue>[];
  /** `value` is a jobId, or null meaning "company paperwork, not a job". */
  jobs: LearnedRule<string | null>[];
};

/** Internal tally: what a token has been taught, and whether anything ever
 *  disagreed. `contradicted` is one-way — nothing clears it. */
type Tally<T> = { value: T; count: number; examples: string[]; contradicted: boolean };

function record<T>(into: Map<string, Tally<T>>, token: string, value: T, example: string) {
  const held = into.get(token);
  if (!held) {
    into.set(token, { value, count: 1, examples: [example], contradicted: false });
    return;
  }
  if (held.value !== value) {
    // One disagreement is final. Not a vote — see the header.
    held.contradicted = true;
    return;
  }
  held.count += 1;
  if (held.examples.length < 3 && !held.examples.includes(example)) held.examples.push(example);
}

function harvest<T>(from: Map<string, Tally<T>>): LearnedRule<T>[] {
  const rules: LearnedRule<T>[] = [];
  for (const [token, tally] of from) {
    if (tally.contradicted) continue;
    if (tally.count < MIN_AGREEING) continue;
    rules.push({ token, value: tally.value, timesAgreed: tally.count, examples: tally.examples });
  }
  // Strongest first, then alphabetical so the order is stable for a test and
  // for a person reading the same list twice.
  return rules.sort((a, b) => b.timesAgreed - a.timesAgreed || a.token.localeCompare(b.token));
}

/**
 * Read every decision this company has made and keep only the habits.
 *
 * A row with no `acceptedKind` is skipped: nobody answered it. A row where
 * the person AGREED with the classifier teaches nothing about kind — the
 * classifier already gets that one right — but it DOES teach about the job,
 * because the classifier never proposed a job in the first place; `jobHint`
 * is a guess at a name, not a choice of record.
 */
export function learnFromCorrections(corrections: readonly Correction[]): Learned {
  const kinds = new Map<string, Tally<IntakeKindValue>>();
  const jobs = new Map<string, Tally<string | null>>();

  for (const correction of corrections) {
    if (!correction.acceptedKind) continue;
    const tokens = filenameTokens(correction.fileName);

    // KIND: only when the person CHANGED the answer. Agreement is agreement
    // with a machine, not an instruction.
    if (correction.acceptedKind !== correction.proposedKind) {
      for (const token of tokens) {
        record(kinds, token, correction.acceptedKind, correction.fileName);
      }
    }

    // JOB: every answered row, because every one of them is a person
    // choosing a record rather than accepting a proposal.
    for (const token of tokens) {
      record(jobs, token, correction.jobId, correction.fileName);
    }
  }

  return { kinds: harvest(kinds), jobs: harvest(jobs) };
}

/** What the screen should now propose, and what to SAY about why. */
export type Adjustment = {
  kind: IntakeKindValue;
  jobId: string | null;
  /** One sentence per thing learning changed, in the person's own words.
   *  Empty when learning changed nothing, which is the common case. */
  becauseYouUsually: string[];
};

/**
 * Apply the habits to one fresh proposal.
 *
 * MATCH FIRST, LEARN SECOND, and the two guards below are the whole of it:
 *
 *  - a HIGH-confidence classification is never overridden. That reading came
 *    from the document's own text; a rule is a pattern in filenames.
 *  - a token that matches TWO rules disagreeing about the answer produces
 *    NOTHING. "Brackett submittal" where `brackett` says one job and
 *    `submittal` says another is exactly the moment to leave the field blank
 *    and let a person look.
 */
export function applyLearning(
  proposal: {
    fileName: string;
    kind: IntakeKindValue;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    jobId: string | null;
  },
  learned: Learned,
): Adjustment {
  const tokens = new Set(filenameTokens(proposal.fileName));
  const because: string[] = [];

  let kind = proposal.kind;
  if (proposal.confidence !== "HIGH") {
    const hits = learned.kinds.filter((rule) => tokens.has(rule.token));
    const values = new Set(hits.map((hit) => hit.value));
    if (hits.length > 0 && values.size === 1 && hits[0].value !== proposal.kind) {
      kind = hits[0].value;
      because.push(
        `Filed as ${labelOf(kind)} because the last ${hits[0].timesAgreed} files with ` +
          `"${hits[0].token}" in the name were corrected to that.`,
      );
    }
  }

  let jobId = proposal.jobId;
  if (jobId === null) {
    const hits = learned.jobs.filter((rule) => tokens.has(rule.token));
    const values = new Set(hits.map((hit) => hit.value));
    if (hits.length > 0 && values.size === 1 && hits[0].value !== null) {
      jobId = hits[0].value;
      because.push(
        `Put on the job you have filed the last ${hits[0].timesAgreed} files with ` +
          `"${hits[0].token}" in the name against.`,
      );
    }
  }

  return { kind, jobId, becauseYouUsually: because };
}

/** Kind labels, spelled here rather than imported from review.ts, so this
 *  module stays free of the label table's UI concerns. `learn.test.ts`
 *  asserts the two lists agree, which is the only reason duplicating them
 *  is safe. */
const KIND_WORDS: Record<IntakeKindValue, string> = {
  DRAWING: "a drawing",
  SUBMITTAL: "a submittal",
  RFI_RESPONSE: "an RFI response",
  COMPLIANCE_DOC: "a compliance document",
  EXECUTED_SUBCONTRACT: "an executed subcontract",
  PAY_APP: "a pay application",
  LIEN_WAIVER: "a lien waiver",
  CERTIFIED_PAYROLL: "certified payroll",
  PHOTO: "a photo",
  UNKNOWN: "unsorted",
};

function labelOf(kind: IntakeKindValue): string {
  return KIND_WORDS[kind] ?? "unsorted";
}

/**
 * The visible "what it learned" list.
 *
 * Cyrus asked for this specifically, and it is the half that makes the rest
 * acceptable: a screen that quietly gets better is indistinguishable from a
 * screen that quietly gets worse. Every rule is stated as a fact about what
 * the PERSON did, with their own filenames as the evidence, so it can be
 * read and disagreed with.
 *
 * `jobName` is passed in rather than looked up: this module holds no
 * database.
 */
export function describeLearning(
  learned: Learned,
  jobName: (jobId: string) => string | null,
): string[] {
  const lines: string[] = [];
  for (const rule of learned.kinds) {
    lines.push(
      `Files with "${rule.token}" in the name are ${labelOf(rule.value)} — ` +
        `you corrected that ${rule.timesAgreed} times (${rule.examples.join(", ")}).`,
    );
  }
  for (const rule of learned.jobs) {
    // A rule that files to "no job" is real and worth saying, but it is the
    // DEFAULT the screen already offers, so it is not news. Only a rule that
    // names a job changes anything a person sees.
    if (rule.value === null) continue;
    const name = jobName(rule.value);
    // A rule pointing at a job that no longer exists is dropped rather than
    // shown as an id. It cannot fire either — applyLearning would set a
    // jobId the picker has no option for.
    if (!name) continue;
    lines.push(
      `Files with "${rule.token}" in the name go on ${name} — ` +
        `you filed ${rule.timesAgreed} that way (${rule.examples.join(", ")}).`,
    );
  }
  return lines;
}
