import { describe, expect, it, vi } from "vitest";
import { titleBlockWork, type ProposalRow, type TitleBlockDeps } from "./titleBlock";
import type { ClaimedTask } from "./runner";
import type { StageCtx } from "./stages";

/**
 * `TITLE_BLOCK`, WITH NO DATABASE, NO MODEL AND NO MONEY SPENT.
 *
 * Every port is injected, so what these tests actually check is the ORDER of the
 * four things this stage does before it calls a model — because the order is where
 * the money is. A gate checked after a claim charges a company that has switched
 * the feature off; a claim taken after the call charges nothing for a call that
 * already happened; a failure that releases its claim makes the cap defeatable by
 * inducing failures. None of those is visible in a happy-path test, so each has one
 * of its own below.
 */

const CTX: StageCtx = {
  planId: "plan_1",
  companyId: "co_1",
  ingestJobId: "job_1",
  jobId: "cjob_1",
  startedByUserId: "user_1",
};

function task(pageNumber = 1): ClaimedTask {
  return { id: `t${pageNumber}`, pageNumber, stage: "TITLE_BLOCK", attempts: 1 };
}

const READ = {
  sheetNumber: "A-101",
  title: "FIRST FLOOR PLAN",
  discipline: "ARCHITECTURAL",
  scale: '1/4" = 1\'-0"',
  revision: "REV 2",
  issueDate: "2026-03-04",
  reason: "Sheet number and title on the last two lines of the block.",
  confidence: "HIGH" as const,
};

function deps(over: Partial<TitleBlockDeps> = {}) {
  const saved: ProposalRow[] = [];
  const base: TitleBlockDeps = {
    loadSheetText: async () => ({
      id: "text_1",
      hasTextLayer: true,
      titleBlockText: "ZZ SYNTHETIC ARCHITECTS\nFIRST FLOOR PLAN\nA-101",
      wholePageFallback: false,
    }),
    gate: vi.fn(async () => ({ ok: true as const, settings: { planSheetsPerMonth: 1500 }, model: "claude-haiku-4-5" })),
    claim: vi.fn(async () => ({ ok: true as const, claim: { companyId: "co_1", periodStart: new Date(0) }, sheetsLeft: 1_499 })),
    markFailure: vi.fn(async () => {}),
    // THE FAKE REPORTS USAGE, because the real one does: `extractSheetTitleBlock`
    // calls `reportUsage(params.onUsage, …)` before it even checks whether the
    // response was usable. A fake that skipped that would make the usage
    // assertions below unreachable — which is exactly what happened on the first
    // run of this file, and is worth keeping in view: the metering is a
    // COLLABORATION between the stage and the extractor, so a stage test can only
    // prove the stage's half.
    extract: vi.fn(async (params: { onUsage?: (u: unknown) => Promise<void> }) => {
      await params.onUsage?.({
        passes: 1,
        inputTokens: 900,
        outputTokens: 120,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
      return READ;
    }),
    // Annotated because the cast below stops TypeScript inferring it from the
    // target type — the cast is there only so `gate` can return the two fields
    // this stage reads instead of a whole `AiPass`.
    saveProposal: async (row: ProposalRow) => {
      saved.push(row);
    },
    recordUsage: vi.fn(async () => {}),
  } as unknown as TitleBlockDeps;
  const merged = { ...base, ...over } as TitleBlockDeps;
  return { deps: merged, saved, base: merged };
}

describe("reading one sheet's title block", () => {
  it("writes the proposal, the model and the prompt version", async () => {
    const d = deps();
    expect(await titleBlockWork(CTX, d.deps)(task(7))).toEqual({ ok: true });

    const row = d.saved[0]!;
    expect(row.pageNumber).toBe(7);
    expect(row.ingestJobId).toBe("job_1");
    expect(row.sheetTextId).toBe("text_1");
    expect(row.read.sheetNumber).toBe("A-101");
    // The model the GATE resolved, not a constant — a company's override has to
    // reach the row that records what produced it.
    expect(row.model).toBe("claude-haiku-4-5");
  });

  it("records the spend against the construction job and the prompt version", async () => {
    const d = deps();
    await titleBlockWork(CTX, d.deps)(task());
    expect(d.deps.recordUsage).toHaveBeenCalledTimes(1);
    const record = vi.mocked(d.deps.recordUsage).mock.calls[0]![0];
    expect(record.feature).toBe("plan-ingestion");
    expect(record.jobId).toBe("cjob_1");
    // THE FIRST WRITER `promptVersion` HAS EVER HAD. `docs/ai/DECISIONS.md` argues
    // a missing one is silent — rows accumulate with null and nothing breaks until
    // somebody tries to attribute a change to a prompt and cannot.
    expect(record.promptVersion).toBeTruthy();
    // Whoever started the run, so a set finished by the cron is attributed to them
    // rather than to whoever last had the tab open.
    expect(record.userId).toBe("user_1");
  });
});

describe("what it refuses, and what it spends doing so", () => {
  it("does nothing at all for a sheet with no text layer", async () => {
    const d = deps({ loadSheetText: async () => ({ id: "t", hasTextLayer: false, titleBlockText: null, wholePageFallback: false }) });
    expect(await titleBlockWork(CTX, d.deps)(task())).toEqual({ ok: true });
    // No claim, no call, no row — and SUCCESS, because a scan is a fact
    // `PAGE_INVENTORY` already recorded rather than a failure of this stage.
    expect(d.deps.claim).not.toHaveBeenCalled();
    expect(d.deps.extract).not.toHaveBeenCalled();
    expect(d.saved).toHaveLength(0);
  });

  it("tells somebody to run the text pass first, rather than retrying forever", async () => {
    const d = deps({ loadSheetText: async () => null });
    const out = await titleBlockWork(CTX, d.deps)(task());
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("unreachable");
    // Rendered beside a Retry button that cannot fix it, so the sentence names the
    // move that can.
    expect(out.error).toContain("hasn't been read yet");
    expect(d.deps.claim).not.toHaveBeenCalled();
  });

  it("CHECKS THE SWITCH BEFORE THE LEDGER, so a refusal costs nothing", async () => {
    const d = deps({
      gate: vi.fn(async () => ({ ok: false as const, error: "Reading plan sets is switched off for your company." })),
    } as unknown as Partial<TitleBlockDeps>);
    const out = await titleBlockWork(CTX, d.deps)(task());
    expect(out).toEqual({ ok: false, error: "Reading plan sets is switched off for your company." });
    // The order is the assertion. Claimed first, a company that had switched plan
    // reading off would be charged a sheet on the way to being told no — 300 of
    // them for a set somebody started by accident.
    expect(d.deps.claim).not.toHaveBeenCalled();
    expect(d.deps.extract).not.toHaveBeenCalled();
  });

  it("passes the allowance refusal through and calls no model", async () => {
    const d = deps({
      claim: vi.fn(async () => ({ ok: false as const, error: "That sheet wasn't read: your company has used 1500 of its 1500 plan sheets this month." })),
    } as unknown as Partial<TitleBlockDeps>);
    const out = await titleBlockWork(CTX, d.deps)(task());
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("unreachable");
    expect(out.error).toContain("1500 plan sheets");
    // Claimed BEFORE the call, so a refusal means the call never happened.
    expect(d.deps.extract).not.toHaveBeenCalled();
    expect(d.saved).toHaveLength(0);
  });

  it("MARKS a failed call rather than releasing it, and says the sheet was used", async () => {
    const d = deps({
      extract: vi.fn(async () => {
        throw new Error("upstream 529 at https://api.anthropic.com/v1/messages?key=sk-ant-secret");
      }),
    } as unknown as Partial<TitleBlockDeps>);
    const out = await titleBlockWork(CTX, d.deps)(task());
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("unreachable");

    // Marked, never released: the provider bills a call that produced nothing
    // usable, and releasing would let the cap be defeated by inducing failures.
    expect(d.deps.markFailure).toHaveBeenCalledTimes(1);
    // The person is TOLD it cost them, because it did.
    expect(out.error).toContain("used one of your monthly sheets");
    // AND THE THROWN TEXT NEVER REACHES THE SCREEN. This sentence is rendered in
    // the failure list; an SDK error can carry a request URL or a key fragment,
    // which is why `runner.ts` discards thrown messages too.
    expect(out.error).not.toContain("sk-ant");
    expect(out.error).not.toContain("api.anthropic.com");
    expect(d.saved).toHaveLength(0);
  });
});
