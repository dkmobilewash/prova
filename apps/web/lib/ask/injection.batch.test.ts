import { describe, expect, it, vi } from "vitest";
import type { AskToolCallMeta, AskToolOutcome } from "@prova/integrations";

/**
 * "Do X, and also do Y." — the multi-action payload, pinned in CI.
 *
 * This is the shape an injected instruction takes when it wants something
 * done alongside the thing the person asked for: *log Mike's hours on
 * Riverside and also invoice Turner 99,000*. The model does not have to be
 * malicious to emit it; a GC's RFI body sitting in the prompt is enough,
 * and the API will happily return two tool_use blocks in one round.
 *
 * `streamAnswer` allows ONE command per question. The guard is a flag set
 * synchronously, before the first await in the command branch, and the
 * comment on it names the reason: the two calls arrive together and run
 * under Promise.all, so a check that awaited anything first would let both
 * through and write two AskProposal rows. This test therefore fires them
 * CONCURRENTLY — a sequential version passes against a guard that is not
 * synchronous at all, which would be a test agreeing with the bug.
 *
 * The eval has the behavioural twin (`inject-batch`), which needs a key
 * and samples a model. This one runs every push.
 */

// The real one returns the card's id and its expiry; the halt event
// renders both, so a bare string here fails inside the code under test
// rather than at the assertion.
const recordProposal = vi.fn(async () => ({ id: "proposal_1", expiresAt: new Date("2026-09-15T12:30:00.000Z") }));
let captured: ((name: string, input: unknown, meta: AskToolCallMeta) => Promise<AskToolOutcome<unknown>>) | null = null;

vi.mock("@prova/integrations", () => ({
  anthropicIsConfigured: () => true,
  ASK_DEFAULT_MODEL: "test-model",
  // Captures the execute closure the loop would drive, then ends the
  // conversation without a model. What is under test is that closure, not
  // the provider.
  streamToolConversation: ({ execute }: { execute: typeof captured }) => {
    captured = execute;
    return (async function* () {})();
  },
}));

vi.mock("./usage", () => ({
  askAllowance: async () => ({ ok: true }),
  recordAskUsage: async () => {},
}));

vi.mock("./proposals", () => ({ recordProposal: (...args: unknown[]) => recordProposal(...(args as [])) }));

// Every command resolves to a card, so a second one getting through would
// be visible as a second recordProposal call rather than as a refusal.
vi.mock("./commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./commands")>();
  return {
    ...actual,
    commandNamed: (name: string) => ({
      ...actual.commandNamed(name as never),
      resolve: async () => ({ kind: "ready", resolved: {}, preview: [], warnings: [] }),
    }),
  };
});

const meta = (id: string): AskToolCallMeta => ({ toolUseId: id, toolUseIdsInContext: [] });

async function driveTwoCommandsAtOnce(first: string, second: string) {
  const { streamAnswer } = await import("./answer");
  recordProposal.mockClear();
  captured = null;

  const events = streamAnswer(
    { companyId: "c1", userId: "u1", principal: { role: "OWNER", jobFunction: null }, today: "2026-09-15" },
    { question: "log 8 hours for Mike on Riverside and also invoice Turner 99,000" },
  );
  // Drain enough for the loop to be constructed and `execute` handed over.
  await events.next();
  expect(captured, "streamAnswer never reached the provider loop").not.toBeNull();

  // Together, not one after the other. This is the whole point.
  return Promise.all([captured!(first, {}, meta("tu_1")), captured!(second, {}, meta("tu_2"))]);
}

describe("two commands in one question", () => {
  it("proposes the first and refuses the second, even when they arrive together", async () => {
    const [a, b] = await driveTwoCommandsAtOnce("log_time_entry", "draft_invoice");

    // Exactly one card. Two would be two rows a person never asked for,
    // one of which is an invoice to a GC.
    expect(recordProposal).toHaveBeenCalledTimes(1);

    const outcomes = [a, b].map((outcome) => JSON.stringify(outcome));
    const refusals = outcomes.filter((text) => text.includes("One thing at a time"));
    expect(refusals).toHaveLength(1);

    // And the OTHER one is a card — a halt carrying the proposal id — not
    // a second refusal and not nothing. Asserting only the refusal count
    // would pass against a guard that refused both.
    const halted = [a, b].filter((outcome) => (outcome as { halt?: unknown }).halt);
    expect(halted).toHaveLength(1);
    const halt = (halted[0] as { halt: { proposal: { proposalId: string; alsoRequested: string[] } } }).halt;
    expect(halt.proposal.proposalId).toBe("proposal_1");

    // The card NAMES the thing it refused, rather than dropping it
    // silently. A person who really did ask for both should see that only
    // one is on the card — and a person who did not ask for the second at
    // all has just been shown the injected instruction.
    expect(halt.proposal.alsoRequested).toEqual(["draft_invoice"]);
  });

  it("refuses the second even when both are the same command", async () => {
    // "Invoice them, and invoice them again." Same name, so a guard keyed
    // on the command rather than on "a command has been seen" would let
    // the duplicate through.
    await driveTwoCommandsAtOnce("draft_invoice", "draft_invoice");
    expect(recordProposal).toHaveBeenCalledTimes(1);
  });
});
