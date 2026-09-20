import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The owner-only half of the Bluebeam actions' guard order.
 *
 * lib/action-capability-guards.test.ts already walks every action reachable
 * from a capability-guarded page and proves the MANAGE_COMPLIANCE check
 * fires before any database touch. What it does NOT pin down is the
 * SECOND guard behind it — `ownerRefusal` — because its own "control" test
 * only asserts the capability-refusal SENTENCE is absent for a capable
 * MEMBER, not that some other refusal (the owner one) is present. A
 * MEMBER who holds MANAGE_COMPLIANCE must still be refused, by name, and
 * before `prisma` is touched — that is what this file pins, with a DB
 * tripwire so "refused" cannot mean "refused after already writing".
 */

const { dbTouches, prismaNamespace, principal } = vi.hoisted(() => {
  const touches: string[] = [];
  const wire = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property === "symbol" || property === "then") return undefined;
        touches.push(String(property));
        throw new Error(`prisma.${String(property)} touched before the owner guard ran`);
      },
    },
  );
  return {
    dbTouches: touches,
    tripwire: wire,
    prismaNamespace: { prisma: wire },
    principal: { id: "user_1", role: "MEMBER" as string, jobFunction: null as string | null, company: { id: "co_1" } },
  };
});

vi.mock("@prova/db", () => prismaNamespace);
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => principal }));

beforeEach(() => {
  dbTouches.length = 0;
  principal.role = "MEMBER";
  principal.jobFunction = null; // unset jobFunction holds every capability, including MANAGE_COMPLIANCE
});

const OWNER_ONLY = /Only the account owner/;

describe("Bluebeam actions refuse a non-owner before touching prisma", () => {
  it("linkJobToBluebeam", async () => {
    const { linkJobToBluebeam } = await import("./bluebeam");
    const result = await linkJobToBluebeam(new FormData());
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(OWNER_ONLY) });
    expect(dbTouches, `touched prisma.${dbTouches[0]}`).toEqual([]);
  });

  it("pushBluebeamDocument", async () => {
    const { pushBluebeamDocument } = await import("./bluebeam");
    const result = await pushBluebeamDocument(new FormData());
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(OWNER_ONLY) });
    expect(dbTouches).toEqual([]);
  });

  it("refreshBluebeamSessionAction", async () => {
    const { refreshBluebeamSessionAction } = await import("./bluebeam");
    const result = await refreshBluebeamSessionAction("job_1");
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(OWNER_ONLY) });
    expect(dbTouches).toEqual([]);
  });

  it("unlinkBluebeamSession", async () => {
    const { unlinkBluebeamSession } = await import("./bluebeam");
    const result = await unlinkBluebeamSession("link_1");
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(OWNER_ONLY) });
    expect(dbTouches).toEqual([]);
  });

  it("disconnectBluebeam", async () => {
    const { disconnectBluebeam } = await import("./bluebeam");
    const result = await disconnectBluebeam();
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(OWNER_ONLY) });
    expect(dbTouches).toEqual([]);
  });

  it("control: an OWNER is not stopped by this guard (it proceeds to touch prisma, and the tripwire is what stops it)", async () => {
    principal.role = "OWNER";
    const { linkJobToBluebeam } = await import("./bluebeam");
    const form = new FormData();
    form.set("jobId", "job_1");
    await expect(linkJobToBluebeam(form)).rejects.toThrow(/touched before the owner guard ran/);
    expect(dbTouches.length).toBeGreaterThan(0);
  });
});
