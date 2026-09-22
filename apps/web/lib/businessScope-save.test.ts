import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Saving the three onboarding questions with nothing selected.
 *
 * `/welcome` is the first screen a new owner sees. Its Save button posts
 * the three radio groups to `saveBusinessScope`, and with no radio chosen
 * the first parser it reaches — `enumFromForm` in lib/actions/shared.ts —
 * refused with a PLAIN `Error`. `company.ts` caught only its own LOCAL
 * `InputError` class (a different class from the one shared.ts exports,
 * despite the same name) and rethrew everything else, so the refusal
 * left the action as a throw. Production redacts a thrown Server Action
 * message to a digest, and `CompanySetupGate` awaited the action with no
 * try/catch — so an empty Save on the very first screen produced
 * "Application error" rather than a sentence.
 *
 * Reproduced here before it was fixed: against the unfixed action the
 * first test below rejected with `"contractingRelationship" must be one
 * of: ...` — the raw enum list, addressed to nobody.
 *
 * The contract under test is CLAUDE.md's: an action declaring
 * `Promise<ActionResult>` RETURNS its refusals. Both directions are
 * asserted — a refusal for the empty and partial submits, AND a real
 * write for the full one — so an action that started refusing everything
 * could not pass.
 */

const fake = {
  update: vi.fn<(args: unknown) => Promise<unknown>>(),
  revalidatePath: vi.fn(),
};

/** The account owner of a brand-new company — the only person /welcome
 * ever shows the questions to. OWNER holds every capability. */
const owner = {
  id: "user-1",
  role: "OWNER",
  jobFunction: null,
  company: { id: "company-1", name: "Reyes Drywall", isProvaOperator: false },
};

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => owner }));
vi.mock("@prova/db", () => ({ prisma: { company: { update: fake.update } } }));
vi.mock("next/cache", () => ({ revalidatePath: fake.revalidatePath }));

const { saveBusinessScope } = await import("@/lib/actions/company");
const { enumFromForm, InputError, runAction } = await import("@/lib/actions/shared");

beforeEach(() => {
  fake.update.mockReset();
  fake.update.mockResolvedValue({});
  fake.revalidatePath.mockReset();
});

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe("Save on /welcome with no answer selected", () => {
  it("returns a refusal a person can read instead of throwing", async () => {
    // `resolves` is the whole point: a rejection here is the digest screen.
    const result = await saveBusinessScope(new FormData());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // A sentence about the questions — not the parser's enum list, which
    // names a form field and a list of constants nobody on /welcome has
    // seen.
    expect(result.error).toMatch(/three questions/i);
    expect(result.error).not.toMatch(/must be one of/);
    expect(result.error).not.toContain("contractingRelationship");
    expect(fake.update).not.toHaveBeenCalled();
  });

  it("refuses a partial answer the same readable way", async () => {
    const result = await saveBusinessScope(form({ contractingRelationship: "UNDER_GENERAL_CONTRACTORS" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/three questions/i);
    expect(fake.update).not.toHaveBeenCalled();
  });

  it("refuses a tampered answer readably too — a value the form never offers", async () => {
    const result = await saveBusinessScope(
      form({ contractingRelationship: "PIRATE", doesPublicWork: "true", filesMonthlyPayApps: "false" }),
    );
    expect(result.ok).toBe(false);
    expect(fake.update).not.toHaveBeenCalled();
  });
});

describe("Save on /welcome with all three answered", () => {
  it("writes the answers and stamps businessScopeAskedAt", async () => {
    const result = await saveBusinessScope(
      form({ contractingRelationship: "UNDER_GENERAL_CONTRACTORS", doesPublicWork: "true", filesMonthlyPayApps: "false" }),
    );
    expect(result).toEqual({ ok: true });
    expect(fake.update).toHaveBeenCalledTimes(1);
    const args = fake.update.mock.calls[0][0] as {
      where: { id: string };
      data: { contractingRelationship: string; doesPublicWork: boolean; filesMonthlyPayApps: boolean; businessScopeAskedAt: Date };
    };
    expect(args.where).toEqual({ id: "company-1" });
    expect(args.data.contractingRelationship).toBe("UNDER_GENERAL_CONTRACTORS");
    expect(args.data.doesPublicWork).toBe(true);
    expect(args.data.filesMonthlyPayApps).toBe(false);
    expect(args.data.businessScopeAskedAt).toBeInstanceOf(Date);
  });
});

describe("the parser refusal is the kind runAction returns", () => {
  // The root of the defect was two classes with one name. Whatever
  // `enumFromForm` throws has to be the InputError `runAction` catches,
  // or every action using the pair rethrows a message the user was meant
  // to read.
  it("enumFromForm throws shared.ts's InputError", () => {
    expect(() => enumFromForm(new FormData(), "kind", ["A", "B"] as const)).toThrow(InputError);
  });

  it("so runAction converts it to a returned failure rather than rethrowing", async () => {
    const result = await runAction(async () => {
      enumFromForm(new FormData(), "kind", ["A", "B"] as const);
      return { ok: true };
    });
    expect(result.ok).toBe(false);
  });
});
