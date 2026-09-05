import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

/** The equipment page wraps every piece in an `<li>`. EquipmentRow opened a
 * SECOND one inside it, and the HTML parser resolves `<li>` inside `<li>` by
 * closing the outer one — so the DOM the browser builds is not the tree
 * React expects, and hydration breaks. Typecheck, lint and 400-odd unit
 * tests all stayed green about it, because none of them had ever produced
 * the markup. Issue #149.
 *
 * So this file renders the component and reads the string. It is the only
 * test in this app that does; it exists because the defect is only visible
 * in output. */

// The row imports the server-action barrel purely to call it from a click.
// Nothing here clicks, and importing it for real would drag Prisma and Clerk
// into a suite whose whole point is that it needs neither.
vi.mock("@/lib/actions", () => ({
  deleteEquipment: vi.fn(),
  updateEquipment: vi.fn(),
}));

const { EquipmentRow } = await import("@/components/EquipmentRow");

const item = {
  id: "e1",
  name: "Genie S-45 boom lift",
  type: "Lift",
  assetTag: "EQ-014",
  notes: "Service due in March",
};

describe("EquipmentRow markup", () => {
  it("does not open a list item — the page it sits in already did", () => {
    const html = renderToStaticMarkup(createElement(EquipmentRow, { canDelete: true, item }));
    expect(html).not.toContain("<li");
    // Sanity that we rendered the row at all and are not asserting about an
    // empty string, which would pass this for the wrong reason.
    expect(html).toContain("Genie S-45 boom lift");
  });

  it("still says nothing about where the piece is", () => {
    // The page prints the location once, with the utilisation figure, from
    // the same derived value. Two lines from one fact read as two facts.
    const html = renderToStaticMarkup(createElement(EquipmentRow, { canDelete: true, item }));
    expect(html).not.toContain("In the yard");
    expect(html).not.toContain("On ");
  });

  it("has no <li> in EITHER branch, including the one only a click reaches", () => {
    // The inline edit form is behind `isEditing`, so no server render can
    // reach it and the assertion above cannot cover it. Reading the source
    // does — and it is the production source, so putting the tag back turns
    // this red.
    const source = readFileSync(
      fileURLToPath(new URL("./EquipmentRow.tsx", import.meta.url)),
      "utf8",
    );
    // Comments stripped first: the docstring in that file has to be able to
    // NAME the tag it is warning about.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/<li[\s>]/);
    // The strip must not have eaten the component itself.
    expect(code).toContain("export function EquipmentRow");
  });
});
