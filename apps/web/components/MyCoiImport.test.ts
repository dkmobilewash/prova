import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The preview writes nothing. The only write in this component is
 * `importMyCoiExport`, and it must be reachable from `confirm()` alone —
 * the button labelled Confirm — never from typing, pasting or choosing a
 * file. Read from the source rather than rendered: happy-dom cannot run a
 * Server Action, and what matters is that no second call site exists.
 */

const source = readFileSync(new URL("./MyCoiImport.tsx", import.meta.url), "utf8")
  // Comments stripped first, so a comment naming the action cannot count.
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("MyCoiImport", () => {
  it("imports the action once and calls it exactly once", () => {
    const mentions = source.match(/\bimportMyCoiExport\b/g) ?? [];
    // One in the import line, one call. Anti-vacuity: both must be found.
    expect(mentions).toHaveLength(2);
    expect(source).toMatch(/import \{ importMyCoiExport \} from "@\/lib\/actions";/);
  });

  it("makes that call inside confirm(), and confirm is only wired to a click", () => {
    const body = source.slice(source.indexOf("function confirm()"), source.indexOf("if (!open)"));
    expect(body).toContain("await importMyCoiExport(formData)");
    expect(source).toContain("onClick={confirm}");
    // `function confirm` and `onClick={confirm}` — nothing else refers to it.
    expect(source.match(/\{confirm\}/g)).toHaveLength(1);
  });

  it("the preview is computed by the pure planner, from props, not fetched", () => {
    expect(source).toContain("planCoiImport(readCoiExport(text), existing, known)");
    expect(source).not.toMatch(/\bfetch\(/);
  });
});
