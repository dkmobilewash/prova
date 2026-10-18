import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ── THE ORDER THE GUARDS RUN IN, WHICH IS THE WHOLE SECURITY OF THIS ACTION ──
 *
 * `action-capability-guards.test.ts` already proves the capability refusal by
 * CALLING this action, and that is the stronger check. What it cannot see is
 * ORDER, and order is what matters for the two guards below: a switch checked
 * after the image has been sent has not switched anything off, and an
 * allowance claimed after the call has not limited anything.
 *
 * This is a source census, so it is weaker than running the thing, and it says
 * so. It exists because the failure it catches is invisible at runtime: every
 * test would pass, the feature would work, and a company that had turned it
 * off would have had a picture of their drawing sent anyway.
 */

const SOURCE = readFileSync(resolve(process.cwd(), "lib/actions/takeoffReadSheet.ts"), "utf8");
/** Comments FIRST. This file explains its own guards and quotes them doing it,
 *  so a raw-text census would read the prose as the code — the trap
 *  `openingDeduction.test.ts` and `clerkMountGate.test.ts` both record. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const at = (needle: string) => {
  const i = CODE.indexOf(needle);
  expect(i, `the census could not find ${needle} — the action has been rewritten`).toBeGreaterThan(-1);
  return i;
};

describe("reading a scanned sheet is guarded before anything is sent", () => {
  it("checks the capability first", () => {
    expect(at('can(context, "VIEW_JOB_COSTS")')).toBeLessThan(at('aiGate(company.id, "SHEET_TEXT")'));
  });

  it("CHECKS THE COMPANY'S AI SWITCH BEFORE THE MODEL IS REACHED", () => {
    // The one that matters most. This sends a PICTURE of the customer's
    // drawing, which is the thing a contractor is most likely to want to
    // refuse — so a gate after the send would be no gate at all.
    expect(at('aiGate(company.id, "SHEET_TEXT")')).toBeLessThan(at("readSheetTextTile("));
  });

  it("claims the allowance before the model is reached, and refunds it on failure", () => {
    expect(at("claimAskAllowance(")).toBeLessThan(at("readSheetTextTile("));
    // A thrown call must not leave the company billed for a tile it never got.
    expect(at("markAskAllowanceFailure(")).toBeGreaterThan(at("readSheetTextTile("));
  });

  it("spends the PAGE ledger, one page per tile", () => {
    // A sheet is nine tiles and nine requests. Billing it as one page would
    // under-report a scanned set by an order of magnitude — the reason
    // `sheet-text` is its own row in `AskUsageFeature`.
    expect(CODE).toMatch(/claimAskAllowance\(company\.id,\s*\{\s*questions:\s*0,\s*pages:\s*1\s*\}/);
  });

  it("returns a readable refusal and never throws one", () => {
    // Production redacts a thrown Server Action message to a digest, so a
    // refusal written as a throw reaches an estimator as a dead button.
    expect(CODE).not.toMatch(/\bthrow\s+new\b/);
    expect(CODE).toMatch(/ActionResultWith</);
  });

  it("names the prompt version from the constant rather than a copy", () => {
    // Two spellings of a version is how one of them stops being true.
    expect(CODE).toMatch(/promptVersion:\s*SHEET_TEXT_PROMPT_VERSION/);
    expect(CODE).not.toMatch(/promptVersion:\s*"/);
  });
});
