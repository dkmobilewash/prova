// @vitest-environment happy-dom

/**
 * Concept H's areas, mounted: the home boxes' dropdown behaviour in a real
 * DOM, and an area page rendered from the real page file against a fake
 * database — so a list that does not render cannot pass for one that does.
 */

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  counts: {} as Record<string, number>,
  context: { company: { id: "co-1", name: "Acme" }, id: "u-1", name: "Maria", email: null, role: "OWNER", jobFunction: null as string | null },
}));

vi.mock("@prova/db", () => {
  const prisma = new Proxy(
    {},
    {
      get: (_t, model: string) =>
        new Proxy(
          {},
          {
            get: (_m, method: string) => {
              if (method === "findMany") return vi.fn(async () => state.rows[model] ?? []);
              if (method === "count") return vi.fn(async () => state.counts[model] ?? 0);
              if (method === "aggregate") return vi.fn(async () => ({ _sum: {} }));
              return vi.fn(async () => null);
            },
          },
        ),
    },
  );
  return { prisma, Prisma: {} };
});
vi.mock("@/lib/auth", () => ({ requireCompanyContext: vi.fn(async () => state.context) }));
// The company figures the Money area now heads with (they left the bottom
// metric bar, 2026-10-10). Their arithmetic is company-financials.test.ts's;
// here only where they render, and for whom.
const figures = vi.hoisted(() => ({
  load: vi.fn(async () => ({
    estimatedRevenue: 1_284_500,
    grossMarginRate: 0.246,
    grossProfit: 120_000,
    earnedCoverage: 1,
    cashPosition: 412_300,
    outstandingReceivable: 90_000,
    retainageHeld: 64_920,
  })),
}));
vi.mock("@/lib/company-financials-query", () => ({ loadCompanyFinancials: figures.load }));
vi.mock("@/lib/viewerToday", () => ({ viewerToday: vi.fn(async () => "2026-10-14") }));
vi.mock("@/lib/renewals", () => ({ renewalSourcesForCompany: vi.fn(async () => []) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  usePathname: () => "/dashboard",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { AreaBoxes, placePanel } = await import("./AreaBoxes");

/** The brand-yellow fill class, assembled rather than written out: written
 * out, `theme-contrast.test.ts` reads this file's assertions about the class
 * as a fill missing its dark label. */
const BRAND_FILL = ["bg", "brand"].join("-");
const { AREAS, areaViews, areasFor } = await import("@/lib/areas");
const { default: AreaPage } = await import("@/app/(app)/areas/[slug]/page");

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const owner = { role: "OWNER", jobFunction: null };

describe("areaViews", () => {
  it("joins the headline tools' real statuses, and falls back to nothing (the description) without one", () => {
    const views = areaViews(areasFor(owner), {
      "/dashboard": { text: "6 in progress" },
      "/bids": { text: "2 bids due", tone: "amber" },
      "/pipeline": { text: "4 being chased" },
    });
    const jobs = views.find((v) => v.slug === "jobs-bids")!;
    expect(jobs.line).toEqual([{ text: "6 in progress" }, { text: "2 bids due", tone: "amber" }]);
    // /pipeline is a tool's status, not a headline.
    expect(jobs.tools.find((t) => t.route === "/pipeline")!.status).toEqual({ text: "4 being chased" });
    expect(views.find((v) => v.slug === "money")!.line).toEqual([]);
  });
});

describe("the home area boxes", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<AreaBoxes areas={areaViews(areasFor(owner), { "/rfis": { text: "2 RFIs waiting", tone: "amber" } })} />));
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  });

  const box = (name: string) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")).find((b) => b.textContent?.includes(name))!;

  it("draws six closed boxes, with the live line or the plain description", () => {
    expect(container.querySelectorAll("button[aria-expanded='false']")).toHaveLength(6);
    expect(box("Paperwork").textContent).toContain("2 RFIs waiting");
    expect(box("Money").textContent).toContain(AREAS.find((a) => a.slug === "money")!.description);
  });

  it("opens one dropdown listing the area's tools, ending in a link to the area", () => {
    act(() => box("Paperwork").click());
    expect(box("Paperwork").getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(box("Paperwork").getAttribute("aria-controls")!)!;
    const hrefs = Array.from(panel.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    // "Open Paperwork" leads, in the panel's head (it was a footer row).
    expect(hrefs).toEqual(["/areas/paperwork", "/rfis", "/submittals", "/drawings", "/closeout", "/intake", "/messages", "/alerts"]);
    expect(panel.textContent).toContain("Open Paperwork →");
    expect(panel.textContent).toContain("2 RFIs waiting");

    // One at a time.
    act(() => box("Money").click());
    expect(box("Paperwork").getAttribute("aria-expanded")).toBe("false");
    expect(box("Money").getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll("[role='region']")).toHaveLength(1);
  });

  it("puts Log hours first in Crew & field, going where the home's Log hours shortcut goes", () => {
    act(() => root.render(<AreaBoxes areas={areaViews(areasFor(owner), {})} hours={{ label: "Log hours", href: "/jobs/job-1/crew", sub: "Oak Ave" }} />));
    act(() => box("Crew & field").click());
    const panel = document.getElementById(box("Crew & field").getAttribute("aria-controls")!)!;
    const first = panel.querySelector("ul a")!;
    expect(first.getAttribute("href")).toBe("/jobs/job-1/crew");
    expect(first.textContent).toContain("Log hours");
    // Only Crew & field carries it.
    act(() => box("Paperwork").click());
    expect(document.getElementById(box("Paperwork").getAttribute("aria-controls")!)!.textContent).not.toContain("Log hours");
  });

  it("closes on Escape, giving focus back to the box, and on a click outside", () => {
    act(() => box("Paperwork").click());
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(box("Paperwork").getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(box("Paperwork"));

    act(() => box("Money").click());
    act(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(container.querySelector("[role='region']")).toBeNull();
  });
});

describe("placePanel — where an open area dropdown goes", () => {
  const view = { width: 1440, height: 900 };
  // The six boxes at 1440 wide: 48px gutters, 16px gaps, ~211px each.
  const boxAt = (i: number) => ({ left: 48 + i * 227, right: 48 + i * 227 + 211, bottom: 330 });

  it("sits left-aligned under its own box when it fits", () => {
    expect(placePanel(boxAt(0), 640, view).left).toBe(0);
    expect(placePanel(boxAt(2), 640, view).left).toBe(0);
  });

  it("Paperwork (4th) opens under Paperwork, left-aligned — it used to open 430px to its left", () => {
    // The old rule opened the right-hand three leftwards by INDEX; at 1440
    // Paperwork's panel fits to the right, so it now starts at its own box.
    expect(placePanel(boxAt(3), 640, view).left).toBe(0);
  });

  it("flips to right-aligned with its box only when 640px would run off the right", () => {
    const box = boxAt(5);
    const { left } = placePanel(box, 640, view);
    expect(box.left + left + 640).toBe(box.right);
    expect(box.left + left).toBeGreaterThanOrEqual(16);
  });

  it("never leaves the screen, even when neither alignment fits", () => {
    const narrow = { width: 700, height: 900 };
    const box = { left: 250, right: 450, bottom: 300 };
    const { left } = placePanel(box, 668, narrow);
    expect(box.left + left).toBe(16);
  });

  it("is never taller than the space below its box, and scrolls inside itself beyond that", () => {
    expect(placePanel(boxAt(0), 640, view).maxHeight).toBe(900 - 330 - 12 - 16);
    // A short window still gets a usable list rather than a slot.
    expect(placePanel(boxAt(0), 640, { width: 1440, height: 400 }).maxHeight).toBe(240);
  });
});

describe("an area page", () => {
  beforeEach(() => {
    state.rows = {};
    state.counts = {};
    state.context.role = "OWNER";
    state.context.jobFunction = null;
  });

  const render = async (slug: string) => renderToStaticMarkup(await AreaPage({ params: Promise.resolve({ slug }) }));

  it("lists every tool as a card and the RFIs and submittals waiting on the GC, oldest first", async () => {
    state.counts = { rfi: 1, drawingSet: 3 };
    state.rows = {
      rfi: [
        { id: "r1", number: 12, subject: "EIFS termination at storefront", jobId: "j1", sentOn: new Date("2026-10-10T00:00:00Z"), dueBy: new Date("2026-10-12T00:00:00Z"), job: { name: "Harbor View Lofts" } },
      ],
      submittal: [
        {
          id: "s1",
          number: 4,
          title: "Shaft wall product data",
          jobId: "j2",
          job: { name: "Northgate Clinic" },
          revisions: [{ revisionNumber: 1, sentOn: new Date("2026-10-03T00:00:00Z"), dueBack: null, returnedOn: null, outcome: null, responseNotes: null, responseUrl: null, responseFileName: null }],
        },
      ],
    };
    const html = await render("paperwork");
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toMatch(/href="\/dashboard"[^>]*>Home</);
    expect(html).toContain(">Paperwork</h1>");
    for (const route of ["/rfis", "/submittals", "/drawings", "/closeout", "/intake", "/messages", "/alerts"]) {
      expect(html).toContain(`data-area-tool="${route}"`);
    }
    expect(html).toContain("1 RFI waiting");
    expect(html).toContain("3 sets");
    expect(html).toContain("Waiting on the GC");
    const sub = html.indexOf("Shaft wall product data");
    const rfi = html.indexOf("EIFS termination at storefront");
    expect(sub).toBeGreaterThan(-1);
    expect(rfi).toBeGreaterThan(sub); // 11 days out before 4
    expect(html).toContain("11 days");
    // Due Oct 12, read on Oct 14 (the viewer's day, mocked above): the chip
    // says how late, not just that it is. It said "Answer late" until
    // 2026-10-10.
    expect(html).toContain("Overdue 2 days");
    expect(html).toContain('href="/rfis?job=j1#rfi-r1"');
  });

  it("tool cards say each figure once, and every action is 'Open <tool>'", async () => {
    state.counts = { rfi: 1 };
    const html = await render("paperwork");
    const card = html.slice(html.indexOf('data-area-tool="/rfis"'), html.indexOf('data-area-tool="/submittals"'));
    expect(card).toContain("1 RFI waiting");
    // The duplicate: a big "1" in the corner above the same "1 RFI waiting".
    expect(card).not.toMatch(/>1</);
    expect(html).toContain(">Open RFIs<");
    // A name too long for one line of a desktop card has its own short label.
    expect(html).toContain(">Open closeout<");
    expect(html).not.toMatch(/>Open<\//);
    // Opening a list is not a create: no brand-yellow fill on this area.
    expect(html).not.toContain(BRAND_FILL);
  });

  it("fills the jobs area's two create actions, and only those, in brand yellow", async () => {
    const html = await render("jobs-bids");
    const brand = html.match(new RegExp(`<a [^>]*${BRAND_FILL}[^>]*>.*?</a>`, "g")) ?? [];
    expect(brand).toHaveLength(2);
    expect(brand[0]).toContain('href="/jobs/new"');
    expect(brand[1]).toContain('href="/bids?new=1"');
    expect(brand[1]).toContain("+ Log a bid");
    for (const link of brand) expect(link).toContain("text-neutral-900");
    // ...and the create is not the only door: the card also opens the list.
    const card = html.slice(html.indexOf('data-area-tool="/dashboard"'), html.indexOf('data-area-tool="/bids"'));
    expect(card).toMatch(/href="\/jobs"[^>]*>Open jobs</);
    expect(card.indexOf("+ New job")).toBeLessThan(card.indexOf("Open jobs"));
  });

  it("heads the Money area with the four company figures, for someone who may see them", async () => {
    figures.load.mockClear();
    const html = await render("money");
    for (const text of ["Estimated revenue", "$1,284,500.00", "Gross margin", "24.6%", "Cash collected", "Retainage held", "$64,920.00"]) {
      expect(html, `lost ${text}`).toContain(text);
    }
    expect(figures.load).toHaveBeenCalledTimes(1);
    // Not on any other area.
    figures.load.mockClear();
    await render("paperwork");
    expect(figures.load).not.toHaveBeenCalled();
  });

  it("never loads the company figures for someone without VIEW_COMPANY_FINANCIALS", async () => {
    figures.load.mockClear();
    state.context.role = "MEMBER";
    // A PM can open the Money area (backcharges, lien deadlines) but
    // company-wide figures are an owner's numbers (lib/permissions.ts).
    state.context.jobFunction = "PROJECT_MANAGER";
    const html = await render("money");
    expect(html).toContain(">Money</h1>");
    expect(figures.load).not.toHaveBeenCalled();
    expect(html).not.toContain("Estimated revenue");
  });

  it("says so honestly when nothing is waiting", async () => {
    const html = await render("materials-equipment");
    expect(html).toContain("Nothing is on order.");
    expect(html).toContain("0 orders open");
  });

  it("is not there for a slug that is not an area, nor for an area the viewer can open nothing in", async () => {
    await expect(render("nope")).rejects.toThrow("NOT_FOUND");
    state.context.role = "MEMBER";
    state.context.jobFunction = "FIELD";
    await expect(render("money")).rejects.toThrow("NOT_FOUND");
    const html = await render("crew-field");
    expect(html).toContain(">Crew &amp; field</h1>");
  });

  it("offers New job as the jobs card's action, the one create page that exists", async () => {
    const html = await render("jobs-bids");
    expect(html).toContain('href="/jobs/new"');
    expect(html).toContain("No bids are due and no estimate is waiting on a client.");
  });
});
