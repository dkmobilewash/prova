import {
  arrowHead,
  boxFromCorners,
  type JobMediaAnnotationKind,
} from "@/lib/job-media-annotations";

/**
 * The marks somebody drew, laid over the photograph.
 *
 * ONE COMPONENT FOR THE SUB'S GALLERY AND THE GC'S PORTAL, which is the
 * whole reason it is a component rather than markup in each. The portal
 * deliberately shares almost nothing with the internal card — a separate
 * type, a separate query, three exclusions the compiler enforces — and this
 * is the one place that rule is inverted on purpose: what the GC sees drawn
 * on a photo must be EXACTLY what the sub saw when they decided to show it.
 * Two implementations of this would be two chances for the arrow to point
 * somewhere else on the page that matters.
 *
 * NOT A CLIENT COMPONENT. It renders static SVG from data the server
 * already has, so it costs nothing on the wire and works with JavaScript
 * off. The editor is the client component; this is the reader.
 *
 * IT IS AN OVERLAY, NOT A REDRAW. The photograph underneath is untouched —
 * see media-annotations.prisma for why the pixels are never modified, and
 * for the cost of that decision (the raw file still serves an unmarked
 * photo, which is why nothing here calls the blob URL "the photo").
 *
 * WHAT A STORED COORDINATE IS A FRACTION OF, which is the whole of issue
 * #256 and was written down wrongly, until 2026-09-15, in every file that
 * described it — this one included. It is NOT a fraction of the photograph. It is a fraction of the 4:3 BOX the
 * photograph is letterboxed inside — `JOB_MEDIA_MARK_BOX_ASPECT` below —
 * because that box, not the image, is what `JobMediaAnnotator` measures
 * when a finger goes down on it. See that constant for the contract every
 * surface rendering this component has to keep.
 */

export type JobMediaMark = {
  id: string;
  kind: JobMediaAnnotationKind;
  x1: number;
  y1: number;
  x2: number | null;
  y2: number | null;
  label: string | null;
};

/** High-visibility amber, one colour for every mark and no picker.
 *
 * A colour choice is a decision a person on a roof should not be asked to
 * make, and the only requirement that matters is being visible against
 * concrete, drywall, steel and sky — none of which are amber. The dark
 * outline underneath every stroke is what makes it survive a light
 * background too; a single-colour line disappears against exactly one wall
 * and it is always the wall in the photo. */
const STROKE = "#f59e0b";
const OUTLINE = "#1c1917";

/**
 * THE COORDINATE SPACE EVERY MARK LIVES IN, and the contract every surface
 * that renders this component has to keep. One number, in one file, because
 * it used to be four copies of `4 / 3` passed in as a prop and the prop was
 * never the problem — the box underneath it was.
 *
 * A mark is stored as a fraction of a 4:3 box with the photograph
 * letterboxed inside it (`object-contain`), because that is precisely what
 * `JobMediaAnnotator` measures: its `surfaceRef` is the 4:3 div, so a
 * pointer becomes a fraction of THAT, never of the photo. So any surface
 * drawing these marks owes the reader two things:
 *
 *   - a box of exactly this ratio, and
 *   - the photograph fitted inside it with `object-contain`.
 *
 * ISSUE #256 IS WHAT HAPPENS WHEN THE SECOND ONE IS MISSED. The gallery
 * card and the GC's portal used `object-cover`: same box, same fractions,
 * but the photograph filled the box and was cropped, so the pixel under a
 * given fraction was a DIFFERENT PART OF THE PICTURE from the one the
 * person had drawn on. Measured in real Chromium against a target burned
 * into the test image: 0px out on a genuinely 4:3 photo — which is why it
 * read as fine — and 31 to 89px out on 16:9 and 3:4 phone photos, worse
 * the larger the card and the further from the centre. An arrow on a GC's
 * screen pointed at the wrong thing.
 *
 * `components/jobMediaMarkSurfaces.test.ts` is what stops the next surface
 * getting it wrong; this comment is what stops it being reverted.
 */
export const JOB_MEDIA_MARK_BOX_ASPECT = 4 / 3;

export function JobMediaMarks({ marks }: { marks: JobMediaMark[] }) {
  if (marks.length === 0) return null;

  return (
    /* `viewBox="0 0 1 1"` with a non-uniform preserveAspectRatio is what
       lets every stored coordinate be used as-is: the marks are fractions
       of the 4:3 box, and `none` makes the SVG's own box stretch to that
       box exactly, so a fraction lands where it was drawn whatever the
       card's width. (It said "fractions of the image" here until #256, and
       that one word is the bug: the SVG stretches to the BOX, and the photo
       only fills the box when it is letterboxed into it.)
       `pointer-events-none` so the overlay never eats a tap meant for the
       photo or the player underneath it. */
    <svg
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      {marks.map((mark) => (
        <Mark key={mark.id} mark={mark} />
      ))}
    </svg>
  );
}

function Mark({ mark }: { mark: JobMediaMark }) {
  /* The box's own ratio, not a prop. Every caller passed the same literal
     `4 / 3` and one of them (the editor) passed a measurement that could
     only ever BE 4/3 — so the prop was four chances to disagree about a
     constant. Used for the arrow head and the text, both of which are
     skewed by exactly the amount the box is non-square without it. */
  const aspect = JOB_MEDIA_MARK_BOX_ASPECT;

  /* Stroke widths are in the 0..1 viewBox, so they are fractions too, and
     `vectorEffect="non-scaling-stroke"` is deliberately NOT used: it would
     make a mark on a thumbnail as thick as one on a full-width photo, and
     the thumbnail is where thick lines cover the thing being pointed at. */
  const wide = 0.008;
  const thin = 0.004;

  if (mark.kind === "TEXT") {
    return (
      <text
        x={mark.x1}
        y={mark.y1}
        /* 0.045 of the BOX's height. Fixed rather than scaled to the mark,
           because a text mark has no size of its own to scale to. */
        fontSize={0.045}
        fill={STROKE}
        stroke={OUTLINE}
        strokeWidth={thin}
        paintOrder="stroke"
        /* The SVG is stretched to the 4:3 box, so a proportional font
           would stretch with it. This undoes that on the text alone. */
        style={{ transform: `scale(${1 / aspect}, 1)`, transformOrigin: `${mark.x1}px ${mark.y1}px` }}
      >
        {mark.label}
      </text>
    );
  }

  if (mark.x2 === null || mark.y2 === null) return null;

  if (mark.kind === "BOX") {
    const box = boxFromCorners(mark.x1, mark.y1, mark.x2, mark.y2);
    return (
      <>
        <rect {...box} fill="none" stroke={OUTLINE} strokeWidth={wide + thin} />
        <rect {...box} fill="none" stroke={STROKE} strokeWidth={wide} />
      </>
    );
  }

  const head = mark.kind === "ARROW" ? arrowHead(mark.x1, mark.y1, mark.x2, mark.y2, aspect) : [];

  return (
    <>
      {/* Drawn twice — a dark line slightly wider, then the amber one over
          it — which is what keeps a mark readable on a white ceiling and on
          a dark riser without asking anybody to pick a colour. */}
      <line
        x1={mark.x1}
        y1={mark.y1}
        x2={mark.x2}
        y2={mark.y2}
        stroke={OUTLINE}
        strokeWidth={wide + thin}
        strokeLinecap="round"
      />
      <line
        x1={mark.x1}
        y1={mark.y1}
        x2={mark.x2}
        y2={mark.y2}
        stroke={STROKE}
        strokeWidth={wide}
        strokeLinecap="round"
      />
      {head.map((point, i) => (
        <line
          key={i}
          x1={mark.x2 as number}
          y1={mark.y2 as number}
          x2={point.x}
          y2={point.y}
          stroke={STROKE}
          strokeWidth={wide}
          strokeLinecap="round"
        />
      ))}
      {/* THE MEASUREMENT'S END TICKS, which is the only thing that makes a
          measure line read as a dimension rather than as an arrow without a
          head. The number itself is the label, placed at the midpoint. */}
      {mark.kind === "MEASURE" && mark.label && (
        <text
          x={(mark.x1 + mark.x2) / 2}
          y={(mark.y1 + mark.y2) / 2 - 0.015}
          fontSize={0.045}
          fill={STROKE}
          stroke={OUTLINE}
          strokeWidth={thin}
          paintOrder="stroke"
          textAnchor="middle"
          style={{
            transform: `scale(${1 / aspect}, 1)`,
            transformOrigin: `${(mark.x1 + mark.x2) / 2}px ${(mark.y1 + mark.y2) / 2}px`,
          }}
        >
          {mark.label}
        </text>
      )}
    </>
  );
}
