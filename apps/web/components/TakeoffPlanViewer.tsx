"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { formatFeetInches, parseFeetInches } from "@/lib/feet-inches";
import {
  calibrationNotices,
  calibrationRefusal,
  feetPerPageWidth,
  polylineLength,
  readScale,
  ringArea,
  ringSelfIntersects,
  verticesProblem,
  type MeasurementKind,
  type StoredCalibration,
} from "@/lib/takeoff-plan";
import { saveTakeoffCalibration, saveTakeoffMeasurement, saveTakeoffMeasurements } from "@/lib/actions";
import type {
  PlanSheet,
  PrintedScaleByPage,
  ScaleDeclineByPage,
  ScalePrefill,
  ScalePrefillByPage,
} from "@/lib/takeoff-plan-view";
import {
  errorBandText,
  evidenceOrder,
  fitZoom,
  stepZoom,
  TOOLS,
  ZOOM_STEPS,
  type ToolId,
} from "@/lib/takeoff-plan-view";
import {
  clusterByThickness,
  inchLabel,
  wallsInTheBuilding,
  wallsNotLettering,
  wallsNotTheSheetBorder,
  type WallCluster,
  type StrokeSegment,
} from "@/lib/takeoff/wallVectors";
import { wallsFromBothEngines } from "@/lib/takeoff/wallRuns";
import { pagesToSample, templateFromSheets, withoutTemplate } from "@/lib/takeoff/sheetTemplate";
import { SheetTooDenseError } from "@/lib/takeoff/wallVectors";
import { segmentsFromOpenPage } from "@/lib/takeoff/sheetStrokes";
import { wallTypeTags, namesForClusters, taggedFeetForClusters, tagSentence } from "@/lib/takeoff/wallTags";
import { matchClusterToWallType, matchSentence } from "@/lib/takeoff/wallTypeMatch";
import type { PostableWallType, WallTypeMatch } from "@/lib/takeoff/wallTypeMatch";

/**
 * THE MEASURING SURFACE — a PDF page rendered to a canvas, with an SVG
 * overlay that everything is drawn and measured on.
 *
 * SVG OVER CANVAS FOR THE GEOMETRY, which is the choice `JobMediaAnnotator`
 * already argued for as "THE FIRST DRAWING SURFACE IN THIS APP": shapes stay
 * as elements, so they hit-test, they scale with a transform, and they can be
 * read out of the DOM by a test. The canvas underneath is a rendering surface
 * and nothing else — no pixel is ever read back from it, which is also why
 * the tainting caveat recorded on the photo report does not apply here.
 *
 * PDFJS IS IMPORTED INSIDE AN EFFECT, never statically. That keeps it out of
 * every server graph — so the `Can't resolve 'canvas'` build failure cannot
 * arise — and out of every other page's bundle. The LEGACY build, because the
 * modern one needs `Promise.withResolvers` (Chrome 119 / Safari 17.4) and a
 * contractor's iPad is a real device. The worker is resolved with
 * `new URL(..., import.meta.url)` so the bundler emits it and rewrites the
 * path, which makes worker/API version skew — the single most reported
 * pdf.js-in-Next failure — structurally impossible.
 *
 * ZOOMING RE-RENDERS THE PAGE rather than scaling pixels. A measuring tool is
 * zoomed in precisely so a click can be placed accurately, and a blurry
 * upscale would defeat the entire point of the feature.
 */

type Draft = { xs: number[]; ys: number[] };

const EMPTY: Draft = { xs: [], ys: [] };

/** How wide one PDF point is rendered, before zoom. 1.5 gives a legible
 * sheet on a laptop without asking pdf.js to rasterise a 42-inch drawing at
 * full resolution on first paint. */
const BASE_SCALE = 1.5;

/**
 * ── THE BOTTOM OF THIS LIST USED TO BE 0.5, AND A WHOLE SHEET DID NOT FIT ──
 *
 * These multiply `BASE_SCALE`, so the old floor of 0.5 rendered at 0.75 of full
 * size — on a 42-inch ARCH E sheet that is 3,024pt × 0.75 ≈ 2,270 CSS px, wider
 * than the viewport it sits in. The control said "50%" and the drawing still
 * ran off the edge, with no way to go further out. Reported from a real plan
 * set on 2026-10-07: "the area that displays the plans is too small and cuts
 * off most of the plans even when you zoom all the way out to 50%".
 *
 * The percentage shown is this number, not the render scale, which is why 50%
 * was never half of anything.
 */


/**
 * FIT, which is what somebody actually wants on a 42-inch sheet.
 *
 * Steps alone do not solve it: the right zoom for a whole sheet depends on the
 * sheet's size AND the window's, so no fixed list contains it. This computes
 * the exact scale that puts the full width in view, and it is a MODE rather
 * than a step for that reason — resizing the window keeps it fitted.
 *
 * Sheets are landscape and far wider than tall, so width is the binding
 * dimension; fitting height as well would shrink a 42×30 to the point of
 * uselessness on a laptop.
 */
const FIT = "fit" as const;
type Zoom = number | typeof FIT;


export function TakeoffPlanViewer({
  jobId,
  planId,
  sheets,
  printedScaleByPage,
  levelByPage,
  wallTypes,
  scalePrefillByPage,
  scaleDeclineByPage,
  duplicateWallsByPage = {},
}: {
  jobId: string;
  planId: string;
  sheets: PlanSheet[];
  /** The company's wall types that have layers, so they produce line items.
   *  Used only to MATCH the drawing's own tags against — the viewer never
   *  chooses a type, it reports which one the drawing named. */
  wallTypes: PostableWallType[];
  /**
   * The title-block scale per PAGE NUMBER, deliberately not per sheet.
   *
   * A `PlanSheet` only exists once somebody has saved a calibration on that
   * page, so reading this off `sheet` made it null on every FIRST calibration
   * — the only time it has anything to say. See the note in
   * `takeoff-plan-view.ts`.
   */
  printedScaleByPage: PrintedScaleByPage;
  /** Which floor each sheet draws, read off its own title — see
   *  `sheetLevel.ts`. Absent for a sheet whose title names no floor, which is
   *  most of them on a single-storey job. */
  levelByPage?: Record<number, string>;
  /** What each sheet said about its own scale, read off the dimensions
   *  printed on it. A PREFILL and never a calibration — see `ScalePrefill`. */
  scalePrefillByPage: ScalePrefillByPage;
  scaleDeclineByPage?: ScaleDeclineByPage;
  /**
   * Per page, why a wall takeoff here would probably be a DOUBLE COUNT.
   *
   * Empty for an ordinary floor plan, and that silence is the point: this is
   * shown beside found walls on a mechanical plan, a reflected ceiling plan or
   * an elevation, where the architectural walls are repeated in grey. Scored
   * against a 60-page answer key, those sheets invented 13,767 ft — a third of
   * everything the finder reported across the set.
   *
   * A CAUTION AND NOT A REFUSAL. A wall can genuinely be measured on a section,
   * and a sheet number read by a model can be wrong; disabling the tool would
   * remove a capability on a guess, and leave a reader unable to tell "no walls
   * here" from "the app decided for me".
   */
  duplicateWallsByPage?: Record<number, string>;
}) {
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState<number | null>(null);
  /** How many strokes the set's own template accounted for, so the panel can
   *  SAY it rather than quietly returning a smaller number. */
  const [templateStrokes, setTemplateStrokes] = useState(0);
  // FIT by default. A sheet opens showing all of itself, which is what
  // somebody opening a drawing wants to see first; they zoom IN to measure.
  const [zoom, setZoom] = useState<Zoom>(FIT);
  const [tool, setTool] = useState<ToolId>("pan");

  // ── FOUND WALLS ──
  //
  // Held in component state and NEVER written anywhere until a person accepts a
  // group. A found wall is a proposal; the measurements table is for things
  // somebody chose. That also means switching sheets or reloading simply
  // forgets them, which is the correct behaviour for a proposal nobody acted on.
  const [found, setFound] = useState<WallCluster[] | null>(null);
  /**
   * The assembly names the drawing gives each group, parallel to `found`.
   *
   * An empty list for a group means the drawing did not say, which is the USUAL
   * case — only 25-43% of footage carries a tag, because an architect tags
   * representative walls rather than every wall. See `wallTags.ts`.
   */
  const [tagNames, setTagNames] = useState<string[][]>([]);
  /** Per group, which of the company's wall types the DRAWING named in it — or
   *  why none could be identified. Parallel to `found`, same as `tagNames`. */
  const [typeMatches, setTypeMatches] = useState<WallTypeMatch[]>([]);
  /** How many strokes the sheet held when it was last read, so an empty result
   *  can say which kind of empty it is. See the message below. */
  const [strokesSeen, setStrokesSeen] = useState(0);
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(true);
  /** The page box, straight from the viewer — the ONLY place this number is
   * ever produced. Posted with a calibration so the scale can be named. */
  const [pageSize, setPageSize] = useState<{ widthPt: number; heightPt: number } | null>(null);
  /** The scrolling box the sheet sits in — measured, so FIT knows what it is
   *  fitting into. */
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const [frameHeight, setFrameHeight] = useState(0);
  const [cssWidth, setCssWidth] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<{ numPages: number; getPage: (n: number) => Promise<unknown> } | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  const sheet = sheets.find((s) => s.pageNumber === pageNumber) ?? null;
  const calibration = sheet?.calibration ?? null;

  // ── Load the document once ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/legacy/build/pdf.worker.mjs",
          import.meta.url,
        ).toString();
        const doc = await pdfjs.getDocument({
          url: `/api/takeoff/plan/${planId}`,
          // Served from this app, so the session cookie must go with it.
          // NO `withCredentials`, AND THAT IS THE FIX RATHER THAN AN OMISSION.
          // Setting it makes this a CREDENTIALED cross-origin request, and a
          // server answering one must name a specific origin -- `*` is refused
          // by the browser. Vercel Blob serves public files with `*`, so the
          // flag turns a readable file into an unreadable one. Measured in the
          // live page against a real uploaded drawing on 2026-10-05:
          //
          //   credentials: "omit"     -> 206 Partial Content, reads fine
          //   credentials: "include"  -> TypeError: Failed to fetch
          //
          // The file is public by construction (`access: "public"`), so there
          // are no credentials to send and nothing is lost by not sending
          // them. See `blobPdfCredentials.test.ts`.
          standardFontDataUrl: "/pdfjs/standard_fonts/",
        }).promise;
        if (cancelled) return;
        docRef.current = doc as never;
        setPageCount(doc.numPages);
      } catch (error) {
        if (cancelled) return;
        setLoadError(
          error instanceof Error && /password/i.test(error.message)
            ? "That PDF is password-protected, so it can't be opened here."
            : "That drawing couldn't be opened. It may not be a PDF, or the upload may not have finished.",
        );
        setIsRendering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planId]);

  // ── What FIT is fitting into ──────────────────────────────────────────
  //
  // Watched rather than read once: the sheet should stay fitted when the window
  // changes, and a sidebar opening or the browser being resized both change
  // this without any render of ours.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => {
      setFrameWidth(frame.clientWidth);
      setFrameHeight(frame.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  /** The multiplier in force, with FIT resolved against the measured frame.
   *  Falls back to the old default until the frame has been measured, so the
   *  first paint is never a divide by zero. */
  const zoomFactor = useMemo(() => {
    if (zoom !== FIT) return zoom;
    if (!pageSize || frameWidth === 0) return 1;
    // Decided in `fitZoom`, which is pure and tested — see its header for why
    // this fits BOTH dimensions and why that took a second attempt.
    return fitZoom({ width: frameWidth, height: frameHeight }, pageSize, BASE_SCALE);
  }, [zoom, pageSize, frameWidth, frameHeight]);

  // ── Render the current page at the current zoom ───────────────────────
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || pageCount === null) return;
    let cancelled = false;
    setIsRendering(true);

    (async () => {
      try {
        renderTaskRef.current?.cancel();
        const page = (await doc.getPage(pageNumber)) as {
          getViewport: (o: { scale: number }) => { width: number; height: number };
          render: (o: unknown) => { promise: Promise<void>; cancel: () => void };
        };
        if (cancelled) return;

        // THE PAGE-WIDTH BOX is defined at scale 1, with pdf.js having
        // applied the page's own /Rotate. Everything stored is a fraction of
        // THIS width — see `lib/takeoff-plan.ts`.
        const unit = page.getViewport({ scale: 1 });
        setPageSize({ widthPt: unit.width, heightPt: unit.height });

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const scale = BASE_SCALE * zoomFactor;
        const viewport = page.getViewport({ scale: scale * dpr });
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        canvas.style.width = `${Math.round(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.round(viewport.height / dpr)}px`;
        setCssWidth(Math.round(viewport.width / dpr));

        const canvasContext = canvas.getContext("2d");
        if (!canvasContext) return;
        const task = page.render({ canvasContext, viewport });
        renderTaskRef.current = task;
        await task.promise;
      } catch (error) {
        // A cancelled render is the normal result of changing page or zoom
        // quickly, not a failure worth telling anybody about.
        if (!cancelled && !(error instanceof Error && /cancel/i.test(error.message))) {
          setLoadError("That page couldn't be drawn.");
        }
      } finally {
        if (!cancelled) setIsRendering(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pageNumber, zoomFactor, pageCount]);

  // Changing page or tool abandons a half-drawn shape rather than carrying
  // points from one sheet onto another.
  useEffect(() => {
    setDraft(EMPTY);
  }, [pageNumber, tool]);

  const aspect = pageSize ? pageSize.heightPt / pageSize.widthPt : 1.294;

  /** Pointer position as page-width units — both axes divided by the
   * rendered WIDTH, which is the contract the whole feature rests on. */
  const pointAt = useCallback(
    (event: React.PointerEvent<SVGSVGElement>): { x: number; y: number } | null => {
      const rect = event.currentTarget.getBoundingClientRect();
      if (rect.width <= 0) return null;
      return {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.width,
      };
    },
    [],
  );

  const drawing = tool !== "pan";
  const kindOf = (id: ToolId): MeasurementKind | null =>
    id === "linear" ? "LINEAR" : id === "area" ? "AREA" : id === "count" ? "COUNT" : null;

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing) return;
    const point = pointAt(event);
    if (!point) return;
    event.preventDefault();
    setDraft((current) => {
      // A calibration is exactly two points: the second click replaces the
      // end rather than extending a polyline.
      if (tool === "calibrate" && current.xs.length >= 2) {
        return { xs: [current.xs[0], point.x], ys: [current.ys[0], point.y] };
      }
      return { xs: [...current.xs, point.x], ys: [...current.ys, point.y] };
    });
  };

  const undoPoint = () =>
    setDraft((current) => ({ xs: current.xs.slice(0, -1), ys: current.ys.slice(0, -1) }));

  // ── THE FEET-PER-PAGE-WIDTH THIS SHEET IS CALIBRATED AT ──
  //
  // One derivation, used by the readout below AND by the wall finder, so the
  // two can never disagree about what the sheet's scale is.
  const feetPerUnit = useMemo(
    () => (calibration ? feetPerPageWidth(calibration as StoredCalibration) : null),
    [calibration],
  );

  /**
   * FINDING THE WALLS ON THIS SHEET.
   *
   * ── IT RUNS IN THE BROWSER, AND THAT IS NOT A SHORTCUT ──
   *
   * This component already holds the pdf.js document open to draw the sheet, so
   * the stroked lines a wall is made of are a method call away —
   * `getOperatorList()`, the same one the server-side reader uses. Detecting
   * here means no upload, no round trip, no stored proposals and no new table:
   * the drawing is already here and the answer is already in it.
   *
   * ── IT WORKS IN PAGE-WIDTH UNITS, NOT POINTS ──
   *
   * The finder only needs its coordinates and its feet-per-unit to agree with
   * each other. Converting the segments to the same 0..1 box the measurements
   * live in means the centrelines come back ready to SAVE, with no second
   * conversion anywhere for a sign or a factor to go wrong in.
   *
   * ── WHY A BUTTON RATHER THAN AUTOMATIC ──
   *
   * On the biggest sheet measured this takes about 1.7 seconds and returns 511
   * runs. Doing that unasked, on every sheet somebody opens, would be a freeze
   * nobody requested — and a found wall is a proposal, which should arrive
   * because a person asked a question.
   */
  async function onFindWalls() {
    const doc = docRef.current;
    if (!doc || !pageSize || feetPerUnit === null) return;
    setFinding(true);
    setFindError(null);
    setFound(null);
    setTagNames([]);
    setTypeMatches([]);
    try {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const page = await (doc as { getPage: (n: number) => Promise<unknown> }).getPage(pageNumber);
      const { segments } = await segmentsFromOpenPage(page, pdfjs, pageNumber);
      setStrokesSeen(segments.length);

      // ── WHERE THE WORDS ARE ──
      //
      // Same derivation as `planPdf.ts`: an item's own matrix composed with the
      // viewport's, whose translation is the item's position on the page as
      // displayed. `y` is reported from the TOP of the glyph, so the box is
      // grown downwards by its height.
      const viewport = (page as { getViewport: (o: { scale: number }) => { transform: number[] } }).getViewport({
        scale: 1,
      });
      const content = (await (page as { getTextContent: () => Promise<{ items: unknown[] }> }).getTextContent()) ?? {
        items: [],
      };
      // ONE PASS, TWO CONSUMERS. `wallsNotLettering` wants boxes in page-width
      // units and `wallTypeTags` wants the STRING with its box in points, so
      // the text is read once and both are derived from it. A second
      // `getTextContent()` pass would be a second decode of every glyph on a
      // sheet that can carry tens of thousands.
      const textItems = content.items.flatMap((raw) => {
        const item = raw as { str?: string; transform?: number[]; width?: number; height?: number };
        if (typeof item.str !== "string" || item.str.trim() === "" || !Array.isArray(item.transform)) return [];
        const m = pdfjs.Util.transform(viewport.transform, item.transform);
        const h = item.height ?? 0;
        return [{ str: item.str, x: m[4], y: m[5] - h, width: item.width ?? 0, height: h }];
      });
      const textBoxes = textItems.map((item) => ({
        x: item.x / pageSize.widthPt,
        y: item.y / pageSize.widthPt,
        width: item.width / pageSize.widthPt,
        height: item.height / pageSize.widthPt,
      }));
      // Page-width units: every stored figure is a fraction of THIS page's
      // width, and `width` is deliberately left in points — the pen is compared
      // against other pens on the same sheet, never against a distance, so
      // scaling it would be arithmetic with no meaning.
      const unitsOf = (over: number) => (one: StrokeSegment): StrokeSegment => ({
        x1: one.x1 / over,
        y1: one.y1 / over,
        x2: one.x2 / over,
        y2: one.y2 / over,
        width: one.width,
      });
      const allInUnits = segments.map(unitsOf(pageSize.widthPt));

      // ── THE SET'S OWN TEMPLATE, READ FROM OTHER SHEETS ──
      //
      // #722 fixed the drawing FRAME by geometry and said plainly that the
      // title-block cells were still counted as walls: they are short runs
      // inside the border, and every cheap way to guess that corner also drops
      // real wall, because a plan is routinely drawn right up to it.
      //
      // This is the fix that needs no guess. The frame, the title block and the
      // logo are the only geometry at the SAME page position on every sheet of
      // a set. A wall is not.
      //
      // It costs a few extra page parses. `pagesToSample` spreads them across
      // the whole document rather than taking neighbours, which is the
      // identical-floors guard — levels 3 to 10 of a tower repeat their REAL
      // walls, and evenly spaced samples cross disciplines, where nothing but
      // the template survives. `sheetTemplate.ts` carries the reasoning and the
      // fail-safe: too few sheets read and it filters nothing, because "cannot
      // tell" must not mean "drop it".
      let inUnits = allInUnits;
      let templateDropped = 0;
      try {
        const sampled: StrokeSegment[][] = [];
        for (const n of pagesToSample(doc.numPages, pageNumber)) {
          if (n === pageNumber) {
            sampled.push(allInUnits);
            continue;
          }
          const other = await (doc as { getPage: (n: number) => Promise<unknown> }).getPage(n);
          const read = await segmentsFromOpenPage(other, pdfjs, n);
          // ITS OWN width, not this sheet's. A set with a mixed page size would
          // otherwise compare one sheet's coordinates against another's scale.
          sampled.push(read.segments.map(unitsOf(read.widthPt || pageSize.widthPt)));
        }
        const template = templateFromSheets(sampled);
        if (template.size > 0) {
          const kept = withoutTemplate(allInUnits, template);
          templateDropped = allInUnits.length - kept.length;
          inUnits = kept;
        }
      } catch {
        // A page that will not parse is not a reason to refuse the sheet in
        // front of somebody. Falling through leaves the geometric filters,
        // which is exactly what this sheet had before.
        inUnits = allInUnits;
        templateDropped = 0;
      }
      setTemplateStrokes(templateDropped);
      // BOTH ENGINES, MERGED. Pairing asks "are these two lines a wall" and
      // needs no room to close; the room engine asks which enclosed regions are
      // thin AND separate two different spaces, and does not care how the wall
      // was drawn. Opposite blind spots, so neither wins alone -- measured
      // through the filters below on three real sheets, the union beats both on
      // every one of them (augusta 608/472 -> 707ft, naples 657/789 -> 1,302ft,
      // west-herr 1,495/1,093 -> 1,679ft). `mergeWalls` is what stops the
      // overlap being billed twice; see `wallRuns.ts`.
      const everywhere = wallsFromBothEngines(inUnits, 1, pageSize.heightPt / pageSize.widthPt, {
        feetPerPoint: feetPerUnit,
      });
      // ONLY THE ONES IN THE BUILDING. Without this the title block, the notes
      // column, the sheet border and any detail drawn above the plan all come
      // back as walls — see `wallsInTheBuilding`, which exists because somebody
      // looked at the output rather than at its statistics.
      const inBuilding = wallsInTheBuilding(everywhere, feetPerUnit);
      // AND NOT THE LETTERING. A stroked glyph is two parallel lines and the
      // pairer takes it — two whole groups on one real sheet were dimension
      // strings and room tags. See `wallsNotLettering`.
      const notLettering = wallsNotLettering(inBuilding, textBoxes, feetPerUnit);
      // AND NOT THE SHEET'S OWN BORDER, which a real set offered as a 114ft
      // wall — the longest single run in the panel and entirely false. The
      // height is in page-width units, hence the aspect rather than 1.
      const walls = wallsNotTheSheetBorder(notLettering, 1, pageSize.heightPt / pageSize.widthPt);
      const clusters = clusterByThickness(walls);
      setFound(clusters);
      // ── WHAT THE DRAWING CALLS THESE, where it says so ──
      //
      // The panel otherwise names a group by a NUMBER, and an estimator still
      // has to work out which of their own assemblies a 4-7/8in wall is. The
      // drawing already answers that: it tags walls `EXT-1`, `A1`, `B1` beside
      // the runs they label, and a name is what a catalogue is keyed on.
      // ONE PASS FOR BOTH. `namesForClusters` is derived from
      // `taggedFeetForClusters`, so reading the feet here costs nothing extra
      // and the names on screen cannot disagree with the match beside them.
      const tags = wallTypeTags(textItems, pageSize.widthPt);
      const taggedFeet = taggedFeetForClusters(clusters, walls, tags, feetPerUnit);
      setTagNames(taggedFeet.map((one) => one.map((part) => part.name)));
      setTypeMatches(taggedFeet.map((one) => matchClusterToWallType(one, wallTypes)));
    } catch (problem) {
      // The sheet is still on screen and the manual tools still work, so this
      // says what failed and stops — it does not take the page down.
      //
      // A SHEET THAT IS SIMPLY TOO DENSE GETS ITS OWN SENTENCE, because the
      // generic one sends somebody looking for a broken file. Page 7 of a real
      // airport concourse set carries 30,822 lines long enough to be walls —
      // 475 million pairs to test, against about a million on a sheet that
      // works — and before `SheetTooDenseError` the finder simply never
      // returned. "Couldn't be read" would be false: it was read fine and there
      // is too much of it.
      setFindError(
        problem instanceof SheetTooDenseError
          ? problem.message
          : "The lines on this sheet couldn't be read. Trace the walls by hand as usual.",
      );
    } finally {
      setFinding(false);
    }
  }

  /** Accepting a group writes its runs as ordinary LINEAR measurements, which
   *  is the whole point: everything downstream — the measurement list, the wall
   *  type, the height, the priced wall run — already works on those and needs
   *  no part of this. */
  async function onAcceptCluster(index: number) {
    const cluster = found?.[index];
    if (!cluster || !sheet) return;
    const match = typeMatches[index];
    const body = new FormData();
    body.set("pageId", sheet.id);
    // ── THE LABEL CARRIES THE DRAWING'S OWN WORD WHERE THERE IS ONE ──
    //
    // `4⅞" wall` is what the app measured; `W1 wall` is what the drawing calls
    // it, and it is what the estimator will be looking for in the list and on
    // the recap. The thickness stays alongside it, because that is the evidence
    // the match was right.
    body.set(
      "label",
      match?.state === "MATCH" ? `${match.tag} wall — ${inchLabel(cluster.inches)}` : `${inchLabel(cluster.inches)} wall`,
    );
    // AND THE TYPE, so the action posts a priced run instead of bare
    // quantities. Only on a MATCH: every other state is a refusal this
    // component must not overrule.
    if (match?.state === "MATCH") body.set("wallTypeId", match.type.id);
    for (const run of cluster.runs) {
      body.append("shape", JSON.stringify({ xs: [run.x1, run.x2], ys: [run.y1, run.y2] }));
    }
    const result = await saveTakeoffMeasurements(jobId, body);
    if (!result.ok) return setFindError(result.error);
    // Only the accepted group leaves the list. The rest stay on screen, because
    // an estimator works through them one at a time and re-running the finder
    // to get back to where they were would be a punishment for accepting one.
    setFound((current) => (current ?? []).filter((_, i) => i !== index));
  }

  // ── What the draft currently measures, for the live readout ───────────
  const draftReading = useMemo(() => {
    if (!calibration || draft.xs.length === 0) return null;
    const stored: StoredCalibration = calibration;
    const scale = feetPerPageWidth(stored);
    if (scale === null) return null;
    if (tool === "linear" && draft.xs.length >= 2) {
      return `${(polylineLength(draft.xs, draft.ys) * scale).toFixed(1)} ft`;
    }
    if (tool === "area" && draft.xs.length >= 3) {
      if (ringSelfIntersects(draft.xs, draft.ys)) return "crosses itself";
      const area = ringArea(draft.xs, draft.ys);
      return area === null ? null : `${Math.round(area * scale * scale)} sq ft`;
    }
    if (tool === "count") return `${draft.xs.length}`;
    return null;
  }, [calibration, draft, tool]);

  const calibrationDraft: StoredCalibration | null =
    tool === "calibrate" && draft.xs.length === 2
      ? { x1: draft.xs[0], y1: draft.ys[0], x2: draft.xs[1], y2: draft.ys[1], declaredDistanceFeet: 1 }
      : null;

  const scaleReading = calibration ? readScale(calibration, sheet?.pageWidthPt ?? null) : null;

  return (
    <div className="flex flex-col gap-3">
      {/* ── Toolbar ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line-card bg-surface-card p-2">
        <div className="flex items-center gap-1">
          {TOOLS.map((entry) => {
            const disabled = entry.id !== "pan" && entry.id !== "calibrate" && !calibration;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTool(entry.id)}
                disabled={disabled}
                title={disabled ? "Set the scale on this sheet first." : entry.hint}
                className={`rounded-md px-2 py-1 text-xs ${
                  tool === entry.id
                    ? "bg-brand text-neutral-900"
                    : "border border-line-card text-ink-label hover:bg-neutral-800"
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                {entry.label}
              </button>
            );
          })}
        </div>

        <span className="mx-1 h-4 w-px bg-line-card" aria-hidden />

        {/* ── ZOOM, WITH FIT AS A FIRST-CLASS SETTING ──

            − and + step through `ZOOM_STEPS`. From FIT they step off the
            CURRENT rendered size rather than jumping to a remembered index, so
            pressing − on a fitted 42-inch sheet makes it a little smaller
            instead of suddenly enormous. */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoom(stepZoom(zoomFactor, -1))}
            disabled={zoomFactor <= ZOOM_STEPS[0]}
            aria-label="Zoom out"
            className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800 disabled:opacity-40"
          >
            −
          </button>
          <span className="w-12 text-center text-xs text-ink-muted" data-takeoff="zoom">
            {Math.round(zoomFactor * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom(stepZoom(zoomFactor, 1))}
            disabled={zoomFactor >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
            aria-label="Zoom in"
            className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800 disabled:opacity-40"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setZoom(FIT)}
            data-takeoff="fit"
            className={`ml-1 rounded-md border px-2 py-1 text-xs ${
              zoom === FIT
                ? "border-tag-amber-ink text-tag-amber-ink"
                : "border-line-card text-ink-label hover:bg-neutral-800"
            }`}
          >
            Fit
          </button>
        </div>

        {pageCount !== null && pageCount > 1 && (
          <>
            <span className="mx-1 h-4 w-px bg-line-card" aria-hidden />
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPageNumber((n) => Math.max(1, n - 1))}
                disabled={pageNumber <= 1}
                className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800 disabled:opacity-40"
              >
                Prev
              </button>
              <span className="text-xs text-ink-muted">
                Sheet {pageNumber} of {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPageNumber((n) => Math.min(pageCount, n + 1))}
                disabled={pageNumber >= pageCount}
                className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </>
        )}

        {/* FIND THE WALLS — only once the sheet is calibrated, and the reason
            is structural rather than tidy: the finder's bounds are in FEET of
            building ("thinner than 2-1/2in is not a wall"), so without a scale
            there is no feet-per-unit and every bound means nothing. Same guard
            the measuring tools already carry, for the same reason. */}
        {/* ── SHOWN DISABLED WITHOUT A SCALE, NOT HIDDEN ──

            The gate itself is structural and unchanged: `wallVectors` asks "is
            this thinner than 2-1/2in", so without a calibration there is no
            feet-per-point and every bound in it means nothing.

            HIDING it was the mistake, and it was reported the day it shipped —
            somebody opened a sheet, went looking for the button they had been
            told about, and found nothing. No error, no explanation, just an
            absence, which reads as "this feature does not exist" rather than
            "this sheet needs a scale first". Three separate defects this week
            have had that shape; a capability nobody can see is a capability
            nobody has.

            So it is on the toolbar either way, and `title` says what is in the
            way. The measuring tools beside it already take exactly this
            posture — disabled until the sheet is calibrated, never hidden. */}
        <button
          type="button"
          onClick={onFindWalls}
          disabled={finding || !calibration}
          data-takeoff="find-walls"
          title={calibration ? undefined : "Set the scale on this sheet first — wall thickness is measured in feet of building."}
          className="min-h-[36px] rounded-md border border-line-card bg-surface px-3 text-xs font-medium text-ink-body hover:bg-rail-hover disabled:opacity-40"
        >
          {finding ? "Reading the lines…" : "Find the walls"}
        </button>

        {/* ── THERE IS NO "FIND THE ROOMS" BUTTON, AND THAT IS DELIBERATE ──
            #702 shipped one and it was clicked on real sheets the same day.
            It runs, it is fast, and ITS ANSWER IS WRONG in a way that reads as
            right: on a West Herr floor plan it reported 46 rooms and 4,555 sf
            for a building about 290 ft across, having missed Showroom 101,
            Sales 103, Hospitality 105, New Car Delivery 140 and the whole
            right-hand wing — while outlining a parked car, the gaps between
            dimension strings, and two keynote tags.

            That is the worst shape a takeoff can have: a confident number that
            is far too low. An estimator who trusts it bids half a building.

            The cause is known and is not a threshold. `roomAreas.ts` rasterises
            EVERY stroke, so a leader line crossing a room cuts the region in
            half and a dimension string encloses one of its own. The wall finder
            has `wallsNotLettering`, `wallsInTheBuilding` and
            `wallsNotTheSheetBorder` for exactly this; the room finder has none
            of them. See `roomAreas.ts`'s header.

            `roomAreas.ts` and its tests stay: the geometry is right and the fix
            is to what reaches it. The BUTTON is gone until the numbers say it
            is fit to use, and `takeoffRoomFinder.test.tsx` now asserts it is
            absent so it cannot come back without somebody reading this. */}

        {/* WHICH FLOOR THIS SHEET DRAWS, beside the scale because that is the
            other thing about a sheet an estimator has to know before tracing
            it. Silent when the title names no floor — a single-storey job has
            no levels and a label saying "no level" would be noise on every
            sheet of it. See `sheetLevel.ts` for why a sheet naming TWO floors
            is also silent. */}
        {levelByPage?.[pageNumber] !== undefined && (
          <span
            data-takeoff="sheet-level"
            className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-body"
          >
            {levelByPage[pageNumber]}
          </span>
        )}

        <span className="ml-auto text-xs text-ink-muted">
          {calibration ? (
            <>
              Scale set{scaleReading?.name ? `: ${scaleReading.name}` : ""}
              {scaleReading ? ` · sheet reads ${Math.round(scaleReading.sheetWidthFeet)} ft across` : ""}
            </>
          ) : (
            <span className="text-tag-amber-ink">Set the scale on this sheet before measuring.</span>
          )}
        </span>
      </div>

      {findError && (
        <p className="mt-2 rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-tag-amber-ink">
          {findError}
        </p>
      )}

      {/* ── WHAT THE SHEET GAVE UP, BIGGEST FOOTAGE FIRST ──

          ── THIS LIST IS LONGER THAN ANYBODY EXPECTS, AND THAT IS THE TRUTH ──

          The obvious design is "here are your three wall types". Seven real
          sheets were measured before this was written and they return 15 to 21
          thickness groups each, with the top three holding only about half the
          footage. Showing three and calling it the answer would hide footage an
          estimator is going to bid.

          So: sorted by FEET, biggest first, the top six shown and the rest
          counted honestly underneath. What the measurement also showed is that
          the big groups are the real ones — 4.88", 4.92" and 4.80" on three
          unrelated projects, every one of them a 4-7/8" partition, which is a
          3-5/8" stud with 5/8" board each side. Noise does not land on 4-7/8".

          That is the actual promise of this feature, and it is smaller and more
          honest than "it does your takeoff": the biggest wall types come for
          free. Accepting one group on one real sheet replaced ninety-nine hand
          traces. Whatever it missed is still traced the way it always was. */}
      {/* ── THE SHEET IS THE INSTRUMENT, SO IT GETS THE ROOM ──
          Found walls used to stack ABOVE the drawing, and the frame reserved a
          fixed 22rem for them whether they were there or not. With six groups
          showing, the panel took the top half of the screen and the sheet was
          left a short strip — and because Fit fits BOTH dimensions, a short
          frame makes a small sheet, so the width beside it went empty. A real
          click-through landed at 11% zoom with a third of the screen black.

          That is backwards for a feature whose entire verification step is
          LOOKING at the drawing: the found walls are a claim, and the sheet is
          the only thing that can check it. So on a wide screen they sit side by
          side and the drawing takes what is left, which is most of it. Narrow
          screens keep the stack, where a column each would make both unusable. */}
      <div className="flex flex-col gap-3 xl:flex-row-reverse xl:items-start">
      {found !== null && (
        <div
          className="rounded-md border border-line-card bg-surface p-3 xl:w-[23rem] xl:shrink-0 xl:overflow-auto xl:max-h-[calc(var(--shell-port)-11rem)]"
          data-takeoff="found-walls"
        >
          {/* ABOVE the groups, because a caution under the thing it is about is
              read after the decision has been made — `PlanSheetReview`'s
              convention and the one the quote reader's cautions follow. */}
          {duplicateWallsByPage[pageNumber] && found.length > 0 && (
            <p
              className="mb-3 rounded-md bg-tag-amber p-2 text-xs text-tag-amber-ink"
              data-takeoff="duplicate-walls-caution"
            >
              <span className="font-semibold">Check this is the right sheet. </span>
              {duplicateWallsByPage[pageNumber]}
            </p>
          )}
          {found.length === 0 ? (
            /* ── TWO KINDS OF EMPTY, AND THIS SAID THE WRONG ONE ──

               It read: "a scanned or image-only sheet has no lines to read."
               That is one reason a sheet yields nothing, and the app had no
               idea whether it was THIS sheet's reason. A click-through found it
               on a drawing made entirely of line work and said so: the sheet
               was plainly not a scan, and the message asserted a cause nobody
               had established.

               The app knows which it is — it has just counted the strokes. A
               sheet with none is genuinely an image; a sheet with fifty
               thousand has lines that did not pair, which is a different fact
               and a different thing for an estimator to do about it. */
            <p className="text-sm text-ink-body" data-takeoff="no-walls">
              {strokesSeen === 0
                ? "No walls found: this sheet has no line work at all, so it is an image or a scan. There is nothing here to read. Trace them by hand as usual."
                : `No walls found. This sheet does have line work — ${strokesSeen.toLocaleString()} lines — but none of it paired up as a wall. That happens when walls are drawn as a single line or as solid fill rather than two faces. Trace them by hand as usual.`}
            </p>
          ) : (
            <>
              <p className="mb-2 text-sm text-ink-body">
                Found {found.reduce((n, c) => n + c.runs.length, 0)} runs of wall. Each group is drawn on the
                sheet in its own colour — check it sits on real walls before adding it.
              </p>
              {/* WHAT THE TEMPLATE ACCOUNTED FOR, SAID OUT LOUD.
                  A filter that quietly returns a smaller number is how the next
                  unexplained figure gets created — the same rule the drawing-index
                  check learned the hard way. If this number is large and the panel
                  is empty, the filter is the first thing to suspect rather than the
                  sheet. */}
              {templateStrokes > 0 && (
                <p className="mb-2 text-xs text-ink-muted">
                  {templateStrokes.toLocaleString()} line{templateStrokes === 1 ? "" : "s"} on this sheet also
                  appear in the same place on the rest of the set — the border, the title block and the logo —
                  so they were left out.
                </p>
              )}
              <ul className="flex flex-col gap-1">
                {found.slice(0, 6).map((cluster, index) => (
                  <li
                    key={`${cluster.inches}-${index}`}
                    className="flex flex-wrap items-center gap-3 rounded-md px-2 py-1 hover:bg-rail-hover"
                    onMouseEnter={() => setHovered(index)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <span
                      aria-hidden
                      className="h-3 w-3 shrink-0 rounded-sm"
                      style={{ backgroundColor: CLUSTER_COLOURS[index % CLUSTER_COLOURS.length] }}
                    />
                    <span className="text-sm font-medium text-ink">{inchLabel(cluster.inches)}</span>
                    <ClusterTag names={tagNames[index] ?? []} />
                    <span className="text-sm text-ink-body">
                      {cluster.runs.length} {cluster.runs.length === 1 ? "run" : "runs"} ·{" "}
                      {Math.round(cluster.feet).toLocaleString()} ft
                    </span>
                    {/* ── WHAT THE BUTTON PROMISES IS WHAT IT DOES ──
                        A matched group goes straight onto the estimate PRICED,
                        so the button says so. An unmatched one still writes
                        plain measurements, exactly as before, and says that
                        instead — the difference matters because one of them is
                        finished work and the other is a step. */}
                    <button
                      type="button"
                      onClick={() => void onAcceptCluster(index)}
                      className={`ml-auto min-h-[36px] rounded-md border px-3 text-xs font-medium ${
                        typeMatches[index]?.state === "MATCH"
                          ? "border-brand bg-tag-brand text-tag-brand-ink hover:opacity-90"
                          : "border-line-card text-ink-body hover:bg-rail-hover"
                      }`}
                    >
                      {typeMatches[index]?.state === "MATCH"
                        ? `Add as ${(typeMatches[index] as { tag: string }).tag} — priced`
                        : "Add these"}
                    </button>
                    {/* ── AND WHY, UNDERNEATH ──
                        `matchSentence` returns null for an untagged group on
                        purpose: a line reading "no tag found" on every one of
                        them is the permanent notice this file's own rule calls
                        noise that teaches people to stop reading notices. The
                        two refusals DO get a sentence, because an estimator
                        acts on them differently — a missing wall type is
                        something to go and create, a mixed group is something
                        to trace separately. */}
                    {matchSentence(typeMatches[index] ?? { state: "NO_TAG" }) !== null && (
                      <p className="w-full text-xs text-ink-muted">
                        {matchSentence(typeMatches[index] ?? { state: "NO_TAG" })}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              {found.length > 6 && (
                <p className="mt-2 text-xs text-ink-muted">
                  And {found.length - 6} smaller {found.length - 6 === 1 ? "group" : "groups"}, holding{" "}
                  {Math.round(found.slice(6).reduce((f, c) => f + c.feet, 0)).toLocaleString()} ft between them.
                  A real floor plan carries more wall thicknesses than anybody expects; these are the ones a bid
                  usually turns on.
                </p>
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => setFound(null)}
            className="mt-2 text-xs text-ink-muted underline hover:text-ink-body"
          >
            Clear what was found
          </button>
        </div>
      )}

      {/* ── The sheet ─────────────────────────────────────────────── */}
      {/* The height reserve shrinks to 11rem once the panel is beside rather
          than above; that reserve is the toolbar and the page's own padding,
          and nothing else.

          NO `min-w-0` HERE, though a flex child's default min-width would
          normally demand it: this frame is `overflow-auto`, which establishes a
          scroll container and resets the min-content floor by itself. It was
          written in first, on the usual reasoning, and measured out — identical
          boxes at 1512, 1280, 1024 and 768 with and without it. Unreachable
          code shaped like a safeguard is worse than none. */}
      <div
        ref={frameRef}
        className="relative max-h-[calc(var(--shell-port)-22rem)] min-h-[24rem] overflow-auto rounded-lg border border-line-card bg-neutral-900 xl:flex-1 xl:max-h-[calc(var(--shell-port)-11rem)]"
        data-testid="takeoff-plan-port"
      >
        {loadError ? (
          <p className="p-6 text-sm text-tag-rose-ink">{loadError}</p>
        ) : (
          <div className="relative w-fit">
            <canvas ref={canvasRef} className="block" />
            <svg
              viewBox={`0 0 1 ${aspect}`}
              preserveAspectRatio="none"
              style={{ width: cssWidth ? `${cssWidth}px` : "100%", height: cssWidth ? `${cssWidth * aspect}px` : "100%" }}
              className={`absolute left-0 top-0 ${drawing ? "cursor-crosshair touch-none" : "pointer-events-none"}`}
              onPointerDown={onPointerDown}
            >
              {/* The calibration line, redrawn over the sheet so the scale is
                  something a reviewer can SEE rather than take on faith. */}
              {calibration && (
                <line
                  x1={calibration.x1}
                  y1={calibration.y1}
                  x2={calibration.x2}
                  y2={calibration.y2}
                  stroke="#f0b429"
                  strokeWidth={STROKE_PX}
                  strokeDasharray={`${STROKE_PX * 4} ${STROKE_PX * 2.5}`}
                  vectorEffect="non-scaling-stroke"
                />
              )}

              {(sheet?.measurements ?? []).map((m) => (
                <Shape key={m.id} kind={m.kind} xs={m.xs} ys={m.ys} colour={m.postedAt ? "#6b7280" : "#38bdf8"} />
              ))}

              <FoundWalls clusters={found} hovered={hovered} />

              {draft.xs.length > 0 && (
                <Shape
                  kind={tool === "calibrate" ? "LINEAR" : (kindOf(tool) ?? "LINEAR")}
                  xs={draft.xs}
                  ys={draft.ys}
                  colour="#f0b429"
                  open
                />
              )}
            </svg>
          </div>
        )}
        {isRendering && !loadError && (
          <p className="absolute right-3 top-3 rounded bg-neutral-800 px-2 py-1 text-xs text-ink-muted">Drawing…</p>
        )}
      </div>

      </div>

      {/* ── What the draft reads, and what to do with it ──────────── */}
      {drawing && (
        <div className="rounded-lg border border-line-card bg-surface-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-ink-body">
              {draft.xs.length === 0
                ? TOOLS.find((t) => t.id === tool)?.hint
                : `${draft.xs.length} point${draft.xs.length === 1 ? "" : "s"}${draftReading ? ` · ${draftReading}` : ""}`}
            </p>
            {draft.xs.length > 0 && (
              <button
                type="button"
                onClick={undoPoint}
                className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
              >
                Undo point
              </button>
            )}
            {draft.xs.length > 0 && (
              <button
                type="button"
                onClick={() => setDraft(EMPTY)}
                className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
              >
                Clear
              </button>
            )}
          </div>

          {tool === "calibrate" && (
            <CalibrationForm
              jobId={jobId}
              planId={planId}
              pageNumber={pageNumber}
              pageWidthPt={pageSize?.widthPt ?? null}
              printedScale={printedScaleByPage[pageNumber] ?? null}
              prefill={scalePrefillByPage[pageNumber] ?? null}
              declineReason={scaleDeclineByPage?.[pageNumber] ?? null}
              onUsePrefill={(xs, ys) => {
                // Seeds the draft so the proposed line DRAWS ON THE SHEET over
                // the dimension it was read from. That is the verification
                // channel and the reason this is two clicks rather than one:
                // an estimator should see the line sitting on `16' - 4 1/2"`
                // before agreeing to a number that multiplies through every
                // quantity on the sheet.
                setDraft({ xs: [...xs], ys: [...ys] });
              }}
              existingLabel={sheet?.label ?? ""}
              existingNote={calibration?.note ?? ""}
              draft={calibrationDraft}
              onSaved={() => {
                setDraft(EMPTY);
                setTool("pan");
              }}
            />
          )}

          {tool !== "calibrate" && sheet && draft.xs.length > 0 && (
            <MeasurementForm
              jobId={jobId}
              pageId={sheet.id}
              kind={kindOf(tool) ?? "LINEAR"}
              draft={draft}
              reading={draftReading}
              onSaved={() => setDraft(EMPTY)}
            />
          )}

          {tool !== "calibrate" && !sheet && (
            <p className="mt-2 text-xs text-tag-amber-ink">Set the scale on this sheet before measuring it.</p>
          )}
        </div>
      )}
    </div>
  );
}

/** One shape on the overlay. `open` is a polyline still being drawn. */
/**
 * One colour per group, so the panel and the drawing refer to each other.
 *
 * Six, because a real sheet returns 15-21 thickness clusters and the panel
 * shows the biggest few — a palette per cluster would be unreadable, and these
 * are distinguishable against both a white drawing and each other. They are
 * deliberately not `DESIGN.md` status colours: these mean "group 2", not
 * "warning".
 */
const CLUSTER_COLOURS = ["#38bdf8", "#f472b6", "#a78bfa", "#34d399", "#fbbf24", "#fb923c"];

/**
 * THE FOUND WALLS, DRAWN ON THE DRAWING.
 *
 * ── THIS IS THE VERIFICATION CHANNEL, NOT DECORATION ──
 *
 * `wallVectors.ts` returns CENTRELINES rather than a number, and its header
 * says why: a wrong answer is then a line sitting where there is no wall, which
 * an estimator catches in a glance on a drawing they are already looking at. A
 * takeoff that reported "1,284 ft" and nothing else would be asking them to
 * take it on faith, and a confidently wrong number is the failure
 * `symbolCount.eval.ts` refused to ship. These lines ARE the safety argument
 * for the whole feature.
 *
 * ── AND THAT IS WHY IT IS ITS OWN COMPONENT ──
 *
 * Written inline in the viewer's SVG it could be made to render nothing and
 * every test still passed — measured, as a mutation, which is the only reason
 * anybody knew. The ghosts cannot be reached from a test that way, because they
 * only exist after a real PDF has been read. Exported, they can be handed
 * clusters and looked at. Same move as `errorBandText`: a decision inside JSX
 * is a decision no test can reach.
 *
 * Dashed, and painted under the saved measurements, so a proposal never looks
 * like something already counted.
 */
/**
 * ── THE NAME THE DRAWING GIVES A THICKNESS GROUP ──
 *
 * A thickness is what was MEASURED; a name is what gets mapped to a wall type
 * and priced. Shown beside the thickness rather than instead of it, because the
 * thickness is what an estimator checks against the drawing and the name is
 * what they act on.
 *
 * Renders NOTHING for a group the drawing did not tag, and that is the usual
 * case: only 25-43% of footage carries a tag, because an architect tags
 * representative walls and not every wall. A reassuring phrase on every
 * untagged group would bury the real names.
 *
 * ── EXPORTED BECAUSE THE PANEL CANNOT BE MOUNTED IN A TEST ──
 *
 * The group list only exists after Find-the-walls has run, which needs pdf.js
 * on a canvas — and that never renders in happy-dom, where
 * `getBoundingClientRect` returns zeros. Measured rather than assumed: a probe
 * pressed Set scale, then the port, then the SVG, and the sheet read
 * "Drawing…" throughout. So this is a component so that `wallTags.test.ts`
 * can render it, which is the #665 lesson — a census proves the code is there,
 * only rendering proves somebody can see it.
 */
export function ClusterTag({ names }: { names: readonly string[] }) {
  const sentence = tagSentence(names);
  if (sentence === null) return null;
  return (
    <span
      className="rounded bg-tag-slate px-1.5 py-0.5 text-xs font-medium text-tag-slate-ink"
      data-takeoff="cluster-tag"
      title={sentence}
    >
      {names.join(" / ")}
    </span>
  );
}

export function FoundWalls({
  clusters,
  hovered,
}: {
  clusters: WallCluster[] | null;
  hovered: number | null;
}) {
  if (clusters === null) return null;
  return (
    <>
      {clusters.map((cluster, index) =>
        cluster.runs.map((run, runIndex) => (
          <line
            key={`${index}-${runIndex}`}
            data-found-wall={index}
            x1={run.x1}
            y1={run.y1}
            x2={run.x2}
            y2={run.y2}
            stroke={CLUSTER_COLOURS[index % CLUSTER_COLOURS.length]}
            strokeWidth={hovered === index ? STROKE_PX * 2.5 : STROKE_PX}
            strokeDasharray={`${STROKE_PX * 3} ${STROKE_PX * 2}`}
            strokeOpacity={hovered === null || hovered === index ? 1 : 0.25}
            vectorEffect="non-scaling-stroke"
          />
        )),
      )}
    </>
  );
}

function Shape({
  kind,
  xs,
  ys,
  colour,
  open = false,
}: {
  kind: MeasurementKind;
  xs: number[];
  ys: number[];
  colour: string;
  open?: boolean;
}) {
  const points = xs.map((x, i) => `${x},${ys[i]}`).join(" ");
  if (kind === "COUNT") {
    return (
      <g>
        {xs.map((x, i) => (
          <circle key={i} cx={x} cy={ys[i]} r={0.006} fill={colour} fillOpacity={0.9} />
        ))}
      </g>
    );
  }
  if (kind === "AREA" && !open) {
    return (
      <polygon
        points={points}
        fill={colour}
        fillOpacity={0.18}
        stroke={colour}
        strokeWidth={STROKE_PX}
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  return (
    <g>
      <polyline
        points={points}
        fill={kind === "AREA" ? colour : "none"}
        fillOpacity={kind === "AREA" ? 0.12 : 0}
        stroke={colour}
        strokeWidth={STROKE_PX}
        vectorEffect="non-scaling-stroke"
      />
      {xs.map((x, i) => (
        <circle key={i} cx={x} cy={ys[i]} r={0.004} fill={colour} />
      ))}
    </g>
  );
}

/**
 * THE READBACK IS THE SAFEGUARD. The scale is named in the estimator's own
 * vocabulary, and the sheet width is stated in feet, while the drawing is
 * still on screen — so a wrong calibration is caught before a single quantity
 * comes off it. Every sentence here is computed by the same pure module the
 * server re-runs before saving.
 */
/**
 * WHAT THE SHEET SAID ABOUT ITS OWN SCALE, offered rather than applied.
 *
 * It shows its work, and that is the whole design. Never a bare
 * `1/8" = 1'-0"`: the dimensions that agreed are listed, because an estimator
 * can glance at the sheet and see `16' - 4 1/2"` printed where this says it is.
 * A reason nobody can check is a reason nobody can overrule — the sentence
 * `PlanSheetProposal.proposedReason` already insists on, applied to geometry.
 *
 * Pressing it draws the proposed line ON THE DRAWING and fills the box; the
 * estimator then presses the same button they press today. Two clicks against
 * today's find-a-dimension, click, click, type — and nothing reaches a quantity
 * without somebody having looked at the line, which matters because a scale
 * error multiplies through every wall on the sheet.
 */
/**
 * EXPORTED FOR A RENDER TEST, and the reason is a limit rather than a
 * preference. The panel this returns lives inside `CalibrationForm`'s DRAFT
 * branch, which needs a line drawn on the sheet — and the sheet is pdf.js on a
 * canvas, which never renders in happy-dom (`getBoundingClientRect` returns
 * zeros, so no click can become a point). Mounting the whole viewer therefore
 * cannot reach this panel at all, measured rather than assumed: a probe clicked
 * Set scale, then the port, then the SVG, and the sheet read "Drawing…"
 * throughout.
 *
 * So `reducedPrintCaution.test.tsx` renders this directly. That proves the
 * branch and its wording, and it deliberately does NOT claim the panel is
 * navigable — see that file's own note on what it is and is not evidence for.
 */
export function ScaleOffer({ prefill, onUse }: { prefill: ScalePrefill; onUse: () => void }) {
  // Both of these are PURE and live in `takeoff-plan-view.ts`, where they are
  // tested — the wording of a measured error and the order of the evidence are
  // decisions, and a decision written inline in JSX is one no test can reach.
  const band = errorBandText(prefill.inheritedError);
  const shown = evidenceOrder(prefill.agreed, prefill.declaredText);

  // ── A SCALE OFF THE TITLE BLOCK, WITH NOTHING ON THE SHEET TO CHECK IT ──
  //
  // The sentence is the whole of what makes this path acceptable. A
  // dimension-derived scale is offered with the dimensions it matched and a line
  // drawn over one of them, so an estimator verifies it by looking. A printed
  // one cannot be verified by looking at anything, and #623 declined it for
  // exactly that reason. It ships because a real bid set reads 9 of ~30 sheets
  // from dimensions while 16 more PRINT their scale — but it ships SAYING so,
  // never dressed as the other kind.
  if (prefill.unconfirmed) {
    return (
      <div className="rounded-md border border-line-card bg-surface p-2">
        {/* ── A REDUCED PRINT GOES FIRST, AND IN THE WARNING COLOUR ──
            It is not a footnote to the scale, it is a correction OF the scale:
            the number above it has already been changed, and an estimator who
            reads only the first line has to be the one who learns that. The
            key's page 50 measured every length at half without this. */}
        {prefill.reducedPrintCaution !== undefined && (
          <p
            className="mb-2 rounded bg-tag-amber px-2 py-1 text-[11px] font-medium text-tag-amber-ink"
            data-takeoff="reduced-print-caution"
          >
            {prefill.reducedPrintCaution}
          </p>
        )}
        <p className="text-xs text-ink-body">
          {prefill.reducedPrintCaution === undefined ? (
            <>
              The title block on this sheet says <span className="font-semibold text-ink">{prefill.scaleName}</span>.
            </>
          ) : (
            <>
              Corrected for the reduction, this sheet measures{" "}
              <span className="font-semibold text-ink">{prefill.scaleName}</span>.
            </>
          )}
        </p>
        <p className="mt-1 text-[11px] text-ink-muted">
          {/* Said plainly rather than softened. The estimator is accepting a
              figure with nothing to look at, and that is their decision to make
              knowingly. */}
          Nothing measurable on this sheet confirms it —{" "}
          {/* "DID NOT AGREE" WAS THE WRONG WORD FOR THE COMMON CASE, and a
              click-through caught it: a sheet with 2 printed dimensions cannot
              agree on anything, because three are needed before a scale is
              taken seriously. Saying they disagreed invites somebody to go
              looking for a contradiction that is not there — and on the sheet
              that reported it, one of the two measured correctly. */}
          {prefill.considered === 0
            ? "no printed dimensions could be read here"
            : prefill.considered < 3
              ? `only ${prefill.considered} printed dimension${prefill.considered === 1 ? "" : "s"} could be read, ` +
                `too few to confirm a scale from`
              : `its ${prefill.considered} printed dimensions did not settle on one scale`}
          . Using it sets the scale from the printed figure alone.
        </p>
        <button
          type="button"
          onClick={onUse}
          className="mt-2 rounded-md border border-line-card bg-surface px-2 py-1 text-xs text-ink-body hover:bg-rail-hover"
        >
          Use the printed scale
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-line-card bg-surface p-2">
      <p className="text-xs text-ink-body">
        This sheet reads <span className="font-semibold text-ink">{prefill.scaleName}</span>
        {prefill.agreed.length > 0 && (
          <>
            {" — matched "}
            {prefill.agreed.length} printed dimension{prefill.agreed.length === 1 ? "" : "s"}
            {prefill.considered > prefill.agreed.length && ` of ${prefill.considered} found`}.
          </>
        )}
      </p>
      {/* THE QUOTED DIMENSION GOES FIRST, and a click-through is why.

          This row used to be `agreed.slice(0, 6)` in whatever order the vote
          produced, while the sentence below quotes the ONE pair being proposed.
          On a sheet with 24 matched dimensions the quoted one was not among the
          six shown — "Within 0.17% on 25' - 0 1/2"" above a row that did not
          contain `25' - 0 1/2"`. Both facts were true and the pair read as a
          contradiction, which is worse than showing less. */}
      {shown.length > 0 && <p className="mt-1 text-[11px] text-ink-muted">{shown.join("   ")}</p>}
      <p className="mt-1 text-[11px] text-ink-muted">
        {/* THE BAND IS MEASURED, AND IT USED TO PRINT A FLOOR AS IF IT WERE THE
            MEASUREMENT. `band < 0.05 ? "0.05" : …` meant a pair accurate to
            0.01% was reported as "Within 0.05%" — while the note written beside
            it said 0.01%, because that one formats the real figure. A
            click-through caught the contradiction.

            Rounding UP to a floor is defensible in a progress bar and indefensible
            in a number about accuracy: it is the figure somebody would rely on,
            and it was overstating the error rather than the precision, which is
            the direction that makes the feature look worse than it is. Either
            way, two places showing one quantity differently is a defect.

            Under a hundredth of a percent now says so as an inequality rather
            than inventing a value — `toFixed(2)` on 0.004 would print "0.00",
            which claims perfection. */}
        Within {band} on {prefill.declaredText || "the dimension it read"}.
      </p>
      <button
        type="button"
        onClick={onUse}
        className="mt-2 rounded-md border border-line-card bg-surface px-2 py-1 text-xs text-ink-body hover:bg-rail-hover"
      >
        Use this dimension
      </button>
    </div>
  );
}

/**
 * STROKE WIDTH IN SCREEN PIXELS, because `vectorEffect="non-scaling-stroke"`
 * means that is the unit — and these lines were set to 0.002 of one.
 *
 * Found by a click-through of the prefill: the two end dots rendered on the
 * drawing and **the line between them did not**. The dots are plain circles
 * with `r={0.004}` in the viewBox's own units, so they scale and show. Every
 * stroked line carries `non-scaling-stroke`, which makes its width a count of
 * device pixels rather than user units — so `0.002` asked for two thousandths
 * of a pixel.
 *
 * The pairing was incoherent under either reading, which is what makes this a
 * defect rather than a taste: if the vector effect applies, the line is
 * invisible; if it did not apply, the effect was pointless. 2 is the width that
 * matches the intent the attribute was reaching for.
 *
 * This is NOT specific to the prefill — the same renderer draws every
 * hand-clicked draft and every posted measurement, so it was always this thin.
 * Nothing in this repo could have caught it: the screen suite renders in
 * happy-dom, which does no layout.
 */
const STROKE_PX = 2;

function CalibrationForm({
  jobId,
  planId,
  pageNumber,
  pageWidthPt,
  printedScale,
  existingLabel,
  existingNote,
  draft,
  prefill,
  declineReason,
  onUsePrefill,
  onSaved,
}: {
  jobId: string;
  planId: string;
  pageNumber: number;
  pageWidthPt: number | null;
  printedScale: string | null;
  existingLabel: string;
  existingNote: string;
  draft: StoredCalibration | null;
  prefill: ScalePrefill | null;
  declineReason: string | null;
  onUsePrefill: (xs: readonly [number, number], ys: readonly [number, number]) => void;
  onSaved: () => void;
}) {
  const [typed, setTyped] = useState("");
  /**
   * WHY THIS SCALE IS THE RIGHT ONE, and it has to survive the save.
   *
   * `TakeoffScaleCalibration.note` is described in the schema as "the one thing
   * here that records WHY this scale is the right one". Until now the prefill
   * filled the distance and left this empty, so once a scale was accepted
   * NOTHING recorded where it came from — a scale read off the title block,
   * which nothing on the sheet confirms, became indistinguishable from one
   * matched against five printed dimensions. A click-through caught it: *"the
   * toolbar doesn't show which way the scale was set."*
   *
   * That matters beyond tidiness. If a bid is ever questioned, "this came from
   * the printed figure alone" is the sentence somebody needs, and it is the one
   * sentence the estimator cannot reconstruct a week later.
   *
   * Still editable, because it is the estimator's own note and they may know
   * more than the app does.
   */
  const [note, setNote] = useState("");

  const preview = useMemo(() => {
    if (!draft) return null;
    const parsed = parseDeclared(typed);
    const line: StoredCalibration = { ...draft, declaredDistanceFeet: parsed ?? 1 };
    const notices = calibrationNotices(line, pageWidthPt, null, printedScale);
    return { notices, refusal: calibrationRefusal(notices), parsed };
  }, [draft, typed, pageWidthPt, printedScale]);

  if (!draft) {
    return (
      <div className="mt-2 flex flex-col gap-2">
        {/* WHERE A SAVED SCALE CAME FROM, which was stored and then shown
            nowhere at all.

            Since #655 the automatic reader writes its own account into
            `note` — which dimensions it matched and how closely, or that it
            used the printed scale with nothing confirming it. That is
            provenance for a number multiplying every quantity on the sheet.

            It was only ever rendered INSIDE the draft form, and a sheet with a
            scale already set has no draft — so the moment it was saved it
            became invisible. A click-through went looking for it on two sheets
            that saved successfully and reported, correctly, that nothing on
            screen says which way a scale was set.

            Shown here rather than in the toolbar because the toolbar states
            WHAT the scale is in six words and this is a sentence; this panel is
            where somebody who doubts it has already come to look. */}
        {/* ── WHY THIS SHEET OFFERED NOTHING ──

            The reader has recorded a reason for every decline since #655 — "its
            lettering was saved as line work rather than characters, so there is
            nothing here to read a scale from. Set it by hand." — and it was
            written to the database and shown to NOBODY. An estimator got an
            empty form and no explanation, which reads as a broken feature.

            It matters most on the sets that provoked it. Two whole bid packages
            measured here have their text converted to outlines — 373,377 strokes
            and ZERO text items on one sheet — so EVERY sheet in both declines
            and the app looks broken across an entire project.

            It is not broken, and saying so is the point. The dimensions are
            still printed on those sheets; a person reads `24'-0"` perfectly
            well, it is simply drawn as lines. Setting the scale by hand works as
            it always has, and the wall finder then works too — 150, 135 and 105
            walls on three of those sheets, measured. What was lost is the
            automatic scale, not the takeoff.

            Shown only when there is no prefill: a sheet that offered something
            does not need to explain itself. */}
        {prefill === null && declineReason && (
          <p className="rounded-md border border-line-card bg-surface px-2 py-1.5 text-[11px] text-ink-muted">
            <span className="text-ink-body">C Stream couldn&apos;t read a scale here:</span> {declineReason}
          </p>
        )}

        {existingNote && (
          <p className="rounded-md border border-line-card bg-surface px-2 py-1.5 text-[11px] text-ink-muted">
            <span className="text-ink-body">How this sheet&apos;s scale was set:</span> {existingNote}
          </p>
        )}
        {prefill && (
          <ScaleOffer
            prefill={prefill}
            onUse={() => {
              onUsePrefill(prefill.xs, prefill.ys);
              // The provenance, in words, so it survives the save — see `note`
              // above for why that is not cosmetic.
              setNote(
                prefill.unconfirmed
                  ? `From the ${prefill.scaleName} printed on this sheet. Nothing measurable on the sheet ` +
                    `confirmed it.`
                  : `Matched ${prefill.agreed.length} printed dimension${prefill.agreed.length === 1 ? "" : "s"}` +
                    ` on this sheet (${prefill.agreed.slice(0, 3).join(", ")}), within ` +
                    `${(prefill.inheritedError * 100).toFixed(2)}%.`,
              );
              // A PRINTED scale's `declaredText` is the scale NAME, not a
              // distance, so typing it into the distance box would be nonsense.
              // The figure there is what the printed scale says the sheet's own
              // width is — see `scaleFromPrinted`.
              setTyped(
                prefill.unconfirmed
                  ? formatFeetInches(prefill.declaredFeet)
                  : prefill.declaredText || formatFeetInches(prefill.declaredFeet),
              );
            }}
          />
        )}
        <p className="text-xs text-ink-muted">Click once at each end of a dimension printed on the drawing.</p>
      </div>
    );
  }

  return (
    <ActionForm
      action={saveTakeoffCalibration.bind(null, jobId)}
      className="mt-3 flex flex-col gap-2"
      onSuccess={onSaved}
    >
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="pageNumber" value={pageNumber} />
      {pageWidthPt !== null && <input type="hidden" name="pageWidthPt" value={pageWidthPt} />}
      <input type="hidden" name="points" value={JSON.stringify({ xs: [draft.x1, draft.x2], ys: [draft.y1, draft.y2] })} />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-label">
          What does the drawing say that is?
          {/* inputMode is "text", not "decimal", ON PURPOSE: this field takes
              a dimension as printed — 24'-6" — and a decimal keypad has no
              foot or inch mark on it. The figure still goes through the app's
              one number parser, via `parseFeetInches`. */}
          <input
            name="declaredDistanceFeet"
            inputMode="text"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={"24'-6\""}
            className="w-32 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-label">
          Sheet name
          <input
            name="pageLabel"
            defaultValue={existingLabel}
            placeholder="A-101 First Floor"
            className="w-44 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-label">
          What you measured (optional)
          <input
            name="note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="24'-0&quot; column grid"
            className="w-52 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
          />
        </label>
        <SubmitButton
          type="submit"
          disabled={!preview?.parsed || Boolean(preview?.refusal)}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-neutral-900 disabled:opacity-50"
        >
          Set the scale
        </SubmitButton>
      </div>

      {preview && preview.parsed !== null && (
        <ul className="flex flex-col gap-0.5">
          {preview.notices.map((notice, i) => (
            <li
              key={i}
              className={`text-xs ${notice.level === "refuse" ? "text-tag-rose-ink" : "text-ink-body"}`}
            >
              {notice.message}
            </li>
          ))}
          <li className="text-xs text-ink-muted">
            Reading that back: {formatFeetInches(preview.parsed)}.
          </li>
        </ul>
      )}
    </ActionForm>
  );
}

/** Saves one finished shape. The geometry rides as JSON; nothing numeric the
 * person typed goes anywhere but through the app's parser on the server. */
function MeasurementForm({
  jobId,
  pageId,
  kind,
  draft,
  reading,
  onSaved,
}: {
  jobId: string;
  pageId: string;
  kind: MeasurementKind;
  draft: Draft;
  reading: string | null;
  onSaved: () => void;
}) {
  const problem = verticesProblem(kind, draft.xs, draft.ys);
  const crosses = kind === "AREA" && !problem && ringSelfIntersects(draft.xs, draft.ys);

  return (
    <ActionForm action={saveTakeoffMeasurement.bind(null, jobId)} className="mt-3 flex flex-col gap-2" onSuccess={onSaved}>
      <input type="hidden" name="pageId" value={pageId} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="points" value={JSON.stringify(draft)} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-label">
          {kind === "COUNT" ? "What are you counting?" : "Name this measurement (optional)"}
          <input
            name="label"
            placeholder={kind === "COUNT" ? "can light" : "North corridor"}
            className="w-56 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
          />
        </label>
        {/* ── WHICH PRICING PACKAGE THIS QUANTITY IS IN ──

            Blank is the BASE BID, and the placeholder says so rather than
            leaving it to be inferred from an empty box. That default is the
            safety argument: an estimator who does not think about this puts the
            quantity in the number sent to the GC, which is the recoverable
            error. The opposite default bids LOW, and a low bid is work won at a
            loss and then built.

            `bg-surface` rather than `bg-surface-input` like its neighbour, and
            not a style choice: `surface-input` resolves to nothing on this
            near-black canvas (issue #573) and `colorTokenCensus.test.ts` pins
            the family at exactly 39 uses so it fails when it GROWS. A fortieth
            would red CI. */}
        <label className="flex flex-col gap-1 text-xs text-ink-label">
          Pricing package
          <input
            name="packageLabel"
            placeholder="Base bid"
            data-takeoff="package-label"
            className="w-48 rounded-md border border-line-card bg-surface px-2 py-1 text-sm text-ink-body"
          />
        </label>
        <SubmitButton
          type="submit"
          disabled={Boolean(problem) || crosses}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-neutral-900 disabled:opacity-50"
        >
          Save {reading ? `(${reading})` : "measurement"}
        </SubmitButton>
      </div>
      {problem && <p className="text-xs text-ink-muted">{problem}</p>}
      {crosses && (
        <p className="text-xs text-tag-rose-ink">
          That outline crosses itself, so it has no area. Undo back past the crossing, or clear and draw it again.
        </p>
      )}
    </ActionForm>
  );
}

/** The typed dimension, for the PREVIEW only — the figure that is saved is
 * parsed again on the server by the SAME reader, so the sentence on screen
 * and the number stored cannot disagree. Null while the field is still being
 * typed into, so the readback appears rather than flickering a refusal at
 * every keystroke.
 */
function parseDeclared(typed: string): number | null {
  if (!typed.trim()) return null;
  const parsed = parseFeetInches(typed);
  return parsed.ok ? parsed.n : null;
}
