import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/lib/permissions";

/**
 * contact_lookup — the address book, company-scoped, with the People
 * section gated the way /contacts/[id] gates it.
 *
 * The fake HONOURS the where clause — equality, `contains`, `in` and `OR` —
 * so a handler that dropped `companyId` from either query returns the other
 * company's Halvorsen and goes red. And the people query is COUNTED, so a
 * handler that read people and then hid them from somebody without
 * estimating access (rather than never reading them) also goes red: the
 * rule is refuse before reading, not read and redact.
 */

type Where = Record<string, unknown>;
function matches(row: Record<string, unknown>, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, want]) => {
    if (key === "OR") return (want as Where[]).some((branch) => matches(row, branch));
    const have = row[key];
    if (want !== null && typeof want === "object" && !(want instanceof Date)) {
      const op = want as { contains?: string; equals?: string; in?: unknown[] };
      if (op.contains !== undefined) return String(have ?? "").toLowerCase().includes(op.contains.toLowerCase());
      if (op.equals !== undefined) return String(have ?? "").toLowerCase() === op.equals.toLowerCase();
      if (op.in !== undefined) return op.in.includes(have);
      return false;
    }
    return have === want;
  });
}

const CONTACTS = [
  { id: "c1", companyId: "co-1", name: "Halvorsen Builders", phone: "555-0142", email: "office@halvorsen.example", address: "1 Main", status: "ACTIVE", accountType: "GENERAL_CONTRACTOR" },
  { id: "c2", companyId: "co-2", name: "Halvorsen Construction", phone: "555-9999", email: "leak@other.example", address: null, status: "ACTIVE", accountType: null },
  { id: "c3", companyId: "co-1", name: "Turner", phone: null, email: null, address: null, status: "PROSPECT", accountType: null },
];
const PEOPLE = [
  { id: "p1", companyId: "co-1", contactId: "c1", name: "Dana Reyes", title: "PM", phone: "555-0143", email: "dana@halvorsen.example", contact: { name: "Halvorsen Builders" } },
  { id: "p2", companyId: "co-2", contactId: "c2", name: "Other PM", title: "PM", phone: "555-0000", email: "x@other.example", contact: { name: "Halvorsen Construction" } },
  { id: "p3", companyId: "co-1", contactId: "c3", name: "Sam Halvorsen", title: "Super", phone: "555-0200", email: null, contact: { name: "Turner" } },
  // Another company's person whose OWN name matches — reachable only through
  // the person-name branch, so it is what a people query without its
  // companyId would leak.
  { id: "p4", companyId: "co-2", contactId: "c2", name: "Erik Halvorsen", title: "Owner", phone: "555-7777", email: null, contact: { name: "Halvorsen Construction" } },
];

const contactFindMany = vi.fn(async (args: { where?: Where }) => CONTACTS.filter((row) => matches(row, args.where)));
const personFindMany = vi.fn(async (args: { where?: Where }) => PEOPLE.filter((row) => matches(row, args.where)));

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: { contact: { findMany: contactFindMany }, contactPerson: { findMany: personFindMany } },
}));
vi.mock("@/lib/serverToday", () => ({ serverToday: () => "2026-09-18" }));
vi.mock("@/lib/viewerToday", () => ({ viewerToday: async () => "2026-09-18", viewerTimeZone: async () => "UTC" }));

const { runTool } = await import("./handlers");

const OWNER: Principal = { role: "OWNER", jobFunction: null };
const FIELD: Principal = { role: "MEMBER", jobFunction: "FIELD" };

type Data = {
  accounts: { account: string; phone: string | null }[];
  people: { name: string; title: string | null; phone: string | null; at: string }[];
  peopleWithheld: boolean;
};

beforeEach(() => {
  contactFindMany.mockClear();
  personFindMany.mockClear();
});

describe("contact_lookup", () => {
  it("answers 'the PM at Halvorsen' from this company only — the account and the person, with the title as typed", async () => {
    const result = await runTool({ companyId: "co-1", principal: OWNER }, "contact_lookup", { name: "halvorsen" });
    const data = result.data as Data;
    expect(data.accounts.map((a) => a.account)).toEqual(["Halvorsen Builders"]);
    expect(data.accounts[0].phone).toBe("555-0142");
    // Dana because she works AT a matching account; Sam because his own
    // name matches. Never the other company's PM.
    expect(data.people.map((p) => p.name).sort()).toEqual(["Dana Reyes", "Sam Halvorsen"]);
    expect(data.people.find((p) => p.name === "Dana Reyes")).toMatchObject({ title: "PM", phone: "555-0143", at: "Halvorsen Builders" });
    expect(JSON.stringify(data)).not.toMatch(/other\.example|555-9999|555-0000|555-7777/);
    expect(data.peopleWithheld).toBe(false);
  });

  it("gives someone without estimating access the account's number and NEVER reads the people", async () => {
    const result = await runTool({ companyId: "co-1", principal: FIELD }, "contact_lookup", { name: "Halvorsen" });
    const data = result.data as Data;
    expect(data.accounts.map((a) => a.phone)).toEqual(["555-0142"]);
    expect(data.people).toEqual([]);
    expect(data.peopleWithheld).toBe(true);
    expect(personFindMany).not.toHaveBeenCalled();
  });

  it("says nobody matches, rather than an empty list, and asks for a name when given none", async () => {
    const none = await runTool({ companyId: "co-1", principal: OWNER }, "contact_lookup", { name: "Skanska" });
    expect(none.unavailable).toBe('Nobody on the contacts list matches "Skanska".');

    contactFindMany.mockClear();
    const blank = await runTool({ companyId: "co-1", principal: OWNER }, "contact_lookup", {});
    expect(blank.unavailable).toMatch(/Say which/);
    expect(contactFindMany).not.toHaveBeenCalled();
  });
});
