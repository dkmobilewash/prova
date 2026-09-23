import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The calendar feed's token IS the whole of the authentication (no cookie,
 * no login — Apple/Google/Outlook poll a bare URL), so the two things that
 * matter most are: a dead token 404s exactly like one that never existed,
 * and a live token serves ONLY the company it was minted for, never a
 * bystander's data. Both are asserted here without a database — the route
 * is driven with `@prova/db` and `@/lib/calendar-feed` mocked, in the same
 * style `api/jobber/callback/route.test.ts` and `api/procore/callback/
 * route.test.ts` use for the other token-authenticated endpoints.
 */

type TokenRow = { companyId: string; user: { companyId: string }; company: { name: string } } | null;

let tokenRow: TokenRow = null;
let findUniqueCalls: { where: unknown }[] = [];
let loadCalls: { companyId: string; today: string }[] = [];
let scheduleRowsByCompany: Record<string, ReturnType<typeof row>[]> = {};

vi.mock("@prova/db", () => ({
  prisma: {
    calendarFeedToken: {
      findUnique: async (args: { where: unknown }) => {
        findUniqueCalls.push(args);
        return tokenRow;
      },
    },
  },
}));

vi.mock("@/lib/calendar-feed", async () => {
  const actual = await vi.importActual<typeof import("@/lib/calendar-feed")>("@/lib/calendar-feed");
  return {
    ...actual,
    loadCalendarSchedule: async (companyId: string, today: string) => {
      loadCalls.push({ companyId, today });
      return scheduleRowsByCompany[companyId] ?? [];
    },
  };
});

const { GET } = await import("./route");

const VALID_TOKEN = "a".repeat(48);

function request(token: string) {
  return { params: Promise.resolve({ token }) } as { params: Promise<{ token: string }> };
}

function row(companyId: string, jobName: string) {
  return {
    workDate: new Date("2026-09-22T00:00:00.000Z"),
    note: null,
    jobId: `job_${companyId}`,
    job: { name: jobName, siteAddress: null },
    scheduledUser: { name: "Ana Ruiz", email: "a@x.com" },
    crewMember: null,
    craftClassification: null,
    updatedAt: new Date("2026-09-19T00:00:00.000Z"),
  };
}

beforeEach(() => {
  tokenRow = null;
  findUniqueCalls = [];
  loadCalls = [];
  scheduleRowsByCompany = {
    company_A: [row("company_A", "Westfield Plaza — A's job")],
    company_B: [row("company_B", "Alameda Tower — B's job")],
  };
});

describe("dead tokens — every kind of dead is the SAME 404", () => {
  it("a malformed token (wrong shape) 404s without touching the database", async () => {
    const response = await GET(new NextRequest("https://app.cstream.ai/api/calendar/not-a-token"), request("not-a-token"));
    expect(response.status).toBe(404);
    expect(findUniqueCalls).toHaveLength(0);
  });

  it("a well-formed token that matches no row 404s (never existed, or was regenerated away)", async () => {
    tokenRow = null;
    const response = await GET(new NextRequest(`https://app.cstream.ai/api/calendar/${VALID_TOKEN}`), request(VALID_TOKEN));
    expect(response.status).toBe(404);
    expect(findUniqueCalls).toHaveLength(1);
    expect(findUniqueCalls[0].where).toEqual({ token: VALID_TOKEN });
  });

  it("a token whose user has moved to a different company (or left) 404s, even though the row itself exists", async () => {
    tokenRow = { companyId: "company_A", user: { companyId: "company_C" }, company: { name: "Old Co" } };
    const response = await GET(new NextRequest(`https://app.cstream.ai/api/calendar/${VALID_TOKEN}`), request(VALID_TOKEN));
    expect(response.status).toBe(404);
    // Never reached the schedule query for a dead token.
    expect(loadCalls).toHaveLength(0);
  });

  it("the never-existed 404 and the moved-away 404 are BYTE IDENTICAL — a dead link teaches nothing about its history", async () => {
    tokenRow = null;
    const neverExisted = await GET(new NextRequest(`https://app.cstream.ai/api/calendar/${VALID_TOKEN}`), request(VALID_TOKEN));
    tokenRow = { companyId: "company_A", user: { companyId: "company_C" }, company: { name: "Old Co" } };
    const movedAway = await GET(new NextRequest(`https://app.cstream.ai/api/calendar/${VALID_TOKEN}`), request(VALID_TOKEN));
    expect(neverExisted.status).toBe(movedAway.status);
    expect(await neverExisted.text()).toBe(await movedAway.text());
    expect(neverExisted.headers.get("Cache-Control")).toBe(movedAway.headers.get("Cache-Control"));
  });

  it("a 404 is never cached — Cache-Control forbids storing the dead response", async () => {
    const response = await GET(new NextRequest(`https://app.cstream.ai/api/calendar/${VALID_TOKEN}`), request(VALID_TOKEN));
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("tenant scoping — a live token serves ONLY the company it was minted for", () => {
  it("serves company A's own schedule for company A's token, not company B's", async () => {
    tokenRow = { companyId: "company_A", user: { companyId: "company_A" }, company: { name: "A Co" } };
    const response = await GET(new NextRequest(`https://app.cstream.ai/api/calendar/${VALID_TOKEN}`), request(VALID_TOKEN));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("A's job");
    expect(body).not.toContain("B's job");
    expect(loadCalls).toEqual([{ companyId: "company_A", today: loadCalls[0]?.today }]);
  });

  it("serves company B's own schedule for company B's token, not company A's — the other direction, so a check that always answered A would not pass this", async () => {
    tokenRow = { companyId: "company_B", user: { companyId: "company_B" }, company: { name: "B Co" } };
    const response = await GET(new NextRequest(`https://app.cstream.ai/api/calendar/${VALID_TOKEN}`), request(VALID_TOKEN));
    const body = await response.text();
    expect(body).toContain("B's job");
    expect(body).not.toContain("A's job");
  });

  it("the schedule query is scoped by the TOKEN ROW's companyId, never a value that could be spoofed from the request", async () => {
    tokenRow = { companyId: "company_A", user: { companyId: "company_A" }, company: { name: "A Co" } };
    await GET(new NextRequest(`https://app.cstream.ai/api/calendar/${VALID_TOKEN}?companyId=company_B`), request(VALID_TOKEN));
    expect(loadCalls).toEqual([{ companyId: "company_A", today: loadCalls[0]?.today }]);
  });
});

describe("a live response", () => {
  it("renders valid ICS with the calendar name from the token's own company, and the right content headers", async () => {
    tokenRow = { companyId: "company_A", user: { companyId: "company_A" }, company: { name: "A Co" } };
    const response = await GET(new NextRequest(`https://app.cstream.ai/api/calendar/${VALID_TOKEN}`), request(VALID_TOKEN));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe('inline; filename="crew-schedule.ics"');
    const body = await response.text();
    expect(body.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(body).toContain("X-WR-CALNAME:A Co crew schedule\r\n");
    expect(body.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
