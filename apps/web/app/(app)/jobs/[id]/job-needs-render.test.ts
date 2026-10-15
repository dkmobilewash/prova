import type React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { NeedItem } from "@/components/home/HomeParts";

/**
 * ── THE LIST IS ACTUALLY ON THE PAGE ──
 *
 * `job-needs.test.ts` proves the rows are BUILT correctly and
 * `recap-state.test.ts` proves the money behind one of them. Neither proves
 * anybody can see them, and that gap is not hypothetical here: replacing the
 * render condition with `{false && (` left all 11,111 tests in this repo green.
 * A whole feature, assembled and tested and invisible.
 *
 * That is the shape CLAUDE.md records from expo-router — three fixes shipped
 * green and rendered nothing — and the rule it leaves: prefer a fix that is
 * checkable, and make the decisive mutation "make it render nothing".
 *
 * So this renders the real page and looks for the words.
 */

const company = { id: "company-1", name: "Test Drywall" };

const principal = {
  id: "user-1",
  name: "Tester",
  email: "tester@example.com",
  // OWNER, because the list is money-gated: `showsJobMoney` decides whether it
  // is even assembled, and a persona who cannot see costs must not be told the
  // markup is missing.
  role: "OWNER" as string,
  jobFunction: null as string | null,
  companyId: company.id,
  company,
};

const jobRow = {
  id: "job-1",
  companyId: company.id,
  name: "Sunset Tower — drywall",
  status: "ESTIMATE",
  scope: "Framing and drywall",
  contactId: "contact-1",
  contact: { id: "contact-1", name: "Acme GC", email: "gc@example.com" },
  operatingLocationId: null,
  operatingLocation: null,
  startDate: null,
  endDate: null,
  siteAddress: null,
  projectLocation: null,
  siteLatitude: null,
  bidDueDate: null,
  bidResearch: null,
  signatureRequests: [],
  contractDocuments: [],
  assignments: [],
  lineItems: [],
};

/** What the loader is made to return, swapped per case. */
let needs: NeedItem[] = [];

vi.mock("@prova/db", () => ({
  Prisma: {},
  prisma: {
    job: { findUnique: vi.fn(async () => jobRow), update: vi.fn(async () => jobRow) },
    contact: { findMany: vi.fn(async () => [jobRow.contact]) },
    user: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => ({ id: "user-1", companyId: company.id })) },
    companyLocation: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    jobAssignment: { create: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({})) },
  },
}));

vi.mock("@/lib/auth", () => ({ requireCompanyContext: vi.fn(async () => principal) }));
vi.mock("@/lib/jobs/requireJob", () => ({
  requireJob: vi.fn(async () => ({
    company,
    currentUser: principal,
    principal,
    job: { id: jobRow.id, companyId: company.id, name: jobRow.name },
  })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/jobs/job-1",
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("notFound() was called — the job fixture is not being found");
  },
  redirect: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Map([["host", "app.example.com"]])) }));
vi.mock("@/lib/viewerToday", () => ({
  viewerTimeZone: vi.fn(async () => "UTC"),
  viewerToday: vi.fn(async () => "2026-10-14"),
}));
vi.mock("@/lib/docusign/views", () => ({ loadJobDocuSign: vi.fn(async () => null) }));
vi.mock("@/lib/jobs/job-paperwork", () => ({
  jobPaperworkLinks: vi.fn(() => []),
  loadJobPaperworkCounts: vi.fn(async () => ({})),
}));
vi.mock("@/lib/push", () => ({ pushToUser: vi.fn() }));

/** THE ONE LINE THIS FILE IS ABOUT. */
vi.mock("@/lib/jobs/job-needs-query", () => ({ loadJobNeeds: vi.fn(async () => needs) }));

const item = (over: Partial<NeedItem> = {}): NeedItem => ({
  key: "bid-due-job-1",
  tone: "red",
  text: "Get the bid in — the GC's deadline is here",
  when: "overdue 2 days",
  whenTone: "danger",
  action: { label: "Open", href: "/jobs/job-1/estimate" },
  ...over,
});

async function paint() {
  const mod = await import("./(tabs)/page");
  const page = await (mod.default as (args: { params: Promise<{ id: string }> }) => Promise<React.ReactElement>)({
    params: Promise.resolve({ id: "job-1" }),
  });
  return renderToStaticMarkup(page);
}

describe("what this job needs from you, on the job page", () => {
  it("IS RENDERED — the words are in the markup", async () => {
    needs = [item()];
    const html = await paint();
    expect(html).toContain("Needs you today");
    expect(html).toContain("Get the bid in");
    // The way out, which is the only control on the row.
    expect(html).toContain("/jobs/job-1/estimate");
  });

  it("IS ABSENT ENTIRELY when nothing is waiting", async () => {
    // Not an empty card. `NeedsBlock` has a good empty state and it belongs on
    // the dashboard, where the question is "is anything waiting anywhere". Here
    // the rest of the page has already answered, and an empty card on every
    // healthy job is how a reader learns to skip this one.
    needs = [];
    const html = await paint();
    expect(html).not.toContain("Needs you today");
  });

  it("SITS ABOVE the printable summary, because it is the only part about doing", async () => {
    needs = [item()];
    const html = await paint();
    const needsAt = html.indexOf("Needs you today");
    const summaryAt = html.indexOf('data-tour="job-summary"');
    expect(needsAt).toBeGreaterThan(-1);
    expect(summaryAt).toBeGreaterThan(-1);
    expect(needsAt).toBeLessThan(summaryAt);
  });

  it("IS HIDDEN FROM PRINT, so a client's contract carries no to-do list", async () => {
    // The summary below is what Print produces — "Print prints this part only",
    // per the walkthrough — and this must not travel with it.
    needs = [item()];
    const html = await paint();
    const at = html.indexOf('data-tour="job-needs"');
    expect(at).toBeGreaterThan(-1);
    // The wrapper's own classes, read from the element that carries the anchor.
    const wrapper = html.slice(Math.max(0, at - 200), at);
    expect(wrapper).toContain("print:hidden");
  });

  it("carries the tone as a WORD and not only as a colour", async () => {
    // DESIGN.md: a status is a word and a colour, never a colour. `NeedsBlock`
    // renders the screen-reader word; this is the assertion that it survives
    // being used here rather than only on the dashboard.
    needs = [item({ tone: "red" })];
    const html = await paint();
    expect(html.toLowerCase()).toContain("late");
  });
});
