import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The preview writes nothing. The only write in this component is
 * `importPayrollRegister`, and it must be reachable from `confirm()`
 * alone — the button labelled Confirm — never from typing, pasting,
 * choosing a file, or touching the column-mapping dropdowns. Read from the
 * source rather than rendered, same reason MyCoiImport.test.ts gives:
 * happy-dom cannot run a Server Action, and what matters here is that no
 * second call site exists.
 */

const source = readFileSync(new URL("./PayrollRegisterImport.tsx", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("PayrollRegisterImport", () => {
  it("imports the action once and calls it exactly once", () => {
    const mentions = source.match(/\bimportPayrollRegister\b/g) ?? [];
    expect(mentions).toHaveLength(2);
    expect(source).toMatch(/import \{ importPayrollRegister \} from "@\/lib\/actions";/);
  });

  it("makes that call inside confirm(), and confirm is only wired to a click", () => {
    const body = source.slice(source.indexOf("function confirm()"), source.indexOf("if (!open)"));
    expect(body).toContain("await importPayrollRegister(formData)");
    expect(source).toContain("onClick={confirm}");
    expect(source.match(/\{confirm\}/g)).toHaveLength(1);
  });

  it("the preview is computed by the pure planner, from props, not fetched", () => {
    expect(source).toContain("planPayrollRegisterImport(text, crew, existing, overrides)");
    expect(source).not.toMatch(/\bfetch\(/);
  });

  it("sends the same overrides the preview used, so confirm can never plan on stale state", () => {
    expect(source).toContain('formData.set("mapping", JSON.stringify(overrides))');
  });
});
