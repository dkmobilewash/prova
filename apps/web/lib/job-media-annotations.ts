/**
 * What a mark on a site capture may be, and where it may sit.
 *
 * Pure and session-free, the same split `lib/job-media.ts` makes against its
 * query module and `lib/permissions.ts` makes against `lib/authz.ts`: the
 * rules are decidable here and testable without a database, and the action
 * that writes them imports rather than restates. A second copy of a rule is
 * how `LOCATION_TYPES` came to disagree with its own Prisma enum (CLAUDE.md).
 */

/** The four marks, matching `JobMediaAnnotationKind` in the schema.
 *
 * A SECOND LIST OF AN ENUM'S MEMBERS IS THE `LOCATION_TYPES` SHAPE, so this
 * one is checked against Prisma's generated enum by a test rather than
 * trusted — see job-media-annotations.test.ts. It exists at all because
 * every consumer here is either a client component (which cannot import
 * `@prova/db`) or a pure function a test calls without one. */
export const JOB_MEDIA_ANNOTATION_KINDS = ["ARROW", "BOX", "TEXT", "MEASURE"] as const;

export type JobMediaAnnotationKind = (typeof JOB_MEDIA_ANNOTATION_KINDS)[number];

/**
 * How many marks one capture may carry.
 *
 * A cap rather than none, for the same reason the tag cap exists: a photo
 * wearing forty arrows is not annotated, it is obscured, and the thing the
 * mark was drawn to point at is the first casualty. Generous enough that
 * nobody hits it while making a real point.
 */
export const JOB_MEDIA_ANNOTATIONS_MAX = 24;

/** Long enough for "3 ft 6 in to the rough opening", short enough that a
 *  pasted paragraph is refused rather than laid across the photograph. */
export const JOB_MEDIA_ANNOTATION_LABEL_MAX = 80;

/** A mark as the client sends it and as the validator returns it: fractions
 *  of the image on each axis, never pixels. See the schema comment on `x1`
 *  for why a fraction rather than a coordinate plus a stored image size. */
export type JobMediaAnnotationInput = {
  kind: JobMediaAnnotationKind;
  x1: number;
  y1: number;
  x2: number | null;
  y2: number | null;
  label: string | null;
};

/** Which kinds are a LINE or a BOX — two points — and which are a single
 *  point. `TEXT` is the only one-point mark; everything else is drawn by
 *  dragging from somewhere to somewhere. */
export function isTwoPointKind(kind: JobMediaAnnotationKind): boolean {
  return kind !== "TEXT";
}

/** Which kinds are meaningless without words. An arrow can point at
 *  something wordlessly; a text mark with no text is nothing at all, and a
 *  measurement line with no figure is a line the reader has to guess at. */
export function requiresLabel(kind: JobMediaAnnotationKind): boolean {
  return kind === "TEXT" || kind === "MEASURE";
}

export type AnnotationProblem =
  | "unknown-kind"
  | "off-image"
  | "missing-second-point"
  | "second-point-on-a-point-mark"
  | "missing-label"
  | "label-too-long"
  | "degenerate";

/**
 * The whole of what makes a mark storable, in one function.
 *
 * Called by the action before anything is written, and by the editor before
 * anything is sent, so the person is told in the drawing surface's own terms
 * rather than by a refusal three seconds later. The ACTION is the
 * enforcement; this being shared is what stops the two drifting.
 *
 * Returns the first problem or null. First rather than all of them because
 * the caller shows one sentence and a mark with two problems is one bad
 * mark either way.
 */
export function annotationProblem(mark: JobMediaAnnotationInput): AnnotationProblem | null {
  if (!(JOB_MEDIA_ANNOTATION_KINDS as readonly string[]).includes(mark.kind)) {
    return "unknown-kind";
  }

  // A fraction outside 0..1 is a mark outside the photograph, which is
  // either a bug in the editor's arithmetic or a hand-posted payload. Both
  // are refused rather than clamped: clamping would silently move somebody's
  // arrow to the edge and call it their mark.
  if (!inUnit(mark.x1) || !inUnit(mark.y1)) return "off-image";

  const twoPoint = isTwoPointKind(mark.kind);
  const hasSecond = mark.x2 !== null && mark.y2 !== null;

  if (twoPoint && !hasSecond) return "missing-second-point";
  if (!twoPoint && (mark.x2 !== null || mark.y2 !== null)) return "second-point-on-a-point-mark";
  if (hasSecond && (!inUnit(mark.x2 as number) || !inUnit(mark.y2 as number))) return "off-image";

  // A zero-length line and a zero-area box are invisible, and an invisible
  // mark is worse than no mark: it is a row that says something was
  // annotated when nothing can be seen. This is what a stray tap on the
  // photo produces, so it is the most likely bad input rather than an
  // exotic one.
  if (twoPoint && hasSecond) {
    const dx = Math.abs((mark.x2 as number) - mark.x1);
    const dy = Math.abs((mark.y2 as number) - mark.y1);
    if (dx < MIN_EXTENT && dy < MIN_EXTENT) return "degenerate";
  }

  const label = mark.label?.trim() ?? "";
  if (requiresLabel(mark.kind) && !label) return "missing-label";
  if (label.length > JOB_MEDIA_ANNOTATION_LABEL_MAX) return "label-too-long";

  return null;
}

/** 1% of the image on both axes. Below that a drag is a tap that moved,
 *  which is what a thumb on a phone does even when it means to hold still. */
const MIN_EXTENT = 0.01;

function inUnit(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && n <= 1;
}

/** The sentence shown for each refusal. Here rather than at the call sites
 *  so the wording cannot drift between the editor and the action. */
export function annotationProblemMessage(problem: AnnotationProblem): string {
  switch (problem) {
    case "unknown-kind":
      return "That is not a kind of mark this app draws";
    case "off-image":
      return "That mark is outside the photo";
    case "missing-second-point":
      return "Drag to draw that one, rather than tapping";
    case "second-point-on-a-point-mark":
      return "A text label sits at one point, not two";
    case "missing-label":
      return "Type what this says before saving it";
    case "label-too-long":
      return `Keep it under ${JOB_MEDIA_ANNOTATION_LABEL_MAX} characters — that one is longer`;
    case "degenerate":
      return "That mark is too small to see — draw it a bit bigger";
  }
}

/** Why this whole SET cannot be saved, or null. Separate from the per-mark
 *  check because it is a different KIND of refusal and the person needs to
 *  be told which — one is about a mark, this is about the photo. */
export function annotationSetProblemMessage(count: number): string | null {
  if (count <= JOB_MEDIA_ANNOTATIONS_MAX) return null;
  return (
    `A photo carries at most ${JOB_MEDIA_ANNOTATIONS_MAX} marks. ` +
    `That would make ${count}.`
  );
}

/**
 * The arrow head, as two short lines back from the tip.
 *
 * PURE, AND HERE RATHER THAN IN THE COMPONENT, because it is the one piece
 * of drawing arithmetic that can be wrong in a way nobody notices: a head
 * computed in the SVG's own coordinate space stretches with the viewport
 * and stops looking like an arrow on a phone. This returns fractions like
 * everything else, and a test can hold it still.
 *
 * `aspect` is the image's width/height. Without it the head is skewed by
 * exactly the amount the image is non-square, because a fraction of the
 * width is not the same distance as a fraction of the height — the bug this
 * argument exists to prevent, and the reason the function takes it rather
 * than assuming 1.
 */
export function arrowHead(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  aspect: number,
): { x: number; y: number }[] {
  // Work in a space where one unit is the same distance on both axes, so
  // the angle is the real one, then convert back on the way out.
  const dx = (x2 - x1) * aspect;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length === 0) return [];

  const angle = Math.atan2(dy, dx);
  // A fixed fraction of the image, not of the arrow: a short arrow with a
  // proportionally short head is a line with a smudge on the end.
  const headLength = 0.05;
  const spread = Math.PI / 7;

  return [angle - spread, angle + spread].map((a) => ({
    x: x2 - (Math.cos(a) * headLength) / aspect,
    y: y2 - Math.sin(a) * headLength,
  }));
}

/** A box from two corners dragged in any direction. Normalising here rather
 *  than at the two call sites because a negative width is an invisible
 *  rectangle in SVG, and dragging up-and-left is how a right-handed person
 *  boxes something in the top-left of a photo. */
export function boxFromCorners(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

/** What the gallery says about a photo that has been drawn on, or null when
 *  it has not. One line, because the card is 250px wide on a phone and the
 *  marks themselves are already on the image. */
export function annotationSummary(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 mark" : `${count} marks`;
}
