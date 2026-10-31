import { afterAll, expect, it } from "vitest";
import { extractSubmittalRequirements, modelFor, SUBMITTAL_READ_PROMPT_VERSION, type SubmittalRequirementKind } from "@prova/integrations";
import { requireEvalApiKey } from "@/lib/ai/evalApiKey";
import { specSectionPdf } from "./specFixtures";
import { normaliseForQuoteMatch, whyNot } from "./quoteMatch";

/**
 * The submittal reader against synthetic sections. Needs a key and costs money,
 * so it does not run in the suite. Scored the way the spec eval is: an invented
 * row or a fabricated quote is fatal, because a person would add it to a
 * register; a missed row is reported, because they then read the section
 * themselves, which is what they do today. Synthetic and short, so this measures
 * judgement and says nothing about a real sixty-page section.
 */
requireEvalApiKey("submittal-read eval");

type Case = { id: string; lines: string[]; expectKinds: SubmittalRequirementKind[]; forbidden?: string[]; expectEmpty?: boolean };

const CASES: Case[] = [
  {
    id: "ordinary-article",
    expectKinds: ["PRODUCT_DATA", "SHOP_DRAWINGS", "SAMPLES", "CERTIFICATES"],
    lines: [
      "SECTION 09 22 16 - NON-STRUCTURAL METAL FRAMING",
      "PART 1 - GENERAL",
      "1.3 ACTION SUBMITTALS",
      "A. Product data for each type of framing member.",
      "B. Shop drawings for deflection details.",
      "C. Samples of each stud gauge, 12 inches long.",
      "1.4 INFORMATIONAL SUBMITTALS",
      "A. Fire test reports for each rated assembly.",
    ],
  },
  {
    id: "says-not-required",
    expectKinds: ["PRODUCT_DATA"],
    forbidden: ["accessor"],
    lines: [
      "SECTION 09 29 00 - GYPSUM BOARD",
      "1.3 SUBMITTALS",
      "A. Product data for each board type.",
      "B. Submittals are not required for accessories.",
    ],
  },
  {
    id: "work-is-not-a-submittal",
    expectKinds: [],
    forbidden: ["mock-up", "mockup", "installer"],
    lines: [
      "SECTION 09 22 16 - NON-STRUCTURAL METAL FRAMING",
      "1.2 QUALITY ASSURANCE",
      "A. Installer shall have five years' experience.",
      "B. Construct a field mock-up of one typical partition.",
    ],
  },
  {
    id: "another-trade",
    expectKinds: [],
    expectEmpty: true,
    lines: ["SECTION 26 05 19 - LOW-VOLTAGE ELECTRICAL CONDUCTORS", "1.3 SUBMITTALS", "A. Product data for each conductor."],
  },
];

const report: string[] = [];

for (const kase of CASES) {
  it(`reads ${kase.id}`, { timeout: 180_000 }, async () => {
    const out = await extractSubmittalRequirements({
      fileBase64: specSectionPdf(kase.lines).toString("base64"),
      mediaType: "application/pdf",
      fileName: `${kase.id}.pdf`,
    });
    const found = new Set(out.requirements.map((row) => row.kind));
    report.push(`${kase.id}: ${out.requirements.length} rows; missed ${kase.expectKinds.filter((k) => !found.has(k)).join(", ") || "none"}`);

    expect(out.requirements.flatMap((row) => (whyNot(row.quote, kase.lines) === null ? [] : [row.quote]))).toEqual([]);
    const forbidden = (kase.forbidden ?? []).map(normaliseForQuoteMatch);
    expect(out.requirements.filter((row) => forbidden.some((word) => normaliseForQuoteMatch(row.requirement).includes(word)))).toEqual([]);
    if (kase.expectEmpty) expect(out.requirements).toEqual([]);
  });
}

afterAll(() => {
  console.log(`submittal-read eval, ${modelFor("SUBMITTAL_READ").model}, ${SUBMITTAL_READ_PROMPT_VERSION}\n${report.join("\n")}`);
});
