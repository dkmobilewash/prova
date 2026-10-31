// Turning read requirements into register rows. Pure. A draft takes no number,
// and these only say what a row will read once a person accepts it.

import type { SubmittalRequirementKind } from "@prova/integrations/src/submittalRequirements";

export const SUBMITTAL_KIND_LABEL: Record<SubmittalRequirementKind, string> = {
  PRODUCT_DATA: "Product data",
  SHOP_DRAWINGS: "Shop drawings",
  SAMPLES: "Samples",
  CERTIFICATES: "Certificates",
  OTHER: "Other",
};

export type ProposalForRow = {
  sectionNumber: string;
  kind: SubmittalRequirementKind;
  requirement: string;
  quote: string;
  sourcePageLabel: string | null;
};

const TITLE_MAX = 120;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function source(row: ProposalForRow): string {
  return `Section ${row.sectionNumber}${row.sourcePageLabel ? `, ${row.sourcePageLabel}` : ""}: "${row.quote}"`;
}

/** One register row per requirement, the default Diego approved. */
export function submittalFromProposal(row: ProposalForRow) {
  return {
    title: clip(`${SUBMITTAL_KIND_LABEL[row.kind]}: ${row.requirement}`, TITLE_MAX),
    description: source(row),
    specSection: row.sectionNumber,
  };
}

/** Several requirements as one register row, when a person ticks merge. Refused
 * across sections, because a submittal names one spec section. */
export function mergedSubmittal(rows: readonly ProposalForRow[]) {
  const sections = new Set(rows.map((row) => row.sectionNumber));
  if (rows.length < 2 || sections.size !== 1) return null;
  return {
    title: clip(`Section ${rows[0].sectionNumber}: ${rows.map((row) => SUBMITTAL_KIND_LABEL[row.kind]).join(", ")}`, TITLE_MAX),
    description: rows.map((row) => `${SUBMITTAL_KIND_LABEL[row.kind]}: ${row.requirement}. ${source(row)}`).join("\n"),
    specSection: rows[0].sectionNumber,
  };
}

const key = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

/** What a re-read adds: anything a person already accepted or dismissed for
 * this section is not asked again. */
export function newRequirements<T extends { requirement: string; quote: string }>(
  read: readonly T[],
  decided: readonly { requirement: string; quote: string }[],
): T[] {
  const seen = new Set(decided.map((row) => `${key(row.requirement)}|${key(row.quote)}`));
  return read.filter((row) => !seen.has(`${key(row.requirement)}|${key(row.quote)}`));
}
