import { describe, expect, it } from "vitest";
import type { Principal } from "@/lib/permissions";
import { ROUTE_CAPABILITY } from "@/lib/permissions";
import { reachableWalkthroughs, searchAppHelp } from "./appHelp";
import { WALKTHROUGHS } from "@/lib/walkthroughs";
import { HANDLERS, runTool } from "./handlers";

const OWNER: Principal = { role: "OWNER", jobFunction: null };
const FIELD: Principal = { role: "MEMBER", jobFunction: "FIELD" };
const ACCOUNTING: Principal = { role: "MEMBER", jobFunction: "ACCOUNTING" };

describe("searchAppHelp — the index picks the right page", () => {
  it("finds the backcharges walkthrough for 'log a backcharge'", () => {
    const matches = searchAppHelp("how do I log a backcharge?");
    expect(matches[0]?.route).toBe("/backcharges");
  });

  it("finds punch lists for 'add a punch list item', ahead of anything else", () => {
    const matches = searchAppHelp("where do I add a punch list item?");
    expect(matches[0]?.route).toBe("/punch-lists");
  });

  it("finds where QuickBooks is actually connected for 'connect QuickBooks' — /settings, not the integrations page that only points there", () => {
    // /settings/integrations SAYS "QuickBooks is set up from Settings —
    // press Manage in Settings on its card"; /settings has the actual
    // "Press Connect QuickBooks" step. The stronger match is correct.
    const matches = searchAppHelp("how do I connect QuickBooks?");
    expect(matches[0]?.route).toBe("/settings");
  });

  it("finds lien deadlines for 'record a lien deadline'", () => {
    const matches = searchAppHelp("how do I record a lien deadline?");
    expect(matches[0]?.route).toBe("/lien-deadlines");
  });

  it("returns nothing for a query that is only stop words", () => {
    // "how do I" alone carries no real term to search on — must not fall
    // back to returning every page, which would read as an answer to
    // nothing being asked.
    expect(searchAppHelp("how do I")).toEqual([]);
    expect(searchAppHelp("")).toEqual([]);
  });

  it("returns nothing for a topic that matches no page", () => {
    expect(searchAppHelp("recalibrate the flux capacitor")).toEqual([]);
  });

  it("is case-insensitive", () => {
    const matches = searchAppHelp("BACKCHARGE");
    expect(matches[0]?.route).toBe("/backcharges");
  });

  it("only searches the candidates it is given, never the full registry underneath them", () => {
    // The half `reachableWalkthroughs` depends on: a page filtered OUT
    // before this runs must not still be findable by score.
    const withoutBackcharges = WALKTHROUGHS.filter((w) => w.route !== "/backcharges");
    expect(searchAppHelp("log a backcharge", withoutBackcharges)).toEqual([]);
  });

  it("carries the walkthrough's own steps through untouched, for the model to quote", () => {
    const [top] = searchAppHelp("log a backcharge");
    const real = WALKTHROUGHS.find((w) => w.route === "/backcharges")!;
    expect(top.title).toBe(real.title);
    expect(top.steps).toEqual(real.steps.map((s) => ({ title: s.title, body: s.body })));
  });
});

describe("reachableWalkthroughs — capability filtering", () => {
  it("gives an OWNER every walkthrough in the registry", () => {
    expect(reachableWalkthroughs(OWNER)).toHaveLength(WALKTHROUGHS.length);
  });

  it("withholds every guarded page a FIELD member cannot open", () => {
    const routes = new Set(reachableWalkthroughs(FIELD).map((w) => w.route));
    for (const [route, capability] of Object.entries(ROUTE_CAPABILITY)) {
      const walkthroughExists = WALKTHROUGHS.some((w) => w.route === route);
      if (!walkthroughExists) continue;
      const fieldHasIt = capability === "MANAGE_FIELD" || capability === "MANAGE_JOBS";
      expect(routes.has(route), `${route} (${capability})`).toBe(fieldHasIt);
    }
  });

  it("names the specific billing pages a FIELD member must not be taught — the case this tool exists to get right", () => {
    const routes = new Set(reachableWalkthroughs(FIELD).map((w) => w.route));
    expect(routes.has("/backcharges")).toBe(false);
    expect(routes.has("/lien-deadlines")).toBe(false);
    expect(routes.has("/cash-flow")).toBe(false);
    // And what FIELD keeps: its own capabilities, MANAGE_FIELD and
    // MANAGE_JOBS, plus every open page.
    expect(routes.has("/punch-lists")).toBe(true);
    expect(routes.has("/rfis")).toBe(true);
    expect(routes.has("/dashboard")).toBe(true);
  });

  it("gives ACCOUNTING the billing pages FIELD does not get", () => {
    const routes = new Set(reachableWalkthroughs(ACCOUNTING).map((w) => w.route));
    expect(routes.has("/backcharges")).toBe(true);
    expect(routes.has("/lien-deadlines")).toBe(true);
    // ACCOUNTING holds no MANAGE_FIELD or MANAGE_ESTIMATING.
    expect(routes.has("/punch-lists")).toBe(false);
    expect(routes.has("/bids")).toBe(false);
  });

  it("treats a dynamic route ([id]) as open, the same as capabilityForRoute does for every other guard", () => {
    const routes = new Set(reachableWalkthroughs(FIELD).map((w) => w.route));
    expect(routes.has("/jobs/[id]")).toBe(true);
  });
});

describe("app_help end to end — the handler a FIELD member actually calls", () => {
  const field = { companyId: "co_1", principal: FIELD };
  const accounting = { companyId: "co_1", principal: ACCOUNTING };

  it("a FIELD member asking how to log a backcharge is not taught the page", async () => {
    const result = await runTool(field, "app_help", { topic: "log a backcharge" });
    expect(result.data).toEqual({ pages: [] });
    expect(result.unavailable).toContain("Nothing in the app's own walkthroughs matches");
    // Never a citation to a page this person cannot open.
    expect(result.citations.every((c) => c.href !== "/backcharges")).toBe(true);
  });

  it("the SAME question answers for someone who can open the billing page", async () => {
    const result = await runTool(accounting, "app_help", { topic: "log a backcharge" });
    const pages = (result.data as { pages: { route: string }[] }).pages;
    expect(pages[0]?.route).toBe("/backcharges");
    expect(result.citations.some((c) => c.href === "/backcharges")).toBe(true);
  });

  it("a FIELD member CAN be taught a page inside their own access", async () => {
    const result = await runTool(field, "app_help", { topic: "add a punch list item" });
    const pages = (result.data as { pages: { route: string }[] }).pages;
    expect(pages[0]?.route).toBe("/punch-lists");
  });

  it("with no topic, asks what they're trying to do rather than dumping every page", async () => {
    const result = await runTool(field, "app_help", {});
    expect(result.data).toBeNull();
    expect(result.unavailable).toContain("Say what you're trying to do");
  });

  it("with no actor at all, is at least as narrow as the narrowest real person — never the widest", async () => {
    // Punch lists needs MANAGE_FIELD, so with no actor to check even that
    // is withheld: the "no actor" rule opens only pages with NO capability
    // at all, narrower than even a FIELD member gets.
    const noActorResult = await HANDLERS.app_help("co_1", { topic: "log a backcharge" });
    expect((noActorResult.data as { pages: unknown[] } | null)?.pages ?? []).toEqual([]);
    // But an OPEN page — no ROUTE_CAPABILITY entry at all — still answers.
    const openResult = await HANDLERS.app_help("co_1", { topic: "put someone on the schedule" });
    const pages = (openResult.data as { pages: { route: string }[] } | null)?.pages ?? [];
    expect(pages[0]?.route).toBe("/schedule");
  });
});
