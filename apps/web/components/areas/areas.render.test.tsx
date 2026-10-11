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

const { AreaBoxes } = await import("./AreaBoxes");
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
    expect(hrefs).toEqual(["/rfis", "/submittals", "/drawings", "/closeout", "/intake", "/messages", "/alerts", "/areas/paperwork"]);
    expect(panel.textContent).toContain("Open Paperwork →");
    expect(panel.textContent).toContain("2 RFIs waiting");

    // One at a time.
    act(() => box("Money").click());
    expect(box("Paperwork").getAttribute("aria-expanded")).toBe("false");
    expect(box("Money").getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll("[role='region']")).toHaveLength(1);
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
    expect(html).toContain("Answer late");
    expect(html).toContain('href="/rfis?job=j1"');
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
