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
