import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { QUICKBOOKS_OAUTH_STATE_COOKIE } from "@/lib/quickbooks-constants";

/**
 * The QuickBooks OAuth callback must bind the connection to the company
 * that is SIGNED IN, never to a company named by the browser (#136 §2).
 *
 * The exposure this pins: `qbo_oauth_state` is a plaintext JSON cookie.
 * `httpOnly` stops page JavaScript reading it; it does not stop the
 * browser's own user rewriting it in devtools. Start the flow, change one
 * field — `companyId` — to a victim's, finish Intuit's consent with your
 * own QuickBooks account. The `state` still matches, because you never
 * touched it, so every check the route had passed. The upsert then wrote
 * YOUR realm and YOUR tokens under THEIR `companyId`: their invoice and
 * payment pushes post into your books, and their real connection is gone.
 *
 * Both directions are asserted on purpose. A callback that refuses
 * everybody would pass the attack test perfectly and be a total outage of
 * the connect flow — and an OAuth flow that silently stops working is
 * exactly the kind of thing nobody notices for a month, because the
 * existing connection keeps refreshing.
 */

/** What the route asked Prisma to write, or null if it never got there. */
let upserted: {
  where: { companyId: string };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
} | null = null;

/** The session the callback sees. Set per test. */
let context: { id: string; role: string; company: { id: string } } | null = null;

/** The cookie jar the route reads and deletes from. */
let cookieJar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined,
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

vi.mock("@prova/integrations", () => ({
  exchangeCodeForTokens: async () => ({
    accessToken: "attacker-access-token",
    refreshToken: "attacker-refresh-token",
    accessTokenExpiresAt: new Date("2026-09-03T00:00:00.000Z"),
    refreshTokenExpiresAt: new Date("2026-12-12T00:00:00.000Z"),
  }),
}));

vi.mock("@prova/db", () => ({
  prisma: {
    quickBooksConnection: {
      upsert: async (args: {
        where: { companyId: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        upserted = args;
        return { id: "qbc_1", ...args.create };
      },
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => {
    if (!context) {
      // Standing in for redirect("/sign-in"), which throws NEXT_REDIRECT
      // in the real thing. What matters to these tests is that it does
      // not return a company.
      throw new Error("NEXT_REDIRECT");
    }
    return context;
  },
}));

const { GET } = await import("./route");

const STATE = "d0f5cb4b8f0f4b1e9c1a2b3c4d5e6f708192a3b4c5d6e7f8";

/** Intuit's redirect back to us, exactly as the browser makes it. */
function callback() {
  return new NextRequest(
    `https://app.cstream.ai/api/quickbooks/callback?code=intuit-auth-code&state=${STATE}&realmId=9130350000000000`,
  );
}

/** The `qb` / `qb_detail` the route redirected /settings to. */
function outcome(response: Response) {
  const location = new URL(response.headers.get("location") ?? "", "https://app.cstream.ai");
  return {
    path: location.pathname,
    qb: location.searchParams.get("qb"),
    detail: location.searchParams.get("qb_detail"),
  };
}

beforeEach(() => {
  upserted = null;
  context = null;
  cookieJar = new Map();
});

describe("QuickBooks OAuth callback", () => {
  it("refuses a cookie whose companyId was rewritten to another company", async () => {
    // The attacker is signed in as OWNER of their own company...
    context = { id: "user_attacker", role: "OWNER", company: { id: "co_attacker" } };
    // ...and hand-edited the one field that decides where the tokens land.
    cookieJar.set(
      QUICKBOOKS_OAUTH_STATE_COOKIE,
      JSON.stringify({ state: STATE, companyId: "co_victim", userId: "user_attacker" }),
    );

    const result = outcome(await GET(callback()));

    // The only assertion that matters: the victim's company must not have
    // been touched. Nothing may be written under co_victim, by any path.
    expect(upserted?.where.companyId).not.toBe("co_victim");
    expect(upserted?.create.companyId).not.toBe("co_victim");
    expect(result.qb).toBe("error");
  });

  it("connects the signed-in owner's own company", async () => {
    context = { id: "user_owner", role: "OWNER", company: { id: "co_owner" } };
    cookieJar.set(
      QUICKBOOKS_OAUTH_STATE_COOKIE,
      JSON.stringify({ state: STATE, companyId: "co_owner", userId: "user_owner" }),
    );

    const result = outcome(await GET(callback()));

    expect(result).toEqual({ path: "/settings", qb: "connected", detail: null });
    expect(upserted?.where.companyId).toBe("co_owner");
    expect(upserted?.create).toMatchObject({
      companyId: "co_owner",
      realmId: "9130350000000000",
      connectedByUserId: "user_owner",
    });
    expect(upserted?.update).toMatchObject({
      realmId: "9130350000000000",
      connectedByUserId: "user_owner",
    });
  });

  it("still rejects a state that does not match the cookie", async () => {
    context = { id: "user_owner", role: "OWNER", company: { id: "co_owner" } };
    cookieJar.set(
      QUICKBOOKS_OAUTH_STATE_COOKIE,
      JSON.stringify({ state: "a-different-state", companyId: "co_owner", userId: "user_owner" }),
    );

    expect(outcome(await GET(callback())).detail).toBe("state_mismatch");
    expect(upserted).toBeNull();
  });

  it("writes nothing when the browser arrives with no session", async () => {
    context = null;
    cookieJar.set(
      QUICKBOOKS_OAUTH_STATE_COOKIE,
      JSON.stringify({ state: STATE, companyId: "co_victim", userId: "user_attacker" }),
    );

    await expect(GET(callback())).rejects.toThrow();
    expect(upserted).toBeNull();
  });
});
