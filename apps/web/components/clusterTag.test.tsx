// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ClusterTag } from "./TakeoffPlanViewer";

/**
 * THE ASSEMBLY NAME HAS TO BE ON THE SCREEN, not only in the state.
 *
 * A RENDER test, for the #665 reason: that PR shipped a control which existed,
 * called the right action, sat in the right branch and appeared on no screen
 * anybody used, with every census assertion true throughout.
 *
 * It renders `ClusterTag` directly because the group list it lives in only
 * exists after Find-the-walls has run, which needs pdf.js on a canvas that
 * never renders in happy-dom. Measured rather than assumed: a probe pressed Set
 * scale, then the port, then the SVG, and the sheet read "Drawing…" throughout.
 */

let host: HTMLElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function paint(names: string[]) {
  act(() => root.render(createElement(ClusterTag, { names })));
  return host;
}

describe("the assembly name on a thickness group", () => {
  it("IS ON THE SCREEN when the drawing tagged the group", () => {
    const node = paint(["A1"]).querySelector('[data-takeoff="cluster-tag"]');
    expect(node).not.toBeNull();
    expect(node?.textContent).toBe("A1");
  });

  it("shows several, as the key's own A1/A2 case needs", () => {
    // A1 and A2 both measure 4.75in on the answer key, so one thickness group
    // genuinely carries two assemblies. This is why the name is a list.
    expect(paint(["A1", "A2"]).querySelector('[data-takeoff="cluster-tag"]')?.textContent).toBe("A1 / A2");
  });

  it("RENDERS NOTHING for a group the drawing did not tag", () => {
    // The usual case — only 25-43% of footage is tagged. A badge on every group
    // would bury the real names, and an empty badge would read as a bug.
    expect(paint([]).querySelector('[data-takeoff="cluster-tag"]')).toBeNull();
    expect(paint([]).textContent).toBe("");
  });

  it("carries the sentence as a tooltip, so the badge can stay short", () => {
    const node = paint(["A1", "A2"]).querySelector('[data-takeoff="cluster-tag"]');
    expect(node?.getAttribute("title")).toBe("The drawing tags these A1 and A2.");
  });

  it("uses tokens, never an invented colour", () => {
    // `DESIGN.md` governs this and `colorTokenCensus.test.ts` enforces it; the
    // assertion is here so a later edit cannot quietly drop the class.
    const node = paint(["A1"]).querySelector('[data-takeoff="cluster-tag"]');
    expect(node?.className).toContain("bg-tag-slate");
    expect(node?.className).toContain("text-tag-slate-ink");
  });
});

/**
 * ── AND THAT THE PANEL ACTUALLY USES IT ──
 *
 * Found by mutation, not by thinking: gating the call site with `{false && …}`
 * left every test above GREEN. They render `ClusterTag` directly, so they prove
 * the component works and say nothing about anybody calling it. That is #665's
 * exact shape — the defect that PR shipped was a control which existed, was
 * correct, and appeared on no screen.
 *
 * So this reads the call site. It is a CENSUS and its limit is worth stating:
 * it proves the element is written into the group row un-disabled, and it
 * cannot prove the row itself renders. What makes that enough here, and would
 * not be enough for a framework option, is that this is React rendering its own
 * JSX in the same file — the group row is already proved by the panel it has
 * always drawn, and `takeoffWallFinder.test.tsx` covers the button that opens
 * it. See `wallTags.ts` for why the panel cannot be mounted in happy-dom.
 */
describe("the panel's own use of it", () => {
  /** The viewer, with comments STRIPPED — both this file and the component's
   *  own header print `<ClusterTag` in prose, so a raw-text search would find a
   *  call site that does not exist. */
  const source = (() => {
    const raw = readFileSync(resolve(__dirname, "TakeoffPlanViewer.tsx"), "utf8");
    return raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  })();

  it("PARSED SOMETHING — the size assertion, so a broken strip fails loudly", () => {
    // A census that reads an empty string passes every assertion below. This is
    // the other half of the rule: assert the SET you reasoned about is not empty
    // against something that cannot drift with the search itself.
    expect(source.length).toBeGreaterThan(20_000);
    expect(source).toContain("export function TakeoffPlanViewer");
  });

  it("RENDERS <ClusterTag> in the group row", () => {
    expect(source).toMatch(/<ClusterTag\s/);
  });

  it("DOES NOT DISABLE IT with a literal false, which is the mutation that got through", () => {
    expect(source).not.toMatch(/\{\s*false\s*&&\s*<ClusterTag/);
    expect(source).not.toMatch(/\{\s*null\s*&&\s*<ClusterTag/);
  });

  it("hands it the names for THIS group, not a constant", () => {
    // `names={[]}` would render nothing for ever and pass the test above.
    expect(source).toMatch(/<ClusterTag\s+names=\{tagNames\[index\]/);
  });

  it("and the detection fills those names", () => {
    // The other end of the wire: without this the array is empty for ever.
    //
    // UPDATED when the wall-type match landed. This asserted
    // `setTagNames(namesForClusters(` and the panel now derives both the names
    // and the match from ONE pass over the runs — `taggedFeetForClusters`,
    // which returns the footage per tag that `matchClusterToWallType` needs to
    // tell "mostly W1" from "half W1, half W2". `namesForClusters` is still the
    // reader for everything that only wants names.
    //
    // The INTENT is unchanged and is what this case is for: the names on
    // screen come from the detection rather than from a constant.
    expect(source).toMatch(/setTagNames\(taggedFeet\.map\(/);
    expect(source).toMatch(/taggedFeetForClusters\(/);
  });
});
