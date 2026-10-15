import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * The page rendered against a handful of rows, because `outbound-scoreboard.test.ts`
 * proves the counting and nothing else proves the page draws those counts.
 * Same shape as `app/(app)/empty-states.test.ts`: mock the database, render
 * once, assert on the markup with an anti-vacuity check first.
 */

const events = [
  { id: "s1", type: "EMAIL_SENT", leadId: "L1", payload: { subject: "Baker pay app" }, occurredAt: new Date("2026-09-12T15:00:00Z"), createdAt: new Date("2026-09-12T15:00:00Z") },
  { id: "s2", type: "EMAIL_SENT", leadId: "L1", payload: { subject: "Baker next bid" }, occurredAt: new Date("2026-09-11T15:00:00Z"), createdAt: new Date("2026-09-11T15:00:00Z") },
  { id: "r1", type: "EMAIL_REPLY", leadId: "L1", payload: { subject: "Re: Baker pay app" }, occurredAt: new Date("2026-09-12T16:00:00Z"), createdAt: new Date("2026-09-12T16:00:00Z") },
];
const replyRow = {
  id: "R1",
  eventId: "r1",
  leadId: "L1",
  classification: "INTERESTED",
  door: "PAY_APP",
  status: "PENDING_REVIEW",
  receivedAt: new Date("2026-09-12T16:00:00Z"),
  lead: { companyName: "Baker Drywall" },
};
const activities = [
  { type: "CALL", leadId: "L1", occurredOn: new Date("2026-09-12T00:00:00Z"), summary: "[CONVERSATION] asked for Thursday" },
  { type: "CALL", leadId: "L1", occurredOn: new Date("2026-09-12T00:00:00Z"), summary: "[NO_ANSWER]" },
];

vi.mock("@prova/db", () => ({
  prisma: {
    outboundEvent: { findMany: vi.fn(async () => events) },
    outboundReply: {
      findMany: vi.fn(async () => [replyRow]),
      count: vi.fn(async () => 1),
    },
    salesActivity: { findMany: vi.fn(async () => activities) },
  },
}));
vi.mock("@/lib/auth", () => ({
  requireCompanyContext: vi.fn(async () => ({
    company: { id: "company-1", name: "Prova", isProvaOperator: true },
    id: "user-1",
    role: "OWNER",
  })),
}));
vi.mock("@/lib/viewerToday", () => ({ viewerTimeZone: vi.fn(async () => "UTC") }));
vi.mock("@/lib/viewer-timezone", () => ({ todayInZone: (_zone: string, now?: Date) => (now ?? new Date("2026-09-12T12:00:00Z")).toISOString().slice(0, 10) }));

describe("/sales/scoreboard", () => {
  it("draws today's calls and emails, the door rows, and the Slack block from the rows", async () => {
    const { default: Page } = await import("./page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ days: "14" }) }));
    expect(html).toContain("Outbound scoreboard"); // the page ran
    expect(html).toContain("By door, last 14 days");
    expect(html).toContain("Pay app");
    expect(html).toContain("Baker Drywall");
    expect(html).toContain('href="/sales/L1"');
    expect(html).toContain("1 waiting for you");
    expect(html).toContain("Calls: 2 dials, 1 connects, 1 conversations, 0 meetings booked");
    expect(html).toContain("Email: 1 sent, 0 bounced, 1 replies, 1 positive");
    expect(html).toContain("Letters: lands with cyrus/letters");
    expect(html).toContain("not decided yet");
  });

  it("falls back to 7 days on a window it does not offer", async () => {
    const { default: Page } = await import("./page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ days: "90" }) }));
    expect(html).toContain("By door, last 7 days");
  });
});
