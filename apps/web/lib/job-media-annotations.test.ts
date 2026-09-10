import { describe as group, expect, it } from "vitest";
import { JobMediaAnnotationKind as PrismaKind } from "@prova/db";
import {
  JOB_MEDIA_ANNOTATIONS_MAX,
  JOB_MEDIA_ANNOTATION_KINDS,
  JOB_MEDIA_ANNOTATION_LABEL_MAX,
  annotationProblem,
  annotationProblemMessage,
  annotationSetProblemMessage,
  annotationSummary,
  arrowHead,
  boxFromCorners,
  isTwoPointKind,
  requiresLabel,
  type JobMediaAnnotationInput,
} from "./job-media-annotations";

function mark(over: Partial<JobMediaAnnotationInput> = {}): JobMediaAnnotationInput {
  return { kind: "ARROW", x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5, label: null, ...over };
}

group("the list of kinds cannot drift from the database's", () => {
  // THE POINT OF THIS FILE'S FIRST TEST. A hand-written copy of an enum's
  // members is exactly how LOCATION_TYPES came to disagree with its own
  // Prisma enum and silently refuse a dropdown option the UI offered
  // (CLAUDE.md). The copy exists because client components cannot import
  // @prova/db; this is what stops it becoming that bug.
  it("has exactly the members Prisma generated, no more and no fewer", () => {
    expect([...JOB_MEDIA_ANNOTATION_KINDS].sort()).toEqual(Object.values(PrismaKind).sort());
  });
});

group("what makes a mark storable", () => {
  it("accepts an ordinary arrow", () => {
    expect(annotationProblem(mark())).toBeNull();
  });

  it("refuses a kind it does not know", () => {
    expect(annotationProblem(mark({ kind: "SCRIBBLE" as never }))).toBe("unknown-kind");
  });

  // Refused rather than clamped, deliberately: clamping moves somebody's
  // arrow to the edge and then calls the result their mark.
  it("refuses a mark outside the photo rather than dragging it back in", () => {
    expect(annotationProblem(mark({ x1: 1.2 }))).toBe("off-image");
    expect(annotationProblem(mark({ y1: -0.01 }))).toBe("off-image");
    expect(annotationProblem(mark({ x2: 1.5 }))).toBe("off-image");
    expect(annotationProblem(mark({ x1: Number.NaN }))).toBe("off-image");
  });

  it("wants two points for a line or a box, and one for text", () => {
    expect(annotationProblem(mark({ x2: null, y2: null }))).toBe("missing-second-point");
    expect(annotationProblem(mark({ kind: "BOX", x2: null, y2: null }))).toBe(
      "missing-second-point",
    );
    expect(
      annotationProblem({ kind: "TEXT", x1: 0.2, y1: 0.2, x2: 0.4, y2: 0.4, label: "rework" }),
    ).toBe("second-point-on-a-point-mark");
  });

  // The most likely bad input by far: a thumb that meant to tap and moved
  // three pixels. A zero-extent mark is a row claiming the photo was
  // annotated when there is nothing to see.
  it("refuses a mark too small to see, which is what a stray tap produces", () => {
    expect(annotationProblem(mark({ x2: 0.1005, y2: 0.1005 }))).toBe("degenerate");
    // Long in one axis only is a legitimate horizontal or vertical line.
    expect(annotationProblem(mark({ x2: 0.9, y2: 0.1 }))).toBeNull();
    expect(annotationProblem(mark({ x2: 0.1, y2: 0.9 }))).toBeNull();
  });

  it("insists on words where a mark is meaningless without them", () => {
    expect(requiresLabel("TEXT")).toBe(true);
    expect(requiresLabel("MEASURE")).toBe(true);
    expect(requiresLabel("ARROW")).toBe(false);
    expect(requiresLabel("BOX")).toBe(false);

    expect(annotationProblem({ ...mark({ kind: "MEASURE" }), label: "   " })).toBe("missing-label");
    expect(annotationProblem({ kind: "TEXT", x1: 0.2, y1: 0.2, x2: null, y2: null, label: null })).toBe(
      "missing-label",
    );
    // An arrow may point wordlessly.
    expect(annotationProblem(mark({ label: null }))).toBeNull();
  });

  it("bounds the label, measured after trimming", () => {
    expect(annotationProblem(mark({ label: "x".repeat(JOB_MEDIA_ANNOTATION_LABEL_MAX) }))).toBeNull();
    expect(annotationProblem(mark({ label: "x".repeat(JOB_MEDIA_ANNOTATION_LABEL_MAX + 1) }))).toBe(
      "label-too-long",
    );
  });

  it("has a sentence for every refusal it can return", () => {
    const problems = [
      "unknown-kind",
      "off-image",
      "missing-second-point",
      "second-point-on-a-point-mark",
      "missing-label",
      "label-too-long",
      "degenerate",
    ] as const;
    for (const p of problems) {
      expect(annotationProblemMessage(p).length).toBeGreaterThan(0);
    }
  });

  it("caps the set, and says so with the number that would result", () => {
    expect(annotationSetProblemMessage(JOB_MEDIA_ANNOTATIONS_MAX)).toBeNull();
    const over = annotationSetProblemMessage(JOB_MEDIA_ANNOTATIONS_MAX + 1);
    expect(over).toContain(String(JOB_MEDIA_ANNOTATIONS_MAX + 1));
  });

  it("knows which kinds are dragged and which are placed", () => {
    expect(isTwoPointKind("TEXT")).toBe(false);
    expect(isTwoPointKind("ARROW")).toBe(true);
    expect(isTwoPointKind("BOX")).toBe(true);
    expect(isTwoPointKind("MEASURE")).toBe(true);
  });
});

group("the drawing arithmetic", () => {
  // THE BUG THIS TEST EXISTS FOR: a head computed without the aspect ratio
  // is skewed by exactly the amount the image is non-square, and it looks
  // fine on the square test photo somebody tries it on.
  it("puts the head at the tip, behind it, on both sides", () => {
    const head = arrowHead(0, 0.5, 0.8, 0.5, 1);
    expect(head).toHaveLength(2);
    // Behind the tip on the x axis, since the arrow points right.
    for (const p of head) expect(p.x).toBeLessThan(0.8);
    // One above the shaft and one below it.
    expect(Math.min(...head.map((p) => p.y))).toBeLessThan(0.5);
    expect(Math.max(...head.map((p) => p.y))).toBeGreaterThan(0.5);
  });

  it("compensates for a non-square image rather than skewing with it", () => {
    // Same arrow, two aspect ratios. On a wide image a fraction of the
    // width is a bigger distance than a fraction of the height, so the
    // head's x offset must SHRINK in fraction terms to stay the same shape.
    const square = arrowHead(0, 0.5, 0.8, 0.5, 1);
    const wide = arrowHead(0, 0.5, 0.8, 0.5, 2);
    const squareBack = 0.8 - square[0].x;
    const wideBack = 0.8 - wide[0].x;
    expect(wideBack).toBeLessThan(squareBack);
  });

  it("returns nothing for an arrow of no length, rather than dividing by zero", () => {
    expect(arrowHead(0.3, 0.3, 0.3, 0.3, 1)).toEqual([]);
  });

  // Dragging up-and-left is how a right-handed person boxes something in
  // the top-left of a photo, and a negative width is an invisible rect.
  it("normalises a box dragged in any direction", () => {
    const downRight = boxFromCorners(0.2, 0.2, 0.6, 0.5);
    const upLeft = boxFromCorners(0.6, 0.5, 0.2, 0.2);
    // Byte-equal to each other — the whole claim of the function — but
    // compared to the expected numbers with a tolerance, because 0.6 - 0.2
    // is 0.39999999999999997 and rounding it in the function would be
    // arithmetic added for a test rather than for SVG, which cannot tell.
    expect(upLeft).toEqual(downRight);
    expect(downRight.x).toBeCloseTo(0.2, 10);
    expect(downRight.y).toBeCloseTo(0.2, 10);
    expect(downRight.width).toBeCloseTo(0.4, 10);
    expect(downRight.height).toBeCloseTo(0.3, 10);
  });
});

group("what the gallery says about a marked-up photo", () => {
  it("says nothing at all when nothing is drawn", () => {
    expect(annotationSummary(0)).toBeNull();
  });

  it("counts, and gets the singular right", () => {
    expect(annotationSummary(1)).toBe("1 mark");
    expect(annotationSummary(3)).toBe("3 marks");
  });
});
