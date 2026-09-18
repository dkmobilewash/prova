import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The tap, for a card carrying web suggestions: the browser can take a
 * suggestion OFF the list, and that is all it can do. Whatever it sends,
 * `execute` receives the server-held list minus the unticked keys — never a
 * key the server did not hold, never a changed value.
 *
 * Also the upload gate for an attachment: intake's capability, the size
 * and type caps in a returned sentence, and a pathname inside this
 * company's intake folder.
 */
const OWNER = { key: "owner", label: "Owner", value: "City of Portland", sources: [{ title: "p", url: "https://portland.gov/x" }] };
const ARCH = { key: "architect", label: "Architect", value: "Hacker", sources: [{ title: "h", url: "https://hacker.example.com" }] };

const fake = vi.hoisted(() => ({
  context: { company: { id: "co-1" }, companyId: "co-1", id: "u-1", role: "OWNER", jobFunction: null as string | null },
  row: null as Record<string, unknown> | null,
  execute: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => fake.context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/viewerToday", () => ({ viewerToday: async () => "2026-09-18" }));
vi.mock("@prova/db", () => ({
  prisma: {
    askProposal: {
      findFirst: async () => fake.row,
      updateMany: async () => ({ count: 1 }),
      update: async () => ({}),
    },
  },
}));
vi.mock("@/lib/ask/commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ask/commands")>();
  return {
    ...actual,
    commandNamed: (name: string) => ({ ...actual.commandNamed(name as never), execute: fake.execute }),
  };
});

const { confirmAskProposal, prepareAskAttachment } = await import("./ask");

beforeEach(() => {
  fake.execute.mockReset();
  fake.execute.mockResolvedValue({ ok: true, message: "Created." });
  fake.context.role = "OWNER";
  fake.context.jobFunction = null;
  fake.row = {
    id: "p1",
    companyId: "co-1",
    createdByUserId: "u-1",
    command: "create_estimate_job",
    outcome: null,
    claimedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    resolved: { jobName: "Sellwood Clinic", webSuggestions: [OWNER, ARCH] },
  };
});

describe("confirming a card with web suggestions", () => {
  it("executes with every suggestion when none was unticked", async () => {
    await confirmAskProposal("p1");
    expect(fake.execute.mock.calls[0][1].webSuggestions).toEqual([OWNER, ARCH]);
  });

  it("executes without the ones the person unticked", async () => {
    await confirmAskProposal("p1", ["architect"]);
    expect(fake.execute.mock.calls[0][1].webSuggestions).toEqual([OWNER]);
  });

  it("cannot add anything: an unknown key drops nothing and invents nothing", async () => {
    await confirmAskProposal("p1", ["budget", "owner-2"]);
    expect(fake.execute.mock.calls[0][1].webSuggestions).toEqual([OWNER, ARCH]);
  });

  it("leaves a card with no suggestions exactly as it was", async () => {
    fake.row!.resolved = { jobName: "X" };
    await confirmAskProposal("p1", ["owner"]);
    expect(fake.execute.mock.calls[0][1]).toEqual({ jobName: "X" });
  });
});

describe("prepareAskAttachment", () => {
  it("returns a pathname in this company's intake folder, marked as an Ask file", async () => {
    const result = await prepareAskAttachment("Bid Set.pdf", "application/pdf", 2000);
    expect(result).toEqual({ ok: true, value: { pathname: "document-intake/co-1/ask-Bid-Set.pdf" } });
  });

  it("refuses an oversized file in a sentence", async () => {
    const result = await prepareAskAttachment("big.pdf", "application/pdf", 50 * 1024 * 1024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/up to 10\.0 MB/);
  });

  it("refuses a type the model cannot read", async () => {
    const result = await prepareAskAttachment("a.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 2000);
    expect(result.ok).toBe(false);
  });

  it("refuses a job function without document intake, as the intake page does", async () => {
    fake.context.role = "MEMBER";
    fake.context.jobFunction = "ACCOUNTING";
    const result = await prepareAskAttachment("a.pdf", "application/pdf", 2000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/document intake/);
  });
});
