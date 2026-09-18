import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * add_contact against a where-honouring fake and a faked action.
 *
 *   - RESOLVE NEVER WRITES: `createContact` is a spy and every write method
 *     on the fake throws.
 *   - Tenant scope: the other company already has a "Halvorsen Builders";
 *     the duplicate check honours `companyId`, so a check that lost it would
 *     refuse to add a contact this company does not have.
 *   - Every field on the card is the person's words; a type word it cannot
 *     read is a chip row of the four, never a pick.
 */

type Where = Record<string, unknown>;
function matches(row: Record<string, unknown>, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, want]) => {
    const have = row[key];
    if (want !== null && typeof want === "object") {
      const op = want as { equals?: string };
      if (op.equals !== undefined) return String(have ?? "").toLowerCase() === op.equals.toLowerCase();
      return false;
    }
    return have === want;
  });
}

const CONTACTS = [
  { id: "c1", companyId: "co-2", name: "Halvorsen Builders" },
  { id: "c2", companyId: "co-1", name: "Turner Construction" },
];

const fake = vi.hoisted(() => ({
  createContact: vi.fn(),
  write: vi.fn(() => {
    throw new Error("resolve wrote to the database");
  }),
}));

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: {
    contact: {
      findFirst: async ({ where }: { where: Where }) => CONTACTS.find((row) => matches(row, where)) ?? null,
      create: fake.write,
      update: fake.write,
    },
  },
}));
vi.mock("@/lib/actions/company", () => ({ createContact: fake.createContact }));

const { addContactCommand, readContactType } = await import("./contacts");

const ctx = { companyId: "co-1", userId: "u-1", principal: { role: "OWNER" as const, jobFunction: null }, today: "2026-09-18" };
const line = (result: { preview?: { label: string; value: string }[] }, label: string) =>
  result.preview?.find((l) => l.label === label)?.value;

beforeEach(() => {
  fake.createContact.mockReset();
  fake.write.mockClear();
});

describe("add_contact", () => {
  it("reads the person's word for a type", () => {
    expect(readContactType("GC")).toBe("GENERAL_CONTRACTOR");
    expect(readContactType("supplier")).toBe("VENDOR");
    expect(readContactType("SUBCONTRACTOR")).toBe("SUBCONTRACTOR");
    expect(readContactType("friend")).toBeNull();
  });

  it("asks for the name, and writes nothing", async () => {
    expect(await addContactCommand.resolve(ctx, {})).toEqual({ kind: "need", missing: "the company's name" });
    expect(fake.createContact).not.toHaveBeenCalled();
  });

  it("puts exactly what was said on the card — and another company's Halvorsen is not a duplicate here", async () => {
    const result = await addContactCommand.resolve(ctx, { name: "Halvorsen Builders", type: "GC", phone: "555-0142" });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.existing).toBeUndefined();
    expect(line(result, "Kind")).toBe("General contractor");
    expect(line(result, "Phone")).toBe("555-0142");
    expect(line(result, "Email")).toBe("not set");
    expect(line(result, "Status")).toBe("Prospect");
    expect(fake.createContact).not.toHaveBeenCalled();
    expect(fake.write).not.toHaveBeenCalled();
  });

  it("links a contact THIS company already has instead of adding a second", async () => {
    const result = await addContactCommand.resolve(ctx, { name: "turner construction" });
    expect(result.kind === "ready" && result.existing?.href).toBe("/contacts/c2");
  });

  it("offers the four kinds for a word it cannot read", async () => {
    const result = await addContactCommand.resolve(ctx, { name: "Halvorsen", type: "friend" });
    expect(result.kind).toBe("clarify");
  });

  it("warns when there is no way to reach them", async () => {
    const result = await addContactCommand.resolve(ctx, { name: "Halvorsen" });
    expect(result.kind === "ready" && result.warnings.join(" ")).toMatch(/No phone or email/);
  });

  it("executes through createContact with the form's own fields, only on the tap", async () => {
    fake.createContact.mockResolvedValue({ ok: true });
    const result = await addContactCommand.execute(ctx, {
      name: "Halvorsen Builders",
      accountType: "GENERAL_CONTRACTOR",
      phone: "555-0142",
      email: null,
      address: null,
    });
    expect(result.ok).toBe(true);
    const form = fake.createContact.mock.calls[0][0] as FormData;
    expect(Object.fromEntries(form.entries())).toEqual({
      name: "Halvorsen Builders",
      accountType: "GENERAL_CONTRACTOR",
      phone: "555-0142",
    });
  });
});
