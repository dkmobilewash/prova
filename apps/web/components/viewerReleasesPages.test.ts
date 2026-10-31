import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A pdf.js page cannot be rendered in happy-dom, so this reads the source. The
 * measurement it protects is real Chromium: JS heap 704 MB without `cleanup`
 * and 80 MB with it after 60 sheets of Joplin. Comments are stripped, because the reason
 * is written beside the call and a comment must not satisfy the check.
 */
const source = readFileSync(resolve(process.cwd(), "components/TakeoffPlanViewer.tsx"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the viewer lets go of a page", () => {
  it("releases the page it draws, after the draw finishes", () => {
    const draw = source.indexOf("await task.promise;");
    expect(draw).toBeGreaterThan(0);
    expect(source.slice(draw, source.indexOf("catch (error)", draw))).toMatch(/page\.cleanup\(\)/);
  });
  it("releases each page of the walk across the set", () => {
    const walk = source.slice(source.indexOf("const searchAcrossSheets"), source.indexOf("const searchSymbols"));
    expect(walk.length).toBeGreaterThan(100);
    expect(walk).toMatch(/\.cleanup\(\)/);
  });
});
