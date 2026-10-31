import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const viewer = readFileSync(new URL("./TakeoffPlanViewer.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./TakeoffWorkspace.tsx", import.meta.url), "utf8");

// The rail starts closed below 1440 and the rooms and doors panels live in it,
// so a Find that does not open it ends with nothing on screen. Chrome found
// that on the click test. This proves the wiring; only a browser proves the panel shows.
describe("a Find opens the results rail", () => {
  it("both Finds report back, and the workspace opens the rail on it", () => {
    expect(viewer.match(/onResults\?\.\(\)/g)).toHaveLength(2);
    expect(viewer).toMatch(/if \(!quietFind\.current\) onResults\?\.\(\)/);
    expect(workspace).toMatch(/onResults=\{onResults\}/);
    expect(workspace).toMatch(/const onResults = useCallback\(\(\) => setPanelOpen\(true\)/);
  });
});

// Chrome: while a tool was active, Undo, Redo and Clear ignored the first click,
// and Clear took three. No test here can click through a backdrop, so these pin
// the three causes; only a browser proves the click lands.
describe("one click always works", () => {
  it("the re-find after an exclusion does not open the rail", () => {
    expect(viewer).toMatch(/quietFind\.current = true;\s+try \{\s+await findRef\.current\(\);/);
  });
  it("the quantities drawer lays no backdrop over the page, and leaves the top bar clear", () => {
    expect(workspace).toMatch(/\{\(sheetsOpen \|\| itemsOpen\) && \(\s+<button\s+type="button"\s+aria-label="Close the panels"/);
    expect(workspace).toContain("[&_[data-takeoff=found-walls]]:top-11");
  });
  it("Undo is available before the re-find, and a Find does not hold it greyed", () => {
    expect(viewer.indexOf("exclusionUndoEntry(row, {")).toBeLessThan(viewer.indexOf("await afterExclusionChange(saved,"));
    expect(viewer).toMatch(/if \(here\(\)\) void afterExclusionChange\(/);
  });
  it("re-finds run one at a time, in order", () => {
    expect(viewer).toMatch(/findQueue\.current = findQueue\.current\.then\(/);
  });
});
