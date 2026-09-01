import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * The first database-backed test in this repo.
 *
 * Named `.dbtest.ts`, not `.test.ts`, so the normal suite does not collect
 * it — vitest.config.ts includes only `**\/*.test.ts`, and CI has no
 * Postgres. Run it against a scratch database:
 *
 *   DATABASE_URL=postgresql://... DIRECT_URL=$DATABASE_URL \
 *     pnpm --filter @prova/web exec vitest run --config vitest.db.config.ts
 *
 * It exists because the connect/disconnect actions cannot be reached by the
 * unit suite — they take no arguments, read the session, and their whole
 * behaviour is a transaction. Every one of this project's real bugs has
 * been found by executing the code path with real inputs rather than
 * reading it, and "the action returned ok" has already been shown, in this
 * codebase, not to mean a row exists.
 *
 * ONLY the auth boundary is faked. The actions, the Prisma client, the
 * transaction and the schema are all real; what is stubbed is the one thing
 * that needs a browser and a Clerk session.
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string };

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => context,
}));

/**
 * The second faked boundary, and the last.
 *
 * `revalidatePath` reads Next's per-request store, which does not exist
 * outside a request — it throws "static generation store missing". That is
 * the harness, not the action. Recorded rather than merely silenced, so the
 * test still asserts the page gets invalidated: an action that writes the
 * row and leaves the page showing the old one is a real bug, and this
 * project has already been bitten by a successful write rendering as an
 * empty list.
 */
const revalidated: string[] = [];
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    revalidated.push(path);
  },
}));

const { connectSandboxIntegration, disconnectSandboxIntegration } = await import("./integrations");

async function connectionRow() {
  return prisma.integrationConnection.findUnique({
    where: { companyId_provider: { companyId: context.company.id, provider: "SANDBOX" } },
    include: { syncLogs: { orderBy: { occurredAt: "asc" } } },
  });
}

describe("sandbox connect / disconnect against a real database", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Integration Test Co" } });
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `test_${Date.now()}`,
        email: `owner_${Date.now()}@example.test`,
        role: "OWNER",
      },
    });
    context.company.id = company.id;
    context.id = user.id;
  });

  afterAll(async () => {
    await prisma.integrationConnection.deleteMany({ where: { companyId: context.company.id } });
    await prisma.user.deleteMany({ where: { companyId: context.company.id } });
    await prisma.company.delete({ where: { id: context.company.id } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    context.role = "OWNER";
    revalidated.length = 0;
  });

  it("connect writes the connection AND a sync log row", async () => {
    const result = await connectSandboxIntegration();
    expect(result.ok).toBe(true);

    const row = await connectionRow();
    expect(row?.status).toBe("CONNECTED");
    expect(row?.externalAccountLabel).toBe("Sandbox Account");
    expect(row?.connectedByUserId).toBe(context.id);
    expect(row?.lastSyncStatus).toBe("SUCCESS");

    // The row is the point. An action that returns ok while the log is empty
    // is the exact shape of failure this project keeps meeting.
    expect(row?.syncLogs).toHaveLength(1);
    expect(row?.syncLogs[0].message).toContain("Sandbox Account");

    // The page has to be told, or the card still reads "Not connected".
    expect(revalidated).toContain("/settings/integrations");
  });

  it("stores no credential for a provider that has none", async () => {
    const row = await connectionRow();
    expect(row?.encryptedAccessToken).toBeNull();
    expect(row?.encryptedRefreshToken).toBeNull();
  });

  it("lastSyncedAt always matches the newest log row", async () => {
    // The one piece of derived state this schema stores. It is only safe
    // because both writes are in one transaction, so this asserts the thing
    // that makes it safe rather than trusting the comment that says so.
    const row = await connectionRow();
    const newest = row!.syncLogs[row!.syncLogs.length - 1];
    expect(row?.lastSyncedAt?.toISOString()).toBe(newest.occurredAt.toISOString());
  });

  it("reconnecting reuses the row instead of accumulating dead ones", async () => {
    await connectSandboxIntegration();
    const all = await prisma.integrationConnection.findMany({
      where: { companyId: context.company.id, provider: "SANDBOX" },
    });
    expect(all).toHaveLength(1);
    // But the history is kept: append-only means the second connect adds.
    const row = await connectionRow();
    expect(row!.syncLogs.length).toBeGreaterThan(1);
  });

  it("disconnect flips status, stamps the date and keeps the history", async () => {
    const before = (await connectionRow())!.syncLogs.length;
    const result = await disconnectSandboxIntegration();
    expect(result.ok).toBe(true);

    const row = await connectionRow();
    expect(row?.status).toBe("NOT_CONNECTED");
    expect(row?.disconnectedAt).toBeInstanceOf(Date);
    expect(row?.scopes).toEqual([]);
    // Disconnecting must not erase what the connection did.
    expect(row!.syncLogs.length).toBe(before + 1);
    expect(revalidated).toContain("/settings/integrations");
  });

  it("a MEMBER cannot connect, and is told why rather than being redacted", async () => {
    context.role = "MEMBER";
    const result = await connectSandboxIntegration();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/account owner/i);

    // And it changed nothing — not the row, and not the cache.
    expect((await connectionRow())?.status).toBe("NOT_CONNECTED");
    expect(revalidated).toEqual([]);
  });

  it("a MEMBER cannot disconnect either", async () => {
    context.role = "OWNER";
    await connectSandboxIntegration();
    context.role = "MEMBER";
    const result = await disconnectSandboxIntegration();
    expect(result.ok).toBe(false);
    expect((await connectionRow())?.status).toBe("CONNECTED");
  });

  it("deleting a connection takes its logs with it", async () => {
    const row = await connectionRow();
    await prisma.integrationConnection.delete({ where: { id: row!.id } });
    const orphans = await prisma.integrationSyncLog.findMany({ where: { connectionId: row!.id } });
    expect(orphans).toEqual([]);
  });
});
