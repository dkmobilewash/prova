import { describe, expect, it } from "vitest";
import { readingLabel, toolLabel } from "./toolLabels";
import { TOOLS } from "./tools";

describe("tool labels", () => {
  it("labels every tool, so no status line falls back to a generic", () => {
    // The fallback exists for safety, not for use. A new tool without a
    // label would silently read "your records" forever.
    for (const tool of TOOLS) {
      expect(toolLabel(tool.name), `${tool.name} has no label`).not.toBe("your records");
    }
  });

  it("names no tool by its function name", () => {
    // "Checking crew_assignments…" is what happens if someone wires the
    // raw name through. It means nothing to a contractor.
    for (const tool of TOOLS) {
      expect(toolLabel(tool.name)).not.toContain("_");
    }
  });

  it("reads as a sentence for one, two and three tools", () => {
    expect(readingLabel(["receivables"])).toBe("Checking your invoices…");
    expect(readingLabel(["receivables", "open_rfis"])).toBe(
      "Checking your invoices and open RFIs…",
    );
    expect(readingLabel(["receivables", "open_rfis", "compliance_status"])).toBe(
      "Checking your invoices, open RFIs and certificates and licences…",
    );
  });

  it("does not repeat a label when the same tool runs twice", () => {
    expect(readingLabel(["receivables", "receivables"])).toBe("Checking your invoices…");
  });

  it("falls back rather than rendering an empty sentence", () => {
    expect(readingLabel([])).toBe("Reading your records…");
  });
});
