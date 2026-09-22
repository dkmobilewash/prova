/**
 * A craft picker with nothing to pick says where classifications come from.
 *
 * Found on a preview: the job's time-entry and dispatch "Craft
 * classification" pickers could only offer "No craft tag", and nothing said
 * that classifications exist, that an untagged hour cannot be priced for
 * fringe, or where they are set up — the "Locals, classifications and rates"
 * section at the bottom of /union-compliance.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions", () => ({ uploadDispatchSlip: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { TimeEntryFields } = await import("./TimeEntryFields");
const { DispatchSlipForm } = await import("./DispatchSlipForm");

const SETUP_LINK = 'href="/union-compliance#setup"';
const craft = { id: "c1", label: "IUPAT 9 — Taper journeyman" };

describe("the time-entry craft picker", () => {
  const render = (craftOptions: { id: string; label: string }[]) =>
    renderToStaticMarkup(
      createElement(TimeEntryFields, { workers: [{ value: "crew:1", label: "Luis Ortega (crew)" }], lineItems: [], craftOptions }),
    );

  it("with no classifications, links to where they are set up", () => {
    const html = render([]);
    expect(html).toContain("No craft classifications yet");
    expect(html).toContain(SETUP_LINK);
  });

  it("with classifications, says nothing extra", () => {
    expect(render([craft])).not.toContain(SETUP_LINK);
  });
});

describe("the dispatch craft picker", () => {
  const render = (crafts: { id: string; label: string }[]) =>
    renderToStaticMarkup(createElement(DispatchSlipForm, { jobId: "j1", employees: [], crafts }));

  it("with no classifications, links to where they are set up", () => {
    expect(render([])).toContain(SETUP_LINK);
  });

  it("with classifications, says nothing extra", () => {
    expect(render([craft])).not.toContain(SETUP_LINK);
  });
});

describe("/union-compliance", () => {
  const page = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../app/(app)/union-compliance/page.tsx"),
    "utf8",
  );

  it("the setup section carries the id every hint links to", () => {
    expect(page).toMatch(/<section id="setup"[^>]*data-tour="uc-setup"/);
  });

  it("with no classifications, a Start here pointer sits ABOVE the first section that says nothing", () => {
    const pointer = page.indexOf("Start here: add your local");
    const firstSection = page.indexOf('data-tour="uc-remittance"');
    expect(pointer).toBeGreaterThan(-1);
    expect(pointer).toBeLessThan(firstSection);
    expect(page).toMatch(/\{crafts\.length === 0 && \(/);
    expect(page).toContain('href="#setup"');
  });
});
