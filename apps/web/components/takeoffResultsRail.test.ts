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
    expect(workspace).toMatch(/onResults=\{onResults\}/);
    expect(workspace).toMatch(/const onResults = useCallback\(\(\) => setPanelOpen\(true\)/);
  });
});
