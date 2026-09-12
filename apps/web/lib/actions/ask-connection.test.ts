import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The connection check as a Server Action: owner-only in a returned
 * sentence (never a throw, since production redacts those), and the
 * API's answer translated rather than passed through.
 */
const fake = vi.hoisted(() => ({
  context: { company: { id: "co-1" }, id: "u-1", role: "OWNER", jobFunction: null as string | null },
  check: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => fake.context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@prova/integrations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@prova/integrations")>()),
  checkAnthropicConnection: fake.check,
}));

const { checkAssistantConnection } = await import("./ask");

beforeEach(() => {
  fake.check.mockReset();
  fake.context.role = "OWNER";
  fake.context.jobFunction = null;
});

describe("checkAssistantConnection", () => {
  it("refuses a member whose job function lacks the settings capability, before the owner rule", async () => {
    // FIELD holds MANAGE_FIELD and MANAGE_JOBS, not MANAGE_COMPLIANCE — the
    // capability /settings/assistant demands, which the action asserts for
    // itself because the endpoint answers whoever posts to it.
    fake.context.role = "MEMBER";
    fake.context.jobFunction = "FIELD";
    const result = await checkAssistantConnection();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/part of your job function/);
    expect(fake.check).not.toHaveBeenCalled();
  });

  it("refuses a non-owner who does hold the capability, in a sentence, and never calls Anthropic", async () => {
    // A member with no job function holds every capability; the owner rule
    // is the one that stops them here.
    fake.context.role = "MEMBER";
    const result = await checkAssistantConnection();
    expect(result).toEqual({ ok: false, error: "Only the account owner can check the assistant's connection" });
    expect(fake.check).not.toHaveBeenCalled();
  });

  it("returns the model when the key and the org's access both hold", async () => {
    fake.check.mockResolvedValue({ ok: true, model: "claude-opus-5" });
    expect(await checkAssistantConnection()).toEqual({ ok: true, value: { model: "claude-opus-5" } });
    expect(fake.check).toHaveBeenCalledWith("claude-opus-5");
  });

  it("translates a rejected key into the sentence with the fix", async () => {
    fake.check.mockResolvedValue({ ok: false, status: 401, type: "authentication_error" });
    const result = await checkAssistantConnection();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/rejected the key \(401 authentication_error\)/);
  });
});
