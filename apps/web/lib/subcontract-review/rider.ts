import type { ReviewedFinding } from "./findings";

/**
 * THE RIDER DRAFT — assembled by code, never by the model, from two things the
 * person already decided: the job's own proposal clauses (exclusions and
 * clarifications they bid on) and the findings they marked NEGOTIATED, in
 * their own edited words where they edited them. Nothing here invents a term.
 *
 * It is a STARTING POINT: the person edits the whole text before anything is
 * filed, and attaching it is a separate press (`attachSubcontractRider`).
 *
 * The body is plain text so it survives every surface it is shown on — the
 * editor, the printed page and the PDF — the same way: one paragraph per line,
 * "## " for a heading, "- " for a list item.
 */

export type RiderInputs = {
  jobName: string;
  gcName: string;
  companyName: string;
  versionNumber: number | null;
  clauses: { id: string; kind: string; text: string }[];
  negotiated: ReviewedFinding[];
};

export type RiderDraft = { title: string; body: string; sourceKeys: string[] };

export function buildRiderDraft(input: RiderInputs): RiderDraft {
  const lines: string[] = [];
  const sourceKeys: string[] = [];
  const of = input.versionNumber ? `, version ${input.versionNumber}` : "";

  lines.push(
    `This Rider forms part of the Subcontract between ${input.gcName} ("Contractor") and ${input.companyName} ` +
      `("Subcontractor") for ${input.jobName}${of}. Where this Rider and the Subcontract conflict, this Rider governs.`,
  );

  const section = (heading: string, items: { text: string; key: string }[]) => {
    if (items.length === 0) return;
    lines.push("", `## ${heading}`);
    for (const item of items) {
      lines.push(`- ${item.text.replace(/\s+/g, " ").trim()}`);
      sourceKeys.push(item.key);
    }
  };

  section(
    "Exclusions",
    input.clauses.filter((c) => c.kind === "EXCLUSION").map((c) => ({ text: c.text, key: `clause:${c.id}` })),
  );
  section(
    "Clarifications",
    input.clauses.filter((c) => c.kind === "CLARIFICATION").map((c) => ({ text: c.text, key: `clause:${c.id}` })),
  );
  section(
    "Negotiated terms",
    input.negotiated
      .filter((f) => f.status === "NEGOTIATED")
      .sort((a, b) => a.pageStart - b.pageStart)
      .map((f) => ({
        text: `${f.sectionRef ? `Section ${f.sectionRef.replace(/^§\s*/, "")}` : f.title}: ${f.effectivePosition}`,
        key: `finding:${f.key}`,
      })),
  );

  lines.push("", "Accepted and agreed:", "", "Contractor: ______________________   Date: __________", "", "Subcontractor: ___________________   Date: __________");

  return { title: `Rider to Subcontract — ${input.jobName}`, body: lines.join("\n"), sourceKeys };
}

export type RiderBlock = { kind: "heading" | "item" | "paragraph" | "blank"; text: string };

/** The body as blocks, for the printed page and the PDF to render alike. */
export function riderBlocks(body: string): RiderBlock[] {
  return body.split("\n").map((raw) => {
    const line = raw.trimEnd();
    if (line.trim() === "") return { kind: "blank", text: "" };
    if (line.startsWith("## ")) return { kind: "heading", text: line.slice(3).trim() };
    if (line.startsWith("- ")) return { kind: "item", text: line.slice(2).trim() };
    return { kind: "paragraph", text: line.trim() };
  });
}

/** Long enough for a real rider; a paste of the whole contract is refused. */
export const MAX_RIDER_LENGTH = 40_000;
