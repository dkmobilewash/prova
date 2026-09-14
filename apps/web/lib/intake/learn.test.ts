import { describe, expect, it } from "vitest";
import {
  MIN_AGREEING,
  applyLearning,
  describeLearning,
  filenameTokens,
  learnFromCorrections,
  type Correction,
} from "./learn";
import { INTAKE_KINDS, INTAKE_KIND_LABELS } from "./review";

/**
 * What the office does that the classifier does not know.
 *
 * The expensive property here is NOT accuracy, it is refusal: what gets
 * filed through this screen is certified payroll, a pay application, an
 * executed subcontract — records this repo's own rules say lock on creation
 * and never delete once sent. So most of the tests below are about learning
 * NOTHING, and each of those has to be shown to fail for the right reason:
 * a tokeniser that returned an empty list would make every one of them pass
 * while checking nothing, which is this codebase's most-repeated scar.
 */

const answered = (over: Partial<Correction> = {}): Correction => ({
  fileName: "brackett-waiver-01.pdf",
  proposedKind: "COMPLIANCE_DOC",
  acceptedKind: "LIEN_WAIVER",
  jobHint: null,
  jobId: "job-brackett",
  ...over,
});

describe("filenameTokens", () => {
  /* THE SCANNER'S OWN FIXTURE TEST. Every "learned nothing" assertion below
     rests on this returning real words; if it returned [] they would all
     pass and this file would be checking the empty set. */
  it("keeps the words the office chose and drops the ones it did not", () => {
    expect(filenameTokens("Brackett-Waiver-01.pdf").sort()).toEqual(["brackett", "waiver"]);
    // Extension, separators, pure digits, and the too-common words.
    expect(filenameTokens("2026_final_COPY_riverside.PDF")).toEqual(["riverside"]);
    // Two letters is not a habit, it is a collision.
    expect(filenameTokens("hb-jr-maple.pdf")).toEqual(["maple"]);
    // Case folds, duplicates collapse.
    expect(filenameTokens("MAPLE maple Maple.pdf")).toEqual(["maple"]);
  });

  it("returns nothing for a name that is all noise — and that is a real answer", () => {
    expect(filenameTokens("final copy.pdf")).toEqual([]);
    expect(filenameTokens("2026-09-14.pdf")).toEqual([]);
  });
});

describe("learnFromCorrections", () => {
  it("needs more than one example before it calls anything a habit", () => {
    const one = learnFromCorrections([answered({ fileName: "brackett-waiver-01.pdf" })]);
    expect(one.kinds).toEqual([]);

    const two = learnFromCorrections([
      answered({ fileName: "brackett-waiver-01.pdf" }),
      answered({ fileName: "brackett-waiver-02.pdf" }),
    ]);
    // Non-vacuous: the same input that taught nothing at one example DOES
    // teach at two, so the emptiness above is the threshold and not a
    // tokeniser returning nothing.
    expect(two.kinds.map((r) => r.token).sort()).toEqual(["brackett", "waiver"]);
    expect(two.kinds.every((r) => r.value === "LIEN_WAIVER")).toBe(true);
    expect(MIN_AGREEING).toBe(2);
  });

  it("forgets a rule the moment anything disagrees, and does not let it come back", () => {
    const learned = learnFromCorrections([
      answered({ fileName: "brackett-waiver-01.pdf", acceptedKind: "LIEN_WAIVER" }),
      answered({ fileName: "brackett-waiver-02.pdf", acceptedKind: "LIEN_WAIVER" }),
      // One person, once, says these are actually pay applications.
      answered({ fileName: "brackett-waiver-03.pdf", acceptedKind: "PAY_APP" }),
      // ...and then three more agree with the ORIGINAL. A majority vote
      // would restore the rule. This is not a majority vote.
      answered({ fileName: "brackett-waiver-04.pdf", acceptedKind: "LIEN_WAIVER" }),
      answered({ fileName: "brackett-waiver-05.pdf", acceptedKind: "LIEN_WAIVER" }),
      answered({ fileName: "brackett-waiver-06.pdf", acceptedKind: "LIEN_WAIVER" }),
    ]);
    expect(learned.kinds).toEqual([]);
  });

  it("learns nothing about KIND from somebody agreeing with the classifier", () => {
    // Accepted == proposed five times over. Agreement is agreement with a
    // machine; it is not a person telling it something it did not know.
    const learned = learnFromCorrections(
      [1, 2, 3, 4, 5].map((n) =>
        answered({
          fileName: `riverside-payapp-0${n}.pdf`,
          proposedKind: "PAY_APP",
          acceptedKind: "PAY_APP",
        }),
      ),
    );
    expect(learned.kinds).toEqual([]);
    // But it IS a person choosing a job, every time — the classifier never
    // proposed one, so there is nothing here to agree with.
    expect(learned.jobs.map((r) => r.token).sort()).toEqual(["payapp", "riverside"]);
  });

  it("ignores a row nobody has answered rather than reading it as agreement", () => {
    const learned = learnFromCorrections([
      answered({ fileName: "brackett-waiver-01.pdf", acceptedKind: null }),
      answered({ fileName: "brackett-waiver-02.pdf", acceptedKind: null }),
    ]);
    expect(learned.kinds).toEqual([]);
    expect(learned.jobs).toEqual([]);
  });

  it("treats company paperwork as a real answer that can contradict a job", () => {
    const learned = learnFromCorrections([
      answered({ fileName: "riverside-coi.pdf", jobId: null }),
      answered({ fileName: "riverside-payapp.pdf", jobId: "job-riverside" }),
    ]);
    // "riverside" means both things, so it means nothing.
    expect(learned.jobs.map((r) => r.token)).not.toContain("riverside");
  });

  it("counts agreement and keeps a few of the person's own filenames as evidence", () => {
    const learned = learnFromCorrections([
      answered({ fileName: "brkt-01.pdf", jobId: "job-brackett" }),
      answered({ fileName: "brkt-02.pdf", jobId: "job-brackett" }),
      answered({ fileName: "brkt-03.pdf", jobId: "job-brackett" }),
      answered({ fileName: "brkt-04.pdf", jobId: "job-brackett" }),
    ]);
    const rule = learned.jobs.find((r) => r.token === "brkt");
    expect(rule?.timesAgreed).toBe(4);
    // Capped, so a folder of eighty does not put eighty filenames on screen.
    expect(rule?.examples).toHaveLength(3);
    expect(rule?.examples[0]).toBe("brkt-01.pdf");
  });
});

describe("applyLearning", () => {
  const learned = learnFromCorrections([
    answered({ fileName: "brkt-waiver-01.pdf" }),
    answered({ fileName: "brkt-waiver-02.pdf" }),
  ]);

  it("does not argue with a HIGH-confidence reading of the document itself", () => {
    const result = applyLearning(
      { fileName: "brkt-waiver-03.pdf", kind: "CERTIFIED_PAYROLL", confidence: "HIGH", jobId: null },
      learned,
    );
    // The text said certified payroll. A filename habit does not outrank it.
    expect(result.kind).toBe("CERTIFIED_PAYROLL");
    expect(result.becauseYouUsually.some((s) => s.includes("Filed as"))).toBe(false);
  });

  it("fills a gap the classifier could not, and says so in the person's words", () => {
    const result = applyLearning(
      { fileName: "brkt-waiver-03.pdf", kind: "UNKNOWN", confidence: "LOW", jobId: null },
      learned,
    );
    expect(result.kind).toBe("LIEN_WAIVER");
    expect(result.jobId).toBe("job-brackett");
    expect(result.becauseYouUsually).toHaveLength(2);
    // The sentence names the evidence, never "AI determined".
    expect(result.becauseYouUsually.join(" ")).toContain('"brkt"');
    expect(result.becauseYouUsually.join(" ").toLowerCase()).not.toContain("ai ");
  });

  it("leaves it blank when two habits disagree", () => {
    // Every row AGREES with the classifier on kind, so no kind rule is
    // learned and this test is about the job alone. (Written the other way
    // first, and the kind rule fired correctly — both tokens happened to
    // teach the same kind, so there was nothing ambiguous about it. The
    // fixture was the bug, not the code.)
    const agreeing = { proposedKind: "PAY_APP", acceptedKind: "PAY_APP" } as const;
    const conflicting = learnFromCorrections([
      // "brkt" means the Brackett job...
      answered({ fileName: "brkt-alpha.pdf", jobId: "job-brackett", ...agreeing }),
      answered({ fileName: "brkt-beta.pdf", jobId: "job-brackett", ...agreeing }),
      // ...and "maple" means a different one.
      answered({ fileName: "maple-alpha.pdf", jobId: "job-maple", ...agreeing }),
      answered({ fileName: "maple-beta.pdf", jobId: "job-maple", ...agreeing }),
    ]);
    expect(conflicting.kinds).toEqual([]);
    // Both rules are real on their own.
    expect(conflicting.jobs.filter((r) => r.token === "brkt" || r.token === "maple")).toHaveLength(2);

    // A file carrying both words is the moment to ask a person.
    const result = applyLearning(
      { fileName: "brkt-maple-joint.pdf", kind: "UNKNOWN", confidence: "LOW", jobId: null },
      conflicting,
    );
    expect(result.jobId).toBeNull();
    expect(result.becauseYouUsually).toEqual([]);
  });

  it("never overwrites a job the person already chose on this row", () => {
    const result = applyLearning(
      { fileName: "brkt-waiver-03.pdf", kind: "UNKNOWN", confidence: "LOW", jobId: "job-chosen" },
      learned,
    );
    expect(result.jobId).toBe("job-chosen");
  });
});

describe("describeLearning", () => {
  const jobs: Record<string, string> = { "job-brackett": "Brackett — Gym Addition" };
  const name = (id: string) => jobs[id] ?? null;

  it("says what it learned as a fact about what the person did", () => {
    const learned = learnFromCorrections([
      answered({ fileName: "brkt-waiver-01.pdf" }),
      answered({ fileName: "brkt-waiver-02.pdf" }),
    ]);
    const lines = describeLearning(learned, name);
    expect(lines.length).toBeGreaterThan(0);
    const all = lines.join("\n");
    expect(all).toContain("you corrected that 2 times");
    expect(all).toContain("Brackett — Gym Addition");
    expect(all).toContain("brkt-waiver-01.pdf");
  });

  it("says one lesson once, however many words in the filename taught it", () => {
    // Found by seeding a tray and READING the panel rather than by
    // reasoning about it: `brkt-waiver-01.pdf` teaches on "brkt" AND on
    // "waiver", and the list said "are a lien waiver" three separate times
    // off four documents. An office that prefixes every file with a project
    // number gets four or five.
    const learned = learnFromCorrections([
      answered({ fileName: "brkt-waiver-01.pdf" }),
      answered({ fileName: "brkt-waiver-02.pdf" }),
    ]);
    // Both rules are still LEARNED — this is a presentation fix, not a
    // behaviour change, and applyLearning still matches on either word.
    expect(learned.kinds.map((r) => r.token).sort()).toEqual(["brkt", "waiver"]);

    const lines = describeLearning(learned, name);
    const aboutKind = lines.filter((l) => l.includes("are a lien waiver"));
    expect(aboutKind).toHaveLength(1);
    expect(aboutKind[0]).toContain('"brkt" or "waiver"');
    // ...and the same for the job half.
    expect(lines.filter((l) => l.includes("go on "))).toHaveLength(1);
  });

  it("keeps two lessons apart when the evidence is different", () => {
    // Merging on the conclusion alone would claim evidence a rule does not
    // have: two separate groups of files can name the same job.
    const learned = learnFromCorrections([
      answered({ fileName: "brkt-alpha.pdf", jobId: "job-brackett", proposedKind: "PAY_APP", acceptedKind: "PAY_APP" }),
      answered({ fileName: "brkt-beta.pdf", jobId: "job-brackett", proposedKind: "PAY_APP", acceptedKind: "PAY_APP" }),
      answered({ fileName: "gym-gamma.pdf", jobId: "job-brackett", proposedKind: "PAY_APP", acceptedKind: "PAY_APP" }),
      answered({ fileName: "gym-delta.pdf", jobId: "job-brackett", proposedKind: "PAY_APP", acceptedKind: "PAY_APP" }),
    ]);
    const lines = describeLearning(learned, name);
    // Same job, different files, so two lines — not one claiming eight.
    expect(lines.filter((l) => l.includes("go on "))).toHaveLength(2);
  });

  it("drops a rule pointing at a job that no longer exists", () => {
    const learned = learnFromCorrections([
      answered({ fileName: "gone-01.pdf", jobId: "job-deleted", acceptedKind: null }),
      answered({ fileName: "gone-02.pdf", jobId: "job-deleted", proposedKind: "PAY_APP", acceptedKind: "PAY_APP" }),
      answered({ fileName: "gone-03.pdf", jobId: "job-deleted", proposedKind: "PAY_APP", acceptedKind: "PAY_APP" }),
    ]);
    // The rule exists...
    expect(learned.jobs.some((r) => r.value === "job-deleted")).toBe(true);
    // ...and is not shown as a raw id to a person.
    expect(describeLearning(learned, name).join("\n")).not.toContain("job-deleted");
  });

  it("does not announce a habit of filing to no job — that is the default", () => {
    const learned = learnFromCorrections([
      answered({ fileName: "coi-alpha.pdf", jobId: null, proposedKind: "COMPLIANCE_DOC", acceptedKind: "COMPLIANCE_DOC" }),
      answered({ fileName: "coi-beta.pdf", jobId: null, proposedKind: "COMPLIANCE_DOC", acceptedKind: "COMPLIANCE_DOC" }),
    ]);
    expect(learned.jobs.some((r) => r.value === null)).toBe(true);
    expect(describeLearning(learned, name)).toEqual([]);
  });
});

describe("the kind vocabulary", () => {
  /* This module spells its own kind words rather than importing the UI
     label table, so the two can drift into disagreement. Asserted rather
     than trusted — and asserted by SIZE as well as membership, because a
     lookup that silently returned undefined would render "unsorted" for
     every kind and no other test here would notice. */
  it("has a word for every kind the enum holds, and no extras", () => {
    const spoken = INTAKE_KINDS.map((kind) =>
      applyLearning(
        { fileName: "x.pdf", kind, confidence: "HIGH", jobId: null },
        { kinds: [], jobs: [] },
      ).kind,
    );
    expect(spoken).toHaveLength(INTAKE_KINDS.length);
    expect(INTAKE_KINDS.length).toBe(10);
    expect(Object.keys(INTAKE_KIND_LABELS).sort()).toEqual([...INTAKE_KINDS].sort());
  });
});
