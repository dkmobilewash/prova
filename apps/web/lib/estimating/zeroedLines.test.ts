// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ZeroedLinesNotice } from "@/components/ZeroedLinesNotice";
import { zeroedLinesSentence } from "./zeroedLinesWords";

/**
 * Order (e) (coordination/silent-estimate-sync.md). A4: every page or document a GC is shown reads its lines through
 * `GC_LINE_WHERE`, so a takeoff line at 0 never reaches them. A2: the notice says which priced lines are at 0.
 */
// happy-dom replaces the global URL, so the path is built with node:path.
const code = (path: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../..", path), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const GC_READERS = [
  "app/esign/[token]/page.tsx",
  "lib/actions/billing.ts",
  "lib/actions/docusign.ts",
  "app/(app)/jobs/[id]/proposal/page.tsx",
  "lib/portal-query.ts",
];

describe("A4: what a GC is shown", () => {
  for (const path of GC_READERS) {
    it(`${path} reads its lines through GC_LINE_WHERE`, () => {
      // Used, not merely imported: a mutation that bypassed it left the import line, and a bare name match stayed green.
      const used = code(path).replace(/^import [^;]*;$/gm, "");
      expect(used).toMatch(/(where: |\.\.\.)GC_LINE_WHERE\b/);
    });
  }
  it("names five readers (the census cannot shrink to nothing)", () => {
    expect(GC_READERS.length).toBe(5);
  });
});

describe("A2: the words", () => {
  it("one line, named with its price", () => {
    expect(zeroedLinesSentence([{ description: "W2 walls — runner track", unitPrice: "7" }])).toBe(
      "On the estimate at 0 ft, with the price you typed kept: W2 walls — runner track ($7.00). Its walls are gone from the takeoff.",
    );
  });
  it("more than three: three named and the rest counted", () => {
    const lines = ["a", "b", "c", "d", "e"].map((d) => ({ description: d, unitPrice: null }));
    expect(zeroedLinesSentence(lines)).toBe("On the estimate at 0 ft, with the price you typed kept: a (your cost); b (your cost); c (your cost), and 2 more. Their walls are gone from the takeoff.");
  });
  it("the notice renders the sentence and a way to the estimate, and nothing when there is nothing", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(createElement(ZeroedLinesNotice, { jobId: "j", lines: [] })));
    expect(host.innerHTML).toBe("");
    act(() => root.render(createElement(ZeroedLinesNotice, { jobId: "j", lines: [{ id: "l", description: "W2 walls — runner track", unitPrice: "7" }] })));
    expect(host.querySelector('[role="status"]')?.textContent).toContain("W2 walls — runner track ($7.00)");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/jobs/j/estimate");
  });
});
