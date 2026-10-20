import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { labelFile, type LabelCandidate, type LabelVerdict } from "./labelRows";

/**
 * ── THE SIZE OF A FINISHED SHEET ──
 *
 * Bunkie A100 could not be saved: "The request body was not JSON". The body
 * was 11.27 MB, the route handler's middleware truncates at 10 MB, and
 * `request.json()` threw on half a document. The message named the symptom
 * and not the cause, and a reviewer's finished sheet sat in a tab for it.
 *
 * Measured, not guessed — `zzPayload.eval.ts` rebuilt that sheet with the
 * finder:
 *
 *     runs shown to the reviewer :      56
 *     PAIRINGS sent with the save :  39,952
 *     features per pairing        :      24
 *     body                        :   11.27 MB
 *
 * The gap between the first two numbers is the whole thing. A reviewer judges
 * RUNS; a model decides about PAIRINGS, so every pairing travels with its
 * feature vector. A hatch-heavy sheet has hundreds of pairings per run and
 * nothing on screen suggests it.
 *
 * These cases are about the SHAPE being handled, at that size, without the
 * server. The limit itself lives in `next.config.mjs` and is checked below by
 * reading it, because a comment claiming a limit is not a limit.
 */
const PAIRINGS = 39_952;
const FEATURES = 24;

/** A body the same shape and size as the one that failed. */
function bunkieSized(): { candidates: LabelCandidate[]; verdicts: LabelVerdict[] } {
  const candidates: LabelCandidate[] = [];
  for (let i = 0; i < PAIRINGS; i += 1) {
    candidates.push({
      x1: 0.1 + (i % 100) / 10_000,
      y1: 0.2,
      x2: 0.3 + (i % 100) / 10_000,
      y2: 0.2,
      lengthFeet: 12.5,
      thicknessFeet: 0.5,
      // Real feature vectors are fractions with long decimal expansions,
      // which is most of the payload — round numbers would understate it by
      // a factor of three and make this test pass on a body the server would
      // still refuse.
      features: Array.from({ length: FEATURES }, (_, f) => (i * 31 + f) / 7919),
    });
  }
  return {
    candidates,
    verdicts: [
      {
        x1: 0.1,
        y1: 0.2,
        x2: 0.3,
        y2: 0.2,
        lengthFeet: 12.5,
        thicknessFeet: 0.5,
        verdict: "wall",
      },
    ],
  };
}

describe("a save body the size of a hatch-heavy sheet", () => {
  it("IS over 10 MB, which is the whole defect", () => {
    const { candidates, verdicts } = bunkieSized();
    const body = JSON.stringify({
      set: "BUNKIE-BID-DRAWINGS.pdf",
      sheet: "A100",
      page: 31,
      reviewedBy: "AI-Claude-Chrome",
      feetPerUnit: 168,
      secondsSpent: 600,
      reviewComplete: true,
      unreviewed: 0,
      candidates,
      verdicts,
    });
    const megabytes = Buffer.byteLength(body) / (1024 * 1024);
    expect(megabytes, "the fixture no longer reproduces the size").toBeGreaterThan(10);
    // And it is JSON, so the body was never malformed at the source — the
    // truncation made it so.
    expect(() => JSON.parse(body)).not.toThrow();
  });

  it("the configured limit leaves room for it", () => {
    // Reading the config rather than trusting a comment about it. A limit
    // that drifts back below the measured worst case fails here rather than
    // in a tab with somebody's afternoon in it.
    const config = readFileSync(join(process.cwd(), "next.config.mjs"), "utf8");
    const found = /middlewareClientMaxBodySize:\s*"(\d+)mb"/.exec(config);
    expect(found, "middlewareClientMaxBodySize is not set in next.config.mjs").not.toBeNull();
    expect(Number(found?.[1] ?? 0), "the limit is below the 11.27 MB sheet that failed").toBeGreaterThan(
      12,
    );
  });

  it("turns that many pairings into a file without choking", () => {
    // The server's own work, at the real size: 39,952 pairings against one
    // accepted run. If `labelRows` were quadratic in the pairing count this
    // is where it would show.
    const { candidates, verdicts } = bunkieSized();
    const file = labelFile({
      set: "BUNKIE-BID-DRAWINGS.pdf",
      sheet: "A100",
      page: 31,
      reviewedBy: "AI-Claude-Chrome",
      secondsSpent: 600,
      feetPerUnit: 168,
      reviewComplete: true,
      candidates,
      verdicts,
      unreviewed: 0,
    });
    expect(file.counts.accepted).toBe(1);
    expect(file.rows.length).toBeGreaterThan(0);
    // Every row is a real pairing, not a placeholder.
    expect(file.rows.every((r) => r.features.length === FEATURES)).toBe(true);
  }, 120_000);
});
