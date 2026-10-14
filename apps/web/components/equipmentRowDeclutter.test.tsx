import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * /equipment after the declutter pass (density audit #33: eight 110px cards
 * with 4-5 buttons each). A piece now reads as two lines — name · type · ID
 * with Edit/Remove, then where · utilisation with Send out / History — and
 * every action stays a plain visible button (keyboard and touch reach it).
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/actions", () => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : vi.fn()) }));

const { EquipmentRow } = await import("@/components/EquipmentRow");
const { EquipmentDeploymentControls } = await import("@/components/EquipmentDeploymentControls");

describe("an equipment row", () => {
  it("puts name, type and ID on one line", () => {
    const html = renderToStaticMarkup(
      <EquipmentRow canDelete item={{ id: "e-1", name: "Scissor lift", type: "Lift", assetTag: "SL-2", notes: null }} />,
    );
    expect(html).toMatch(/<p[^>]*><span[^>]*>Scissor lift<\/span><span[^>]*> · Lift · SL-2<\/span><\/p>/);
    expect(html).toContain(">Edit</button>");
  });

  it("puts the where line on the same line as Send out and History", () => {
    const html = renderToStaticMarkup(
      <EquipmentDeploymentControls
        equipmentId="e-1"
        jobs={[{ id: "job-1", name: "Riverside", clientName: "Turner", status: "IN_PROGRESS" }]}
        history={[]}
        today="2026-10-14"
        canDelete={false}
        lead={<p data-tour="equipment-where">In the yard</p>}
      />,
    );
    const row = html.match(/^<div[^>]*><div class="flex flex-wrap items-center justify-between gap-2">([\s\S]*?)<\/div><\/div>/)?.[1] ?? "";
    expect(row).toContain('data-tour="equipment-where"');
    expect(row).toContain(">Send out to a job</button>");
  });

  it("is wired on the page: the where line goes in as the lead", () => {
    const page = readFileSync(new URL("../app/(app)/equipment/page.tsx", import.meta.url), "utf8");
    const lead = page.indexOf("lead={");
    expect(lead).toBeGreaterThan(page.indexOf("<EquipmentDeploymentControls"));
    expect(page.indexOf('data-tour="equipment-where"')).toBeGreaterThan(lead);
    expect(page.split('data-tour="equipment-where"').length - 1).toBe(1);
  });
});
