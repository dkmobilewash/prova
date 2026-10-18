import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeLabels } from "@/lib/plan-ingest/labelStore";
import { labelFile } from "@/lib/takeoff/labelRows";
import { wallsFromStrokes } from "@/lib/takeoff/wallVectors";
import type { StrokeSegment } from "@/lib/takeoff/wallVectors";

/**
 * ── THE WHOLE LABELLING PATH, END TO END ──
 *
 * Finder → feature vectors → a reviewer's verdicts → `labelFile` → the file on
 * disk → read back → the verdicts are still attached to the right candidates.
 *
 * Every piece of this is tested on its own and the pieces were written weeks
 * apart, which is exactly the gap this file exists for: each one is green, and
 * none of them says the next one agrees about the SHAPE of what it receives.
 * The first run of it failed on precisely that — the panel spelled a rejection
 * `not-a-wall` and `LabelVerdict` spells it `not-wall`. The rows would still
 * have carried label 0, because `labelFile` tests for "wall" and treats
 * everything else as a negative, so the training data would have been correct
 * and only the summary counts wrong. Nobody reads those until the set is
 * built, which is months later and too late to re-label anything.
 *
 * Strokes rather than a PDF, so this runs in CI: the client plan sets are not
 * in this repository and never will be.
 */
const opts = { feetPerPoint: 1 / 12, minLengthFeet: 2 };

/** Two walls far apart, so neither can be mistaken for the other. */
const sheet = (): StrokeSegment[] => [
  { x1: 0, y1: 0, x2: 360, y2: 0, width: 0.5 },
  { x1: 0, y1: 6, x2: 360, y2: 6, width: 0.5 },
  { x1: 0, y1: 360, x2: 240, y2: 360, width: 0.5 },
  { x1: 0, y1: 366, x2: 240, y2: 366, width: 0.5 },
];

function reviewed() {
  const candidates: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    lengthFeet: number;
    thicknessFeet: number;
    features: number[];
  }[] = [];
  const walls = wallsFromStrokes(sheet(), {
    ...opts,
    onCandidate: (features, wall) =>
      candidates.push({
        x1: wall.x1,
        y1: wall.y1,
        x2: wall.x2,
        y2: wall.y2,
        lengthFeet: wall.lengthFeet,
        thicknessFeet: wall.thicknessFeet,
        features: [...features],
      }),
  });
  // A session: the longer run is a wall, the shorter one is not.
  const byLength = [...walls].sort((a, b) => b.lengthFeet - a.lengthFeet);
  const verdicts = byLength.map((wall, at) => ({
    x1: wall.x1,
    y1: wall.y1,
    x2: wall.x2,
    y2: wall.y2,
    lengthFeet: wall.lengthFeet,
    thicknessFeet: wall.thicknessFeet,
    verdict: at === 0 ? ("wall" as const) : ("not-wall" as const),
  }));
  return { candidates, walls, verdicts };
}

describe("a reviewed sheet survives being saved and read back", () => {
  it("keeps every row, its vector, and which side it was on", async () => {
    const { candidates, walls, verdicts } = reviewed();
    expect(candidates.length, "nothing was proposed, so this proves nothing").toBeGreaterThan(0);
    expect(walls.length).toBe(2);

    const file = labelFile({
      set: "round-trip",
      sheet: "A103",
      page: 19,
      reviewedBy: "test",
      secondsSpent: 1,
      feetPerUnit: 1 / 12,
      reviewComplete: true,
      candidates,
      verdicts,
      unreviewed: 0,
    });

    const dir = mkdtempSync(join(tmpdir(), "labels-"));
    const written = await writeLabels("round-trip", "A103", file, {
      ...process.env,
      TAKEOFF_LABEL_DIR: dir,
      NODE_ENV: "development",
    });
    expect(written.ok ? "" : written.error, "the store refused the write").toBe("");
    if (!written.ok) return;

    const back = JSON.parse(readFileSync(written.path, "utf8")) as typeof file;

    expect(back.rows.length, "rows did not survive the file").toBe(file.rows.length);
    expect(back.rows.length).toBeGreaterThan(0);
    expect(
      back.rows.every((row) => row.features.length === candidates[0].features.length),
      "a row lost its feature vector",
    ).toBe(true);

    // The one that matters: the accepted run came back positive and the
    // rejected one did not. A file that keeps every row and loses which side
    // each was on is worse than no file, because it looks like a training set.
    expect(back.rows.some((row) => row.label === 1), "the accepted wall came back as a negative").toBe(true);
    expect(back.rows.some((row) => row.label === 0), "nothing came back as a negative").toBe(true);
    expect(back.sheet).toBe("A103");
    expect(back.secondsSpent).toBe(1);

    // The columns, named, and as many of them as a row is long. A file whose
    // vectors are 24 numbers and whose featureNames is empty cannot be checked
    // against a model's columns later — `deciderFor` refuses a mismatch, and
    // with no names there is nothing to refuse. It survived a mutation that
    // emptied the list, which is how it got written down here.
    expect(back.featureNames.length, "the file names no columns").toBe(
      candidates[0].features.length,
    );
    expect(back.featureNames).toContain("penPercentile");
  });

  it("COUNTS A REJECTION AS A REJECTION", async () => {
    // The mutation that catches the spelling: `not-a-wall` leaves the rows
    // right and this count at zero.
    const { candidates, verdicts } = reviewed();
    const file = labelFile({
      set: "round-trip",
      sheet: "A103",
      page: 19,
      reviewedBy: "test",
      secondsSpent: 1,
      feetPerUnit: 1 / 12,
      reviewComplete: true,
      candidates,
      verdicts,
      unreviewed: 0,
    });
    expect(file.counts.rejected, "a rejected run was not counted as one").toBeGreaterThan(0);
    expect(file.counts.accepted).toBeGreaterThan(0);
  });
});
