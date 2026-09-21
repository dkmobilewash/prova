import { describe, expect, it, vi } from "vitest";

/**
 * What the phone is told about the person holding it.
 *
 * The rule this pins is the one that keeps the phone's shell honest: the
 * capabilities are DERIVED HERE, by the same `capabilitiesFor` the web
 * uses, and sent. A second copy of the mapping inside an app-store binary
 * would go stale the day somebody changes a job function, with no way to
 * correct it except a release.
 */

let context: Record<string, unknown> | null = null;

vi.mock("@/lib/auth", () => ({
  requireApiContext: async () => context,
}));

const { GET } = await import("./route");

const BASE = {
  id: "u_1",
  name: "Ana Reyes",
  email: "ana@example.test",
  company: { id: "co_1", name: "Reyes Drywall" },
};

describe("GET /api/v1/me", () => {
  it("sends the capabilities the server derives for a job function", async () => {
    context = { ...BASE, role: "MEMBER", jobFunction: "FIELD" };
    const body = await (await GET()).json();

    expect(body.capabilities.sort()).toEqual(["MANAGE_FIELD", "MANAGE_JOBS"]);
    expect(body.restricted).toBe(true);
    expect(body).toMatchObject({ name: "Ana Reyes", jobFunction: "FIELD", role: "MEMBER" });
  });

  it("gives an owner everything, whatever their job function says", async () => {
    // The rule that stops a dropdown locking somebody out of their own
    // company — lib/permissions.ts states it first for the same reason.
    context = { ...BASE, role: "OWNER", jobFunction: "ACCOUNTING" };
    const body = await (await GET()).json();
    expect(body.capabilities).toContain("MANAGE_FIELD");
    expect(body.restricted).toBe(false);
  });

  it("gives a member with no job function the whole list, so nobody loses access to this shipping", async () => {
    context = { ...BASE, role: "MEMBER", jobFunction: null };
    const body = await (await GET()).json();
    expect(body.capabilities).toContain("MANAGE_FIELD");
    expect(body.capabilities).toContain("MANAGE_BILLING");
  });

  it("withholds the field capability from a bookkeeper", async () => {
    context = { ...BASE, role: "MEMBER", jobFunction: "ACCOUNTING" };
    const body = await (await GET()).json();
    expect(body.capabilities).not.toContain("MANAGE_FIELD");
    expect(body.capabilities).toContain("MANAGE_BILLING");
  });

  it("answers 401 rather than a shape the phone would trust", async () => {
    context = null;
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).not.toHaveProperty("capabilities");
  });
});
