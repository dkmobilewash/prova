import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_FOOTER, NAV_ITEMS } from "@/components/navItems";
import { AREAS, NOT_IN_AN_AREA, areaBySlug, areasFor, toolRoute } from "./areas";
import { JOB_FUNCTIONS, canReach, type Principal } from "./permissions";
import { toolActions } from "@/components/areas/AreaParts";

/**
 * The six areas are the home page's map of the app. These pin that the map
 * is complete (every nav destination is in exactly one area or has a written
 * reason not to be) and that it never shows a door the viewer cannot open.
 * The nav set is DERIVED from NAV_ITEMS, so a new nav entry with no area
 * fails here rather than becoming a page nobody can find.
 */

const navHrefs = [...new Set([...NAV_ITEMS, ...NAV_FOOTER].map((item) => item.href))];
const placed = AREAS.flatMap((area) => area.tools.map((tool) => ({ area: area.slug, route: toolRoute(tool) })));

const principals: Principal[] = [
  { role: "OWNER", jobFunction: null },
  { role: "MEMBER", jobFunction: null },
  ...JOB_FUNCTIONS.map((jobFunction) => ({ role: "MEMBER" as const, jobFunction })),
];

describe("areas", () => {
  it("reads a real nav list (a census over nothing passes everything)", () => {
    expect(navHrefs.length).toBeGreaterThanOrEqual(35);
    expect(AREAS).toHaveLength(6);
  });

  it("files every nav destination in exactly one area, or names why not", () => {
    for (const href of navHrefs) {
      const homes = placed.filter((p) => p.route === href).map((p) => p.area);
      if (href in NOT_IN_AN_AREA) {
        expect(homes, `${href} is excluded and also in ${homes.join(", ")}`).toEqual([]);
      } else {
        expect(homes, `${href} must be in exactly one area`).toHaveLength(1);
      }
    }
  });

  it("offers only real nav destinations, and every exclusion is a real one", () => {
    for (const p of placed) expect(navHrefs, p.route).toContain(p.route);
    for (const href of Object.keys(NOT_IN_AN_AREA)) expect(navHrefs, href).toContain(href);
  });

  it("builds every headline from the area's own tools", () => {
    for (const area of AREAS) {
      for (const href of area.headline) expect(area.tools.map(toolRoute), `${area.slug} ${href}`).toContain(href);
    }
  });

  it("never shows a tool the viewer cannot open, for every job function", () => {
    for (const principal of principals) {
      for (const area of areasFor(principal)) {
        expect(area.tools.length).toBeGreaterThan(0);
        for (const tool of area.tools) expect(canReach(principal, toolRoute(tool)), `${principal.jobFunction} ${tool.href}`).toBe(true);
      }
    }
  });

  it("keeps every tool the viewer CAN open (filtering is not dropping)", () => {
    for (const principal of principals) {
      const shown = new Set(areasFor(principal).flatMap((a) => a.tools.map(toolRoute)));
      for (const p of placed) if (canReach(principal, p.route)) expect(shown.has(p.route), `${principal.jobFunction} ${p.route}`).toBe(true);
    }
  });

  it("hides an area with nothing the viewer can open", () => {
    // FIELD holds neither company financials nor billing, so every Money
    // page refuses them — the box must not be there at all.
    const field: Principal = { role: "MEMBER", jobFunction: "FIELD" };
    expect(areaBySlug("money")!.tools.every((t) => !canReach(field, toolRoute(t)))).toBe(true);
    expect(areasFor(field).map((a) => a.slug)).not.toContain("money");
    expect(areasFor({ role: "OWNER", jobFunction: null }).map((a) => a.slug)).toEqual(AREAS.map((a) => a.slug));
  });

  // A tool card's button is never cut short: "Open Closeout & …" at 1555px
  // (2026-10-11). A character count stands in for a pixel width because
  // happy-dom does no layout, so both ceilings are MEASURED in Chromium at
  // 1280-1600, not round numbers. The card is narrowest (158px button) in
  // an area of six or more tools, where "Open Field reports" (18) fits with
  // 7px to spare and "Open Document intake" (20) was cut; with five or
  // fewer the button is 200px+ and "Open Work in progress" (21) fits.
  it("keeps every tool card's button label short enough for its card", () => {
    const labels = AREAS.flatMap((area) => area.tools.flatMap((tool) => toolActions({ ...tool, route: toolRoute(tool) }).map((a) => ({ area, label: a.label }))));
    // One per tool, plus Jobs' second ("+ New job" and "Open jobs").
    expect(labels.length).toBe(placed.length + 1);
    for (const { area, label } of labels) {
      const ceiling = area.tools.length >= 6 ? 18 : 21;
      expect(label.length, `${area.slug}: "${label}"`).toBeLessThanOrEqual(ceiling);
      expect(label, area.slug).not.toBe("Open");
    }
  });

  // UX review F5: /catalog was "Catalog" in the nav, "Price book" here and
  // "Line item catalog" on its own page; /dashboard was "Jobs & Estimates" in
  // the nav and "Jobs" here. One page, one name: the nav label IS the tool's.
  it("calls every page the same thing in the nav as in its area", () => {
    const navLabel = new Map(NAV_ITEMS.map((item) => [item.href, item.label]));
    const checked = AREAS.flatMap((area) => area.tools).filter((tool) => navLabel.has(toolRoute(tool)));
    expect(checked.length).toBe(placed.length);
    for (const tool of checked) expect(navLabel.get(toolRoute(tool)), toolRoute(tool)).toBe(tool.name);
  });

  it("leaves no screen using a retired name", () => {
    const root = path.resolve(__dirname, "..");
    const files = ["app", "components"].flatMap((dir) =>
      (fs.readdirSync(path.join(root, dir), { recursive: true }) as string[])
        .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
        .map((f) => path.join(root, dir, f)),
    );
    expect(files.length).toBeGreaterThan(200);
    const retired = ["Line item catalog", "Jobs & Estimates", "Jobs &amp; Estimates", ">Start a bid<"];
    const hits = files.flatMap((f) => retired.filter((r) => fs.readFileSync(f, "utf8").includes(r)).map((r) => `${path.relative(root, f)}: ${r}`));
    expect(hits).toEqual([]);
  });
});
