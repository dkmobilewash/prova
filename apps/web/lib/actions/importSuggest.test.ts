import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Suggest the skipped columns" — the model layer of the import mapper.
 *
 * NO LIVE MODEL CALL: `suggestImportColumns` is a mock. What is pinned:
 * the AI switch off means no model call AND no allowance claimed; a
 * non-owner is refused before either; the browser cannot send more than five
 * rows or unmasked digits; a failed call marks its claim; and nothing is
 * written anywhere — this module never touches the database except through
 * the allowance and usage ledgers, which are mocked here.
 */

const state = vi.hoisted(() => ({ role: "OWNER", gate: { ok: true } as Record<string, unknown> }));
const suggestImportColumns = vi.fn<(params: unknown) => Promise<Record<number, string>>>(async () => ({ 3: "status" }));
const claimAskAllowance = vi.fn(async () => ({ ok: true, claim: { id: "claim" }, left: { questions: 9, pages: 0 } }));
const markAskAllowanceFailure = vi.fn(async () => {});
const recordAskUsage = vi.fn(async () => {});
const aiGate = vi.fn(async () => state.gate);

vi.mock("@prova/integrations", () => ({
  suggestImportColumns: (params: unknown) => suggestImportColumns(params),
}));
vi.mock("@/lib/ai/settings", () => ({ aiGate: (...args: unknown[]) => aiGate(...(args as [])) }));
vi.mock("@/lib/ask/allowance", () => ({
  claimAskAllowance: (...args: unknown[]) => claimAskAllowance(...(args as [])),
  markAskAllowanceFailure: (...args: unknown[]) => markAskAllowanceFailure(...(args as [])),
}));
vi.mock("@/lib/ask/usage", () => ({ recordAskUsage: (...args: unknown[]) => recordAskUsage(...(args as [])) }));
vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => ({ id: "user_1", role: state.role, company: { id: "co_A" } }),
}));
// Any database write from this module would land here and fail the test.
vi.mock("@prova/db", () => ({ prisma: new Proxy({}, { get: () => { throw new Error("no database access expected"); } }) }));

const { suggestImportColumnFields } = await import("./importSuggest");

const INPUT = {
  kind: "jobs",
  columns: [{ index: 3, header: "Stage", values: ["Bid 2026", "Won", "a", "b", "c", "d", "e"] }],
};

beforeEach(() => {
  state.role = "OWNER";
  state.gate = { ok: true, model: "claude-opus-5" };
  for (const fn of [suggestImportColumns, claimAskAllowance, markAskAllowanceFailure, recordAskUsage, aiGate]) fn.mockClear();
});

describe("suggestImportColumnFields", () => {
  it("SKIPS THE MODEL when the company's AI switch is off — no call, nothing claimed", async () => {
    state.gate = { ok: false, error: "AI is switched off for your company." };
    const out = await suggestImportColumnFields(INPUT);
    expect(out).toEqual({ ok: false, error: "AI is switched off for your company." });
    expect(aiGate).toHaveBeenCalledWith("co_A", "ASK");
    expect(suggestImportColumns).not.toHaveBeenCalled();
    expect(claimAskAllowance).not.toHaveBeenCalled();
  });

  it("refuses a non-owner before the gate, the allowance or the model", async () => {
    state.role = "MEMBER";
    const out = await suggestImportColumnFields(INPUT);
    expect(out.ok).toBe(false);
    expect(aiGate).not.toHaveBeenCalled();
    expect(suggestImportColumns).not.toHaveBeenCalled();
  });

  it("stops at an exhausted allowance without calling the model", async () => {
    claimAskAllowance.mockResolvedValueOnce({ ok: false, error: "out of questions" } as never);
    const out = await suggestImportColumnFields(INPUT);
    expect(out).toEqual({ ok: false, error: "out of questions" });
    expect(suggestImportColumns).not.toHaveBeenCalled();
  });

  it("sends at most 5 rows, digits masked, and returns the model's proposals", async () => {
    const out = await suggestImportColumnFields(INPUT);
    expect(out).toEqual({ ok: true, value: { matches: { 3: "status" } } });
    const sent = suggestImportColumns.mock.calls[0][0] as { columns: { samples: string[] }[]; model: string };
    expect(sent.columns[0].samples).toEqual(["Bid ####", "Won", "a", "b", "c"]);
    expect(sent.model).toBe("claude-opus-5");
    expect(claimAskAllowance).toHaveBeenCalledWith("co_A", { questions: 1, pages: 0 });
  });

  it("marks the claim, never releases it, when the model call fails", async () => {
    suggestImportColumns.mockRejectedValueOnce(new Error("boom"));
    const out = await suggestImportColumnFields(INPUT);
    expect(out.ok).toBe(false);
    expect(markAskAllowanceFailure).toHaveBeenCalledWith({ id: "claim" });
  });

  it("refuses an unknown kind and asks nothing when there is nothing to ask", async () => {
    expect((await suggestImportColumnFields({ kind: "invoices", columns: INPUT.columns })).ok).toBe(false);
    expect(await suggestImportColumnFields({ kind: "jobs", columns: [] })).toEqual({ ok: true, value: { matches: {} } });
    expect(aiGate).not.toHaveBeenCalled();
  });
});
