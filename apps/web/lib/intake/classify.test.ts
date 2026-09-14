import { describe, expect, it } from "vitest";
import { classifyDocument, type Classification, type IntakeKind } from "./classify";

/**
 * The only part of document intake where being wrong is expensive.
 *
 * A misfiled photo is nothing. A misfiled certificate of insurance is a
 * compliance problem, and a CONFIDENTLY misfiled one is worse than an
 * honest "I don't know" — because the product's whole ask is that a person
 * glances at the guess and confirms it. A LOW-confidence UNKNOWN costs that
 * person one glance. A HIGH-confidence wrong answer costs the feature its
 * credibility, and after that nobody reads the guesses at all.
 *
 * So these tests check two different things, and the second matters more:
 *
 *   1. the table below — 57 filenames of the shape contractors actually
 *      produce, each with the kind AND the confidence it must come back
 *      with;
 *   2. the HONESTY PROPERTIES — every HIGH names concrete evidence, every
 *      quoted fragment in every `reason` is really present in the input,
 *      every `jobHint` is really present in the input, and no `reason`
 *      talks about itself ("AI determined", "high confidence match")
 *      instead of about the document.
 *
 * Every property test asserts a FLOOR on how many rows exercised it. A
 * property that holds over an empty set holds trivially: if the classifier
 * were weakened until nothing ever returned HIGH, "no HIGH lacks evidence"
 * would still pass, and this file would go green while saying nothing.
 * Those floors are what stop that.
 */

const PDF = "application/pdf";
const JPEG = "image/jpeg";
const HEIC = "image/heic";
const DWG = "application/acad";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type Case = {
  /** What the file is called. */
  file: string;
  mime: string;
  /** First few KB of extracted text, where the caller had any. */
  text?: string;
  kind: IntakeKind;
  confidence: Classification["confidence"];
  /** Asserted on every row — `undefined` in the table means `null`. */
  job?: string;
  rev?: string;
};

/**
 * Realistic names. Several of these are deliberately NOT classifiable and
 * their expected answer is UNKNOWN/LOW — that is the correct answer, not a
 * gap in the table.
 */
const CASES: Case[] = [
  // --- Compliance: the expensive ones to get wrong ---------------------
  { file: "Riverside COI 2027.pdf", mime: PDF, kind: "COMPLIANCE_DOC", confidence: "HIGH", job: "Riverside" },
  { file: "Certificate of Insurance - Riverside Commons.pdf", mime: PDF, kind: "COMPLIANCE_DOC", confidence: "HIGH" },
  { file: "ACORD 25 Riverside.pdf", mime: PDF, kind: "COMPLIANCE_DOC", confidence: "HIGH" },
  { file: "Oakview Terrace W-9.pdf", mime: PDF, kind: "COMPLIANCE_DOC", confidence: "HIGH", job: "Oakview Terrace" },
  { file: "w9 2026.pdf", mime: PDF, kind: "COMPLIANCE_DOC", confidence: "HIGH" },
  { file: "cert of ins expires 3-1-2027.pdf", mime: PDF, kind: "COMPLIANCE_DOC", confidence: "HIGH" },
  // CHANGED 2026-09-14, and the reason is that the COST of this answer
  // changed rather than the answer being newly wrong. This used to expect
  // job "Nevada" on the argument that it is in the filename and the person
  // confirms — never inventing beats never missing. That held while a
  // jobHint was only a string on screen. It stopped holding when two things
  // began ACTING on it: the tray now suggests "3 files name Nevada, which is
  // not a job here", and lib/intake/learn.ts would key a filing habit on it.
  // A hint that is merely noise is cheap; a hint that teaches a habit is not.
  { file: "Nevada contractors license C-4.pdf", mime: PDF, kind: "COMPLIANCE_DOC", confidence: "HIGH" },
  // Bare "license" could be anything, so it must not claim HIGH.
  { file: "license.pdf", mime: PDF, kind: "COMPLIANCE_DOC", confidence: "MEDIUM" },
  { file: "Payment and Performance Bond.pdf", mime: PDF, kind: "COMPLIANCE_DOC", confidence: "HIGH" },
  { file: "OSHA 30 card - J Alvarez.pdf", mime: PDF, kind: "COMPLIANCE_DOC", confidence: "HIGH" },

  // --- Drawings --------------------------------------------------------
  { file: "A-201 Rev4 ASI18.pdf", mime: PDF, kind: "DRAWING", confidence: "HIGH", rev: "Rev 4" },
  { file: "S-101 Rev 2 IFC.pdf", mime: PDF, kind: "DRAWING", confidence: "HIGH", rev: "Rev 2" },
  { file: "Riverside Commons ASI 18.pdf", mime: PDF, kind: "DRAWING", confidence: "HIGH", job: "Riverside Commons", rev: "ASI 18" },
  { file: "Bulletin 7 - partition types.pdf", mime: PDF, kind: "DRAWING", confidence: "MEDIUM", rev: "Bulletin 7" },
  { file: "floor plans.dwg", mime: DWG, kind: "DRAWING", confidence: "HIGH" },
  { file: "Level 3 framing plan.pdf", mime: PDF, kind: "DRAWING", confidence: "MEDIUM" },
  { file: "Addendum 2 drawings.pdf", mime: PDF, kind: "DRAWING", confidence: "MEDIUM" },
  { file: "partition plan A-201.pdf", mime: PDF, kind: "DRAWING", confidence: "HIGH" },

  // --- Submittals ------------------------------------------------------
  // "Shop drawings" are a SUBMITTAL, not a drawing set. The word
  // "drawings" must not drag this into DRAWING or water it down.
  { file: "Shop Drawings - Metal Stud Framing.pdf", mime: PDF, kind: "SUBMITTAL", confidence: "HIGH" },
  { file: "SUB-024.pdf", mime: PDF, kind: "SUBMITTAL", confidence: "MEDIUM", rev: "SUB-024" },
  { file: "Submittal 03-30-00 Rev 2.pdf", mime: PDF, kind: "SUBMITTAL", confidence: "HIGH", rev: "Rev 2" },
  { file: "Submittal 09 21 16 approved as noted.pdf", mime: PDF, kind: "SUBMITTAL", confidence: "HIGH" },
  { file: "product data - joint compound.pdf", mime: PDF, kind: "SUBMITTAL", confidence: "MEDIUM" },
  // In this trade "bond" is a material term as often as an instrument.
  // Two families fire, so the answer must stop claiming HIGH.
  { file: "bond breaker submittal.pdf", mime: PDF, kind: "SUBMITTAL", confidence: "MEDIUM" },

  // --- RFIs ------------------------------------------------------------
  { file: "RFI 042 response.pdf", mime: PDF, kind: "RFI_RESPONSE", confidence: "HIGH", rev: "RFI 042" },
  // No answer word: it may be an outgoing RFI, so not HIGH.
  { file: "RFI-107.pdf", mime: PDF, kind: "RFI_RESPONSE", confidence: "MEDIUM", rev: "RFI 107" },
  { file: "rfi 88 answered by architect.pdf", mime: PDF, kind: "RFI_RESPONSE", confidence: "HIGH", rev: "RFI 88" },

  // --- Pay applications ------------------------------------------------
  { file: "G702 Sept.pdf", mime: PDF, kind: "PAY_APP", confidence: "HIGH" },
  { file: "AIA G702-G703 Riverside App 5.pdf", mime: PDF, kind: "PAY_APP", confidence: "HIGH" },
  { file: "Pay App 7 - Mercy General.pdf", mime: PDF, kind: "PAY_APP", confidence: "HIGH" },
  { file: "application for payment no 3.pdf", mime: PDF, kind: "PAY_APP", confidence: "HIGH" },
  { file: "payapp4.pdf", mime: PDF, kind: "PAY_APP", confidence: "HIGH" },

  // --- Lien waivers ----------------------------------------------------
  { file: "waiver_final_signed(2).pdf", mime: PDF, kind: "LIEN_WAIVER", confidence: "MEDIUM" },
  { file: "Conditional Waiver and Release on Progress Payment.pdf", mime: PDF, kind: "LIEN_WAIVER", confidence: "HIGH" },
  { file: "unconditional lien release final.pdf", mime: PDF, kind: "LIEN_WAIVER", confidence: "HIGH" },
  // A waiver travels WITH a pay app. Both fire; neither gets to be HIGH.
  { file: "Pay App 4 waiver signed.pdf", mime: PDF, kind: "PAY_APP", confidence: "MEDIUM" },

  // --- Certified payroll -----------------------------------------------
  { file: "WH347 wk 9-6.pdf", mime: PDF, kind: "CERTIFIED_PAYROLL", confidence: "HIGH" },
  { file: "certified payroll week 12.pdf", mime: PDF, kind: "CERTIFIED_PAYROLL", confidence: "HIGH" },
  { file: "WH-347 Riverside 08-30-2026.pdf", mime: PDF, kind: "CERTIFIED_PAYROLL", confidence: "HIGH" },

  // --- Subcontracts and change orders ----------------------------------
  {
    file: "Riverside Commons Subcontract executed 2026-08-14.pdf",
    mime: PDF,
    kind: "EXECUTED_SUBCONTRACT",
    confidence: "HIGH",
    job: "Riverside Commons",
  },
  { file: "subcontract draft v3.docx", mime: DOCX, kind: "EXECUTED_SUBCONTRACT", confidence: "MEDIUM" },
  { file: "Change Order 3 fully executed.pdf", mime: PDF, kind: "EXECUTED_SUBCONTRACT", confidence: "HIGH" },
  // "CO" is a company, a state and a change order. Refusing to guess is
  // the right answer here.
  { file: "CO 12 signed.pdf", mime: PDF, kind: "UNKNOWN", confidence: "LOW" },

  // --- Photos ----------------------------------------------------------
  { file: "IMG_8831.jpeg", mime: JPEG, kind: "PHOTO", confidence: "HIGH" },
  { file: "PXL_20260906_181233.jpg", mime: JPEG, kind: "PHOTO", confidence: "HIGH" },
  { file: "level 2 ceiling grid.heic", mime: HEIC, kind: "PHOTO", confidence: "HIGH" },
  // A scanned document arrives as an image too.
  { file: "scan_0042.jpg", mime: JPEG, kind: "PHOTO", confidence: "MEDIUM" },
  // The filename outranks the mime type: this is a COI someone photographed.
  { file: "COI.jpg", mime: JPEG, kind: "COMPLIANCE_DOC", confidence: "HIGH" },

  // --- Genuinely unknowable --------------------------------------------
  { file: "scan_0042.pdf", mime: PDF, kind: "UNKNOWN", confidence: "LOW" },
  { file: "Untitled.pdf", mime: PDF, kind: "UNKNOWN", confidence: "LOW" },
  { file: "document (3).pdf", mime: PDF, kind: "UNKNOWN", confidence: "LOW" },
  { file: "FINAL FINAL v2.pdf", mime: PDF, kind: "UNKNOWN", confidence: "LOW" },

  // --- Text preview rescues an unhelpful filename ----------------------
  {
    file: "Untitled.pdf",
    mime: PDF,
    text: "AIA Document G702 - 1992\nAPPLICATION AND CERTIFICATE FOR PAYMENT\nTO OWNER: ...",
    kind: "PAY_APP",
    confidence: "HIGH",
  },
  {
    file: "scan_0042.pdf",
    mime: PDF,
    text: "ACORD  CERTIFICATE OF LIABILITY INSURANCE  DATE (MM/DD/YYYY)",
    kind: "COMPLIANCE_DOC",
    confidence: "HIGH",
  },
  {
    file: "scan_0088.pdf",
    mime: PDF,
    text: "U.S. Department of Labor\nPAYROLL\nForm WH-347 (Rev. 12/2008)",
    kind: "CERTIFIED_PAYROLL",
    confidence: "HIGH",
  },
  {
    file: "img_0001.pdf",
    mime: PDF,
    text: "CONDITIONAL WAIVER AND RELEASE ON FINAL PAYMENT\nName of Claimant: ...",
    kind: "LIEN_WAIVER",
    confidence: "HIGH",
  },
  {
    file: "scan_0043.pdf",
    mime: PDF,
    text: "Project: Riverside Commons\nRequest for Information No. 42\nResponse from the architect: proceed as detailed.",
    kind: "RFI_RESPONSE",
    confidence: "HIGH",
    job: "Riverside Commons",
    rev: "RFI 42",
  },
];

/**
 * The size guard. This number is written out here and nowhere else, so a
 * table that silently shrinks — a row deleted to make a failure go away,
 * a merge that drops a block — fails loudly instead of passing over a
 * smaller set. Change it ONLY in the same commit that changes the rows.
 */
const EXPECTED_CASE_COUNT = 57;

/** Floors for the honesty properties below. See the header. */
const MIN_HIGH_CASES = 35;
const MIN_QUOTED_FRAGMENTS = 60;
const MIN_JOB_HINTS = 5;
const MIN_REVISION_HINTS = 9;

const run = (c: Case): Classification =>
  classifyDocument({
    filename: c.file,
    mimeType: c.mime,
    sizeBytes: 240_000,
    textPreview: c.text ?? null,
  });

const haystack = (c: Case) => `${c.file}\n${c.mime}\n${c.text ?? ""}`.toLowerCase();

/** Every `'...'` fragment in a reason — what the classifier claims it saw. */
const quotedFragments = (reason: string): string[] =>
  [...reason.matchAll(/'([^']*)'/g)].map((m) => m[1] ?? "");

describe("the case table itself", () => {
  it("still has every row it is supposed to have", () => {
    expect(CASES.length).toBe(EXPECTED_CASE_COUNT);
  });

  it("covers every kind the contract declares", () => {
    const kinds: IntakeKind[] = [
      "DRAWING",
      "SUBMITTAL",
      "RFI_RESPONSE",
      "COMPLIANCE_DOC",
      "EXECUTED_SUBCONTRACT",
      "PAY_APP",
      "LIEN_WAIVER",
      "CERTIFIED_PAYROLL",
      "PHOTO",
      "UNKNOWN",
    ];
    const covered = new Set(CASES.map((c) => c.kind));
    expect([...kinds].filter((k) => !covered.has(k))).toEqual([]);
  });
});

describe("classifyDocument", () => {
  for (const c of CASES) {
    const label = c.text ? `${c.file} (with text preview)` : c.file;
    it(`${label} -> ${c.kind} / ${c.confidence}`, () => {
      const got = run(c);
      expect({ kind: got.kind, confidence: got.confidence }).toEqual({
        kind: c.kind,
        confidence: c.confidence,
      });
      expect(got.jobHint).toBe(c.job ?? null);
      expect(got.revisionHint).toBe(c.rev ?? null);
      expect(got.reason.trim().length).toBeGreaterThan(0);
    });
  }
});

describe("the honesty properties", () => {
  it("never returns HIGH without naming concrete evidence in the reason", () => {
    const highs = CASES.map(run).filter((r) => r.confidence === "HIGH");
    // Non-vacuity: the property is meaningless over an empty set.
    expect(highs.length).toBeGreaterThanOrEqual(MIN_HIGH_CASES);
    for (const r of highs) {
      const fragments = quotedFragments(r.reason);
      expect(fragments.length, `no quoted evidence in: ${r.reason}`).toBeGreaterThanOrEqual(1);
      // A one-character "quote" would satisfy the letter of the rule and
      // none of its point.
      for (const f of fragments) {
        expect(f.length, `evidence fragment too short to mean anything: ${r.reason}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("only quotes fragments that are really in the filename, mime type or text", () => {
    let seen = 0;
    for (const c of CASES) {
      const hay = haystack(c);
      for (const f of quotedFragments(run(c).reason)) {
        seen += 1;
        expect(hay, `claimed '${f}' but it is not in ${c.file}`).toContain(f.toLowerCase());
      }
    }
    expect(seen).toBeGreaterThanOrEqual(MIN_QUOTED_FRAGMENTS);
  });

  it("never invents a job hint", () => {
    let seen = 0;
    for (const c of CASES) {
      const hint = run(c).jobHint;
      if (hint === null) continue;
      seen += 1;
      expect(haystack(c), `invented job hint '${hint}' for ${c.file}`).toContain(hint.toLowerCase());
    }
    expect(seen).toBeGreaterThanOrEqual(MIN_JOB_HINTS);
  });

  it("never invents a revision hint — its number is always in the input", () => {
    let seen = 0;
    for (const c of CASES) {
      const hint = run(c).revisionHint;
      if (hint === null) continue;
      seen += 1;
      const digits = hint.replace(/\D+/g, "");
      expect(digits.length, `revision hint with no number: ${hint}`).toBeGreaterThan(0);
      const hay = haystack(c).replace(/\s+/g, "");
      expect(hay, `invented revision hint '${hint}' for ${c.file}`).toContain(digits);
    }
    expect(seen).toBeGreaterThanOrEqual(MIN_REVISION_HINTS);
  });

  it("writes reasons in the contractor's words, never about itself", () => {
    const banned = [
      /\bAI\b/,
      /\bartificial intelligence\b/i,
      /\bconfidence\b/i,
      /\bdetermined\b/i,
      /\bclassifi(?:er|cation|ed)\b/i,
      /\bmodel\b/i,
      /\bheuristic\b/i,
      /\bscore[ds]?\b/i,
      /\bprobability\b/i,
      /\bmatched? (?:pattern|rule)\b/i,
    ];
    for (const c of CASES) {
      const reason = run(c).reason;
      for (const re of banned) {
        expect(re.test(reason), `reason talks about itself: ${reason}`).toBe(false);
      }
      // A sentence, not a token dump.
      expect(reason.endsWith(".")).toBe(true);
    }
  });
});

/**
 * A second corpus the table does not control, so the properties above are
 * exercised on inputs nobody hand-picked to pass. Deterministic — no
 * randomness, so a failure here is reproducible from the same names.
 */
const STEMS = ["scan", "doc", "final", "image", "copy", "new", "photo", "file", "stuff", "sheet", "report", "notes"];
const SUFFIXES = ["", "_0001", " (2)", " v3"];
const TYPES: Array<[string, string]> = [
  [".pdf", PDF],
  [".jpg", JPEG],
  [".docx", DOCX],
];
const GENERATED: Case[] = STEMS.flatMap((stem) =>
  SUFFIXES.flatMap((suffix) =>
    TYPES.map(([ext, mime]): Case => ({
      file: `${stem}${suffix}${ext}`,
      mime,
      kind: "UNKNOWN",
      confidence: "LOW",
    })),
  ),
);
const EXPECTED_GENERATED_COUNT = 144; // 12 stems x 4 suffixes x 3 types
/** Most of these say nothing; if they ever all classify, the corpus stopped
 *  being adversarial and this file stopped testing restraint. */
const MIN_GENERATED_UNKNOWN = 40;

describe("the adversarial corpus", () => {
  it("is the size it says it is", () => {
    expect(GENERATED.length).toBe(EXPECTED_GENERATED_COUNT);
  });

  it("mostly refuses to guess, and says so with LOW confidence", () => {
    const unknown = GENERATED.map(run).filter((r) => r.kind === "UNKNOWN");
    expect(unknown.length).toBeGreaterThanOrEqual(MIN_GENERATED_UNKNOWN);
    for (const r of unknown) expect(r.confidence).toBe("LOW");
  });

  it("holds the honesty properties on names nobody chose", () => {
    for (const c of GENERATED) {
      const r = run(c);
      const hay = haystack(c);
      const fragments = quotedFragments(r.reason);
      if (r.confidence === "HIGH") {
        expect(fragments.length, `HIGH with no evidence: ${c.file} -> ${r.reason}`).toBeGreaterThanOrEqual(1);
      }
      for (const f of fragments) {
        expect(hay, `claimed '${f}' but it is not in ${c.file}`).toContain(f.toLowerCase());
      }
      expect(r.jobHint === null || hay.includes(r.jobHint.toLowerCase())).toBe(true);
    }
  });
});

describe("the reasons a person actually reads", () => {
  it("names the evidence for the flagship case, in plain words", () => {
    const r = classifyDocument({
      filename: "Riverside COI 2027.pdf",
      mimeType: PDF,
      sizeBytes: 120_000,
    });
    expect(r.reason).toBe("Filename contains 'COI' and '2027'.");
  });

  it("says plainly that it does not know, and asks", () => {
    const r = classifyDocument({ filename: "scan_0042.pdf", mimeType: PDF, sizeBytes: 90_000 });
    expect(r.kind).toBe("UNKNOWN");
    expect(r.confidence).toBe("LOW");
    expect(r.reason.toLowerCase()).toContain("please pick");
    expect(quotedFragments(r.reason)).toEqual([]);
  });

  it("names BOTH readings when a filename points two ways", () => {
    const r = classifyDocument({ filename: "bond breaker submittal.pdf", mimeType: PDF, sizeBytes: 90_000 });
    expect(r.confidence).toBe("MEDIUM");
    expect(r.reason).toContain("'submittal'");
    expect(r.reason).toContain("'bond'");
    expect(r.reason.toLowerCase()).toContain("please confirm");
  });

  it("treats a missing text preview the same as null", () => {
    const withUndefined = classifyDocument({ filename: "G702 Sept.pdf", mimeType: PDF, sizeBytes: 10 });
    const withNull = classifyDocument({
      filename: "G702 Sept.pdf",
      mimeType: PDF,
      sizeBytes: 10,
      textPreview: null,
    });
    expect(withUndefined).toEqual(withNull);
    expect(withUndefined.kind).toBe("PAY_APP");
  });

  it("does not fall over on an empty filename", () => {
    const r = classifyDocument({ filename: "", mimeType: "", sizeBytes: 0 });
    expect(r.kind).toBe("UNKNOWN");
    expect(r.confidence).toBe("LOW");
    expect(r.jobHint).toBeNull();
    expect(r.revisionHint).toBeNull();
  });

  // -------------------------------------------------------------------
  // Five defects an independent review reproduced on 2026-09-13. Each one
  // is here because the module's own stated rules forbid it, and each was
  // live before these tests existed.
  // -------------------------------------------------------------------
  describe("review findings, pinned", () => {
    it("never claims HIGH on the mime type alone — every image shares it", () => {
      const r = classifyDocument({ filename: "attachment.jpg", mimeType: "image/jpeg", sizeBytes: 90_000 });
      expect(r.kind).toBe("PHOTO");
      expect(r.confidence).not.toBe("HIGH");
      expect(r.reason.toLowerCase()).toContain("confirm");
    });

    it("still claims HIGH when the NAME says camera, not merely image", () => {
      for (const name of ["IMG_8831.jpeg", "PXL_20260906_181233.jpg", "level 2 ceiling grid.heic"]) {
        const r = classifyDocument({ filename: name, mimeType: "image/jpeg", sizeBytes: 90_000 });
        expect(r.kind, name).toBe("PHOTO");
        expect(r.confidence, name).toBe("HIGH");
      }
    });

    it("reads no job name out of a BLANK form field", () => {
      const r = classifyDocument({
        filename: "scan_0091.pdf",
        mimeType: "application/pdf",
        sizeBytes: 40_000,
        textPreview: "U.S. Department of Labor  Payroll  Form WH-347\nProject: ______________________\n",
      });
      expect(r.kind).toBe("CERTIFIED_PAYROLL");
      expect(r.jobHint).toBeNull();
    });

    it("does not hang an RFI number read from prose onto a document that is not an RFI", () => {
      const r = classifyDocument({
        filename: "A-201 Rev4.pdf",
        mimeType: "application/pdf",
        sizeBytes: 400_000,
        textPreview: "Issued in response to Request for Information No. 42 from the architect.",
      });
      // The kind is genuinely ambiguous here and the module says so rather
      // than picking: MEDIUM, with BOTH readings named in the reason. That
      // is the designed behaviour, not a defect.
      expect(r.confidence).toBe("MEDIUM");
      expect(r.reason).toContain("A-201");
      expect(r.reason.toLowerCase()).toContain("please confirm");
      // The defect: the marker must be the document's OWN revision, off its
      // own filename — never the RFI number lifted out of somebody's prose.
      expect(r.revisionHint).toBe("Rev 4");
    });

    it("matches the possessive spelling of a contractor's licence", () => {
      const r = classifyDocument({
        filename: "Nevada contractor's license C-4.pdf",
        mimeType: "application/pdf",
        sizeBytes: 30_000,
      });
      expect(r.kind).toBe("COMPLIANCE_DOC");
      expect(r.confidence).toBe("HIGH");
    });

    it("does not offer a document word as a job name", () => {
      for (const name of ["Invoice IN-2026 Riverside.pdf", "Paying appliance invoice.pdf"]) {
        const r = classifyDocument({ filename: name, mimeType: "application/pdf", sizeBytes: 20_000 });
        expect(r.jobHint, name).not.toBe("Invoice");
        expect(r.jobHint, name).not.toBe("Paying");
      }
    });
  });
});

describe("a jurisdiction is not a job", () => {
  /* Found by RUNNING the classifier over the demo folder rather than by
     reading it. This app is explicitly multi-state, so licences, wage
     determinations and certified payroll all carry a state in the
     filename — a whole class of paperwork proposing a job nobody has. */
  it("does not read a state on a licence as a job", () => {
    expect(
      classifyDocument({
        filename: "Nevada contractor's license C-4.pdf",
        mimeType: "application/pdf",
        sizeBytes: 90_000,
      }).jobHint,
    ).toBeNull();
  });

  it("still reads a job that merely starts with a state", () => {
    // The reason states are NOT in NOT_A_JOB, which breaks the scan: doing
    // it that way would throw this hint away entirely.
    //
    // The honest limit, stated because it is real: the scan already drops
    // tokens under four letters, so "Nevada Gym" reduces to "Nevada" and is
    // then rejected as a bare state. A job named after a state plus a SHORT
    // word loses its hint. Accepted deliberately — state-prefixed licences,
    // wage determinations and payroll are systematic in a multi-state app,
    // and a job named "Nevada Gym" is not.
    expect(
      classifyDocument({
        filename: "Nevada Ridge Elementary COI.pdf",
        mimeType: "application/pdf",
        sizeBytes: 90_000,
      }).jobHint,
    ).toBe("Nevada Ridge Elementary");
  });

  it("still reads an ordinary job name, so the guard has not eaten everything", () => {
    expect(
      classifyDocument({
        filename: "Riverside COI 2027.pdf",
        mimeType: "application/pdf",
        sizeBytes: 90_000,
      }).jobHint,
    ).toBe("Riverside");
  });
});
