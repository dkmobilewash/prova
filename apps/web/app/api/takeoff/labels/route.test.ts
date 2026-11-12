import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { labelSheetKey } from "@/lib/takeoff/labelRows";

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => ({ companyId: "c" }) }));

import { GET, POST } from "./route";

/**
 * Labels are keyed by the sheet NUMBER. Since sheet naming learned titles the
 * workspace sent "A101 · FLOOR PLAN", so Baker A101's saved labels loaded as
 * nothing and a save would have written a near-empty second file beside them.
 */
describe("labelSheetKey", () => {
  it("is the sheet number, never the title", () => {
    expect(labelSheetKey("A101 · FLOOR PLAN")).toBe("A101");
    expect(labelSheetKey("A101")).toBe("A101");
    expect(labelSheetKey("p13")).toBe("p13");
    expect(labelSheetKey("A-1.01 · FIRST FLOOR · PLAN")).toBe("A-1.01");
  });
});

describe("the labels route keys files by the sheet number", () => {
  let dir: string;
  const saved = { verdicts: [{ candidateId: "w1", verdict: "accepted" }], rows: [] };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "labels-route-"));
    vi.stubEnv("TAKEOFF_LABEL_DIR", dir);
    vi.stubEnv("NODE_ENV", "development");
    mkdirSync(join(dir, "Baker"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });
  const get = (sheet: string) =>
    GET(new Request(`http://x/api/takeoff/labels?set=Baker&sheet=${encodeURIComponent(sheet)}`));

  it("a titled sheet loads the existing A101.json", async () => {
    writeFileSync(join(dir, "Baker", "A101.json"), JSON.stringify(saved));
    const body = await (await get("A101 · FLOOR PLAN")).json();
    expect(body.saved).toEqual(saved);
  });

  it("reads a legacy title-keyed file when no number-keyed one exists", async () => {
    writeFileSync(join(dir, "Baker", "A101_FLOOR_PLAN.json"), JSON.stringify(saved));
    const body = await (await get("A101 · FLOOR PLAN")).json();
    expect(body.saved).toEqual(saved);
  });

  it("a save from a titled sheet writes A101.json and never a title-keyed file", async () => {
    writeFileSync(join(dir, "Baker", "A101_FLOOR_PLAN.json"), JSON.stringify(saved));
    const response = await POST(
      new Request("http://x/api/takeoff/labels", {
        method: "POST",
        body: JSON.stringify({ set: "Baker", sheet: "A101 · FLOOR PLAN", candidates: [], verdicts: [] }),
      }),
    );
    expect((await response.json()).ok).toBe(true);
    expect(readdirSync(join(dir, "Baker")).sort()).toEqual(["A101.json", "A101_FLOOR_PLAN.json"]);
    expect(JSON.parse(readFileSync(join(dir, "Baker", "A101_FLOOR_PLAN.json"), "utf8"))).toEqual(saved);
    expect(JSON.parse(readFileSync(join(dir, "Baker", "A101.json"), "utf8")).sheet).toBe("A101");
    expect(existsSync(join(dir, "Baker", "A101.json"))).toBe(true);
  });
});

/**
 * Sheets labelled before a number was read for their page were saved as
 * `p74.json`. Once the number appeared the page asked for "A-101", found
 * nothing, opened with 0 walls — and a save forked a second file.
 */
describe("a page-keyed label file still loads, and saves back to itself", () => {
  let dir: string;
  const saved = { sheet: "p74", page: 74, verdicts: [{ candidateId: "w1", verdict: "accepted" }], rows: [] };
  const other = { sheet: "A-101", page: 74, verdicts: [], rows: [] };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "labels-route-page-"));
    vi.stubEnv("TAKEOFF_LABEL_DIR", dir);
    vi.stubEnv("NODE_ENV", "development");
    mkdirSync(join(dir, "Topeka"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });
  const sheet = "A-101 · FIRST FLOOR PLAN";
  const get = (page?: number) =>
    GET(
      new Request(
        `http://x/api/takeoff/labels?set=Topeka&sheet=${encodeURIComponent(sheet)}` +
          (page === undefined ? "" : `&page=${page}`),
      ),
    );
  const post = (page?: number) =>
    POST(
      new Request("http://x/api/takeoff/labels", {
        method: "POST",
        body: JSON.stringify({
          set: "Topeka",
          sheet,
          ...(page === undefined ? {} : { page }),
          candidates: [],
          verdicts: [],
        }),
      }),
    );

  it("loads p74.json for a numbered sheet on page 74", async () => {
    writeFileSync(join(dir, "Topeka", "p74.json"), JSON.stringify(saved));
    expect((await (await get(74)).json()).saved).toEqual(saved);
  });

  it("a save writes p74.json back and creates no A-101.json", async () => {
    writeFileSync(join(dir, "Topeka", "p74.json"), JSON.stringify(saved));
    expect((await (await post(74)).json()).ok).toBe(true);
    expect(readdirSync(join(dir, "Topeka"))).toEqual(["p74.json"]);
    const written = JSON.parse(readFileSync(join(dir, "Topeka", "p74.json"), "utf8"));
    expect(written.sheet).toBe("p74");
    expect(written.page).toBe(74);
  });

  it("the number wins when both A-101.json and p74.json exist", async () => {
    writeFileSync(join(dir, "Topeka", "p74.json"), JSON.stringify(saved));
    writeFileSync(join(dir, "Topeka", "A-101.json"), JSON.stringify(other));
    expect((await (await get(74)).json()).saved).toEqual(other);
    expect((await (await post(74)).json()).ok).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "Topeka", "p74.json"), "utf8"))).toEqual(saved);
  });

  it("with no page in the request, behaves as before: number only, p74 unseen", async () => {
    writeFileSync(join(dir, "Topeka", "p74.json"), JSON.stringify(saved));
    expect((await (await get()).json()).saved).toBeNull();
    expect((await (await post()).json()).ok).toBe(true);
    expect(readdirSync(join(dir, "Topeka")).sort()).toEqual(["A-101.json", "p74.json"]);
    expect(JSON.parse(readFileSync(join(dir, "Topeka", "A-101.json"), "utf8")).sheet).toBe("A-101");
  });

  it("the overwrite guard reads the page-keyed file it would replace", async () => {
    const big = { ...saved, verdicts: Array.from({ length: 30 }, (_, i) => ({ candidateId: `w${i}` })) };
    writeFileSync(join(dir, "Topeka", "p74.json"), JSON.stringify(big));
    expect((await post(74)).status).toBe(409);
  });
});

/**
 * "Saved 164" while the file held 163 (Bluetooth AI101, Chrome 2026-11-11): the count on screen was
 * the browser's sum of what it sent. The route now says how many verdicts it wrote — new work and
 * the hidden decisions carried, together — and that is the number shown.
 */
describe("a save says how many verdicts the file holds", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "labels-count-"));
    vi.stubEnv("TAKEOFF_LABEL_DIR", dir);
    vi.stubEnv("NODE_ENV", "development");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });
  const v = (x: number, verdict: string) => ({ x1: x, y1: 0, x2: x + 0.1, y2: 0, lengthFeet: 10, thicknessFeet: 0.4, verdict });

  it("new verdicts, traces and carried ones: the count is the file's verdicts", async () => {
    const response = await POST(
      new Request("http://x/api/takeoff/labels", {
        method: "POST",
        body: JSON.stringify({
          set: "Bluetooth",
          sheet: "AI101",
          page: 6,
          candidates: [],
          verdicts: [v(0, "wall"), v(0.2, "not-wall"), v(0.4, "traced")],
          carried: [{ ...v(0.6, "not-wall"), finderVersion: "abc" }, v(0.8, "wall")],
        }),
      }),
    );
    const body = await response.json();
    const file = JSON.parse(readFileSync(join(dir, "Bluetooth", "AI101.json"), "utf8"));
    expect(file.verdicts).toHaveLength(5);
    expect(body.verdicts).toBe(file.verdicts.length);
  });
});
