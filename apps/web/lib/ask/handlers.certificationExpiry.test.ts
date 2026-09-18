import { describe, expect, it, vi } from "vitest";

/**
 * certification_expiry — and the row that must never be dropped.
 *
 * A card with NO expiry date is a gap in the records, not a card that is
 * fine. Filtering on "expires within N days" naturally excludes it, because
 * null is not less than anything, and the tool then answers "nobody is
 * expiring" while somebody walks onto a site with an undated card. So
 * undated rows are carried, marked, and sorted LAST — present enough to
 * chase, never urgent enough to outrank a card that lapsed yesterday.
 *
 * The window is the other half. The model sends a string; an unparseable
 * one must fall back to the default rather than returning an empty list,
 * because "no certification is expiring" is the one wrong answer this tool
 * must never give.
 */

const TODAY = "2026-09-17";

const CERTIFICATIONS = [
  {
    kind: "OSHA_10",
    otherLabel: null,
    issuer: "OSHA Training Institute",
    expiresOn: new Date("2026-08-20T00:00:00.000Z"), // expired 28 days ago
    holder: { name: "Miguel Alvarez", email: "miguel@example.com" },
  },
  {
    kind: "SCAFFOLD_COMPETENT_PERSON",
    otherLabel: null,
    issuer: null,
    expiresOn: new Date("2026-09-30T00:00:00.000Z"), // 13 days out
    holder: { name: "Hector Ramirez", email: null },
  },
  {
    kind: "RESPIRATOR_FIT_TEST",
    otherLabel: null,
    issuer: null,
    expiresOn: new Date("2027-06-01T00:00:00.000Z"), // far out — excluded
    holder: { name: "Tino Alvarez", email: null },
  },
  {
    // The row this file exists for.
    kind: "OTHER",
    otherLabel: "Cal/OSHA silica awareness",
    issuer: null,
    expiresOn: null,
    holder: { name: null, email: "crew@example.com" },
  },
  {
    // OTHER with nothing written in. Must not render as a card called "Other".
    kind: "OTHER",
    otherLabel: null,
    issuer: null,
    expiresOn: null,
    holder: { name: "Unknown Holder", email: null },
  },
];

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: {
    workerCertification: { findMany: async () => CERTIFICATIONS },
    job: { findFirst: async () => null },
  },
}));

vi.mock("@/lib/serverToday", () => ({ serverToday: () => TODAY }));

type Row = {
  holder: string | null;
  certification: string;
  expiresOn: string | null;
  daysUntilExpiry: number | null;
  state: "expired" | "expiring" | "undated";
};

async function ask(input: Record<string, string> = {}) {
  const { runTool } = await import("./handlers");
  return runTool(
    { companyId: "company-1", principal: { role: "OWNER", jobFunction: null } },
    "certification_expiry",
    input,
  );
}

describe("certification_expiry", () => {
  it("puts the expired card first — the chase order is the product", async () => {
    const { rows } = (await ask()).data as { rows: Row[] };
    expect(rows[0].holder).toBe("Miguel Alvarez");
    expect(rows[0].state).toBe("expired");
    expect(rows[0].daysUntilExpiry).toBe(-28);
  });

  it("CARRIES an undated certification instead of silently dropping it", async () => {
    // The whole point. A null expiry is excluded by any naive `<= window`
    // filter, and the tool then reports all clear.
    const { rows } = (await ask()).data as { rows: Row[] };
    const undated = rows.filter((row) => row.state === "undated");
    expect(undated).toHaveLength(2);
  });

  it("sorts undated LAST, below a card that actually lapsed", async () => {
    const { rows } = (await ask()).data as { rows: Row[] };
    const firstUndated = rows.findIndex((row) => row.state === "undated");
    const lastDated = rows.map((row) => row.state).lastIndexOf("expiring");
    expect(firstUndated).toBeGreaterThan(lastDated);
  });

  it("leaves out a card that is comfortably in date", async () => {
    const { rows } = (await ask()).data as { rows: Row[] };
    expect(rows.some((row) => row.holder === "Tino Alvarez")).toBe(false);
  });

  it("honours the window the person actually said", async () => {
    // 13 days out is inside 30 and outside 7. If the window were ignored,
    // both calls would return the same rows.
    const inThirty = (await ask({ withinDays: "30" })).data as { rows: Row[] };
    const inSeven = (await ask({ withinDays: "7" })).data as { rows: Row[] };
    expect(inThirty.rows.some((row) => row.holder === "Hector Ramirez")).toBe(true);
    expect(inSeven.rows.some((row) => row.holder === "Hector Ramirez")).toBe(false);
  });

  it("falls back to the default on a window it cannot read, rather than returning nothing", async () => {
    const nonsense = (await ask({ withinDays: "soon" })).data as { withinDays: number; rows: Row[] };
    expect(nonsense.withinDays).toBe(60);
    expect(nonsense.rows.length).toBeGreaterThan(0);
  });

  it("names an OTHER card by what somebody typed, and says so when nobody did", async () => {
    const { rows } = (await ask()).data as { rows: Row[] };
    expect(rows.map((row) => row.certification)).toContain("Cal/OSHA silica awareness");
    expect(rows.map((row) => row.certification)).toContain("Unnamed certification");
    expect(rows.map((row) => row.certification)).not.toContain("Other");
  });

  it("writes an enum as a person would say it", async () => {
    const { rows } = (await ask()).data as { rows: Row[] };
    expect(rows[0].certification).toBe("Osha 10");
    expect(rows.map((row) => row.certification)).toContain("Scaffold Competent Person");
  });

  it("falls back to an email when a holder has no name on file", async () => {
    const { rows } = (await ask()).data as { rows: Row[] };
    expect(rows.some((row) => row.holder === "crew@example.com")).toBe(true);
  });
});
