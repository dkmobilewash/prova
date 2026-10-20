import type { ReviewedFinding } from "./findings";

/**
 * INSURANCE ASKS — proposed from an INSURANCE finding, confirmed by a person,
 * stored cleanly for the COI work to match against later. Pure. Nothing reads
 * the confirmed rows yet, by design (no broker workflow in this phase).
 *
 * Coverage and endorsements are read by code from the quote's own words; the
 * limits and the completed-operations term come from figures already verified
 * to be in that quote. Every field is editable before Confirm.
 */

export const COVERAGES = [
  "GENERAL_LIABILITY",
  "WORKERS_COMP",
  "AUTO",
  "UMBRELLA_EXCESS",
  "PROFESSIONAL",
  "POLLUTION",
  "BUILDERS_RISK",
  "OTHER",
] as const;
export type Coverage = (typeof COVERAGES)[number];

export const COVERAGE_LABEL: Record<Coverage, string> = {
  GENERAL_LIABILITY: "General liability",
  WORKERS_COMP: "Workers' compensation",
  AUTO: "Auto liability",
  UMBRELLA_EXCESS: "Umbrella / excess",
  PROFESSIONAL: "Professional liability",
  POLLUTION: "Pollution liability",
  BUILDERS_RISK: "Builder's risk",
  OTHER: "Other",
};

export const ENDORSEMENTS = ["ADDITIONAL_INSURED", "PRIMARY_NONCONTRIBUTORY", "WAIVER_OF_SUBROGATION"] as const;
export type Endorsement = (typeof ENDORSEMENTS)[number];

export const ENDORSEMENT_LABEL: Record<Endorsement, string> = {
  ADDITIONAL_INSURED: "Additional insured",
  PRIMARY_NONCONTRIBUTORY: "Primary and non-contributory",
  WAIVER_OF_SUBROGATION: "Waiver of subrogation",
};

/** Most specific first: "umbrella" before "liability", "workers" before anything. */
const COVERAGE_WORDS: [Coverage, RegExp][] = [
  ["WORKERS_COMP", /workers['’]?\s*comp/i],
  ["UMBRELLA_EXCESS", /\bumbrella\b|\bexcess\s+liability\b/i],
  ["AUTO", /\bauto(?:mobile)?\s+liability\b|\bbusiness\s+auto\b/i],
  ["PROFESSIONAL", /\bprofessional\s+liability\b|\berrors\s+and\s+omissions\b/i],
  ["POLLUTION", /\bpollution\b/i],
  ["BUILDERS_RISK", /\bbuilder['’]?s\s+risk\b/i],
  ["GENERAL_LIABILITY", /\bgeneral\s+liability\b|\bCGL\b/i],
];

const ENDORSEMENT_WORDS: [Endorsement, RegExp][] = [
  ["ADDITIONAL_INSURED", /\badditional\s+insureds?\b/i],
  ["PRIMARY_NONCONTRIBUTORY", /\bprimary\s+and\s+non-?\s*contributory\b/i],
  ["WAIVER_OF_SUBROGATION", /\bwaiver\s+of\s+subrogation\b/i],
];

export type InsuranceProposal = {
  coverage: Coverage;
  limitPerOccurrence: number | null;
  limitAggregate: number | null;
  endorsements: Endorsement[];
  completedOpsYears: number | null;
};

export function proposeInsurance(finding: ReviewedFinding): InsuranceProposal | null {
  if (finding.category !== "INSURANCE") return null;
  const terms = (finding.terms ?? {}) as Record<string, unknown>;
  const num = (key: string) => (typeof terms[key] === "number" ? (terms[key] as number) : null);
  const coverage = COVERAGE_WORDS.find(([, pattern]) => pattern.test(finding.quote))?.[0] ?? "OTHER";
  return {
    coverage,
    limitPerOccurrence: num("limitPerOccurrence"),
    limitAggregate: num("limitAggregate"),
    endorsements: ENDORSEMENT_WORDS.filter(([, pattern]) => pattern.test(finding.quote)).map(([e]) => e),
    completedOpsYears: num("completedOpsYears"),
  };
}
