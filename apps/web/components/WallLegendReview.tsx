"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addWallTypeFromLegend, readLegendBySight, type LegendTypeEdits } from "@/lib/actions";
import type { LegendProposalView } from "@/lib/plan-ingest/legendProposalsQuery";
import { sameCode } from "@/lib/takeoff/legendMerge";
import type { StoredCrop, StoredLegendType } from "@/lib/takeoff/legendProposal";
import { nominalThicknessIn } from "@/lib/takeoff/legendBands";
import { fraction } from "@/lib/takeoff/partitionAssembly";

/**
 * ── THE REVIEW SCREEN FOR A SET'S WALL LEGEND ──
 *
 * Each legend page is a card; each type on it is a row with the CROP of the
 * drawing the reader placed for it on the left and the merged reading on the
 * right. The crop is cut in the browser from the same PDF the viewer shows,
 * at the rectangle the ingest stored, so what the person sees is what the
 * model will be shown if they ask for the drawing to be read too.
 *
 * Flags are red and sit above the fields they are about, because a flag is
 * the reason to look at the crop. The fields are plain inputs; what is typed
 * is what the Add action builds the parts from, so an edit here IS the
 * correction. "In your library" is derived from the codes the page loaded,
 * never stored.
 *
 * The server has no rasteriser, which is why rendering lives here: the page
 * image and the crops for the sight read are produced the way the scanned-
 * sheet tiles are, from pdf.js on a canvas, and posted as base64.
 */

type Edits = LegendTypeEdits;

// pdfjs ships no types for the legacy build entry.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfPage = any;

const PAGE_PX_MAX = 2000;
const PAGE_DPI_MAX = 100;
const CROP_DPI = 200;
const POINTS_PER_INCH = 72;

async function openPage(planId: string, pageNumber: number): Promise<PdfPage> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ url: `/api/takeoff/plan/${planId}`, standardFontDataUrl: "/pdfjs/standard_fonts/" }).promise;
  return doc.getPage(pageNumber);
}

/** Render a rectangle of the page (points, y down) at `scale` px per point onto a fresh canvas. */
async function renderRect(page: PdfPage, rect: { x: number; y: number; width: number; height: number }, scale: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const viewport = page.getViewport({ scale, offsetX: -rect.x * scale, offsetY: -rect.y * scale });
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

function pngBase64(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png").split(",")[1] ?? "";
}

function editsFor(type: StoredLegendType): Edits {
  const read = type.assembly.read;
  return {
    code: type.code,
    name: type.name ?? "",
    studWidthIn: read.studWidthIn,
    studSpacingIn: read.studSpacingIn,
    boardThicknessIn: read.boardThicknessIn,
    layersPerSide: read.layersPerSide,
    insulation: read.insulation,
    hourlyRating: read.hourlyRating,
    thicknessIn: nominalThicknessIn(read),
  };
}

/** The first clause of a flag's reason, so a row carries one short line per flag. */
export function shortFlag(why: string): string {
  const cut = why.split(/\s[—–]\s|;\s/)[0].trim();
  return cut.length > 96 ? `${cut.slice(0, 93).trimEnd()}…` : cut;
}

function notAPartition(type: StoredLegendType): string | null {
  const flag = type.assembly.flags.find((f) => f.why.startsWith("not a partition"));
  return flag ? flag.why : null;
}

export function WallLegendReview({
  jobId,
  proposals,
  plans,
  libraryCodes,
  canAdd,
}: {
  jobId: string;
  proposals: LegendProposalView[];
  plans: { id: string; label: string }[];
  libraryCodes: string[];
  canAdd: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {proposals.map((proposal) => (
        <LegendPageCard
          key={proposal.id}
          jobId={jobId}
          proposal={proposal}
          planLabel={plans.find((p) => p.id === proposal.planId)?.label ?? "this set"}
          libraryCodes={libraryCodes}
          canAdd={canAdd}
        />
      ))}
    </div>
  );
}

const CONFIDENCE_LABEL: Record<LegendProposalView["confidence"], string> = {
  HIGH: "clear on the sheet",
  MEDIUM: "worth checking",
  LOW: "least sure — read this one",
};

function LegendPageCard({
  jobId,
  proposal,
  planLabel,
  libraryCodes,
  canAdd,
}: {
  jobId: string;
  proposal: LegendProposalView;
  planLabel: string;
  libraryCodes: string[];
  canAdd: boolean;
}) {
  const router = useRouter();
  const [page, setPage] = useState<PdfPage | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [sightMessage, setSightMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    openPage(proposal.planId, proposal.pageNumber)
      .then((p) => {
        if (!cancelled) setPage(p);
      })
      .catch(() => {
        if (!cancelled) setPageError("The drawing couldn't be opened here, so the crops can't be shown. The readings below still stand.");
      });
    return () => {
      cancelled = true;
    };
  }, [proposal.planId, proposal.pageNumber]);

  function onReadDrawing() {
    if (page === null) return;
    setSightMessage(null);
    startTransition(async () => {
      try {
        const unit = page.getViewport({ scale: 1 });
        const pageScale = Math.min(PAGE_PX_MAX / unit.width, PAGE_DPI_MAX / POINTS_PER_INCH);
        const full = await renderRect(page, { x: 0, y: 0, width: unit.width, height: unit.height }, pageScale);
        const crops = [];
        for (const crop of proposal.crops) {
          const canvas = await renderRect(page, crop, CROP_DPI / POINTS_PER_INCH);
          crops.push({ code: crop.code, imageBase64: pngBase64(canvas), mediaType: "image/png" as const });
        }
        const result = await readLegendBySight(jobId, proposal.id, { imageBase64: pngBase64(full), mediaType: "image/png" }, crops);
        if (!result.ok) return setSightMessage(result.error);
        setSightMessage(`Read the drawing: ${result.value.typeCount} ${result.value.typeCount === 1 ? "type" : "types"}. Where the drawing and the words disagreed, the drawing was kept and the row says so.`);
        router.refresh();
      } catch {
        setSightMessage("The drawing couldn't be rendered for reading. Reload the page and try again.");
      }
    });
  }

  const where = `${proposal.sheetNumber ? `${proposal.sheetNumber} · ` : ""}${proposal.sheetTitle ?? `page ${proposal.pageNumber}`}`;
  return (
    <section className="rounded-lg border border-line-card bg-surface p-4" data-legend="page" data-legend-page={proposal.pageNumber}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">
          {where} <span className="font-normal text-ink-muted">· {planLabel} · page {proposal.pageNumber}</span>
        </h3>
        <span className="text-xs text-ink-muted">
          {proposal.types.length} {proposal.types.length === 1 ? "type" : "types"} · {CONFIDENCE_LABEL[proposal.confidence]}
          {proposal.hasSight ? " · words and drawing" : " · words only"}
        </span>
      </div>
      {/* The model's account of the sheet is a paragraph an estimator does not
          need to read to use the rows; it is here for the one who wants to know
          why a type was read the way it was, one click away. */}
      <details className="mt-1 text-xs text-ink-muted" data-legend="how-read">
        <summary className="cursor-pointer">How this was read</summary>
        <p className="mt-1 max-w-prose text-ink-body">{proposal.reason}</p>
      </details>
      {pageError !== null && <p className="mt-2 text-xs text-ink-muted">{pageError}</p>}
      {!proposal.hasSight && (
        <div className="mt-3 flex flex-col items-start gap-1">
          <button
            type="button"
            onClick={onReadDrawing}
            disabled={isPending || page === null}
            className="min-h-[40px] rounded-md bg-rail-hover px-3 text-sm font-medium text-ink hover:bg-lift disabled:opacity-50"
            data-legend="read-drawing"
          >
            {isPending ? "Reading the drawing…" : "Check these against the drawing"}
          </button>
          <p className="text-xs text-ink-muted">
            Sends this page and each type&rsquo;s crop to the reader. The drawing wins where it disagrees with the words, and
            every disagreement is flagged. Uses one sheet.
          </p>
        </div>
      )}
      {sightMessage !== null && <p className="mt-2 text-sm text-ink-body">{sightMessage}</p>}
      <ul className="mt-4 divide-y divide-line-row">
        {proposal.types.map((type) => (
          <LegendTypeRow
            key={type.code}
            jobId={jobId}
            proposalId={proposal.id}
            type={type}
            crop={proposal.crops.find((c) => sameCode(c.code, type.code)) ?? null}
            page={page}
            inLibrary={libraryCodes.some((code) => sameCode(code, type.code))}
            canAdd={canAdd}
          />
        ))}
      </ul>
    </section>
  );
}

function LegendTypeRow({
  jobId,
  proposalId,
  type,
  crop,
  page,
  inLibrary,
  canAdd,
}: {
  jobId: string;
  proposalId: string;
  type: StoredLegendType;
  crop: StoredCrop | null;
  page: PdfPage | null;
  inLibrary: boolean;
  canAdd: boolean;
}) {
  const router = useRouter();
  const [edits, setEdits] = useState<Edits>(() => editsFor(type));
  const [message, setMessage] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const notPartition = useMemo(() => notAPartition(type), [type]);
  const set = <K extends keyof Edits>(key: K, value: Edits[K]) => setEdits((e) => ({ ...e, [key]: value }));
  const num = (value: string): number | null => (value.trim() === "" ? null : Number(value));

  function onAdd() {
    setMessage(null);
    startTransition(async () => {
      const result = await addWallTypeFromLegend(jobId, proposalId, edits);
      if (!result.ok) return setMessage(result.error);
      setAdded(true);
      const h = result.value.height;
      const height =
        h.heightFt === null
          ? ` ${h.sentence}`
          : ` Height ${h.heightFt} ft (${h.confidence}${h.generalNoteOnly ? " — general note only, check the sheet" : ""}).`;
      setMessage(
        `Added ${result.value.code} with ${result.value.componentCount} ${result.value.componentCount === 1 ? "part" : "parts"}. Open Wall types to put prices and crews on it.${height}`,
      );
      router.refresh();
    });
  }

  const from = type.from === "both" ? "words and drawing" : type.from === "sight" ? "the drawing" : "the words";
  return (
    <li className="grid gap-4 py-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" data-legend="type" data-legend-code={type.code}>
      <div>
        <LegendCrop page={page} crop={crop} code={type.code} />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-base font-semibold text-ink">{type.code}</span>
          {type.name && <span className="text-sm text-ink-body">{type.name}</span>}
          <span className="text-xs text-ink-muted">read from {from}</span>
          {(inLibrary || added) && (
            <span className="rounded bg-rail-hover px-2 py-0.5 text-xs font-medium text-ink" data-legend="in-library">
              in your library
            </span>
          )}
        </div>
        {type.assembly.flags.length > 0 && (
          <ul className="flex flex-col gap-1" data-legend="flags">
            {type.assembly.flags.map((flag, index) => (
              <li key={index} className="text-sm text-danger">
                {/* One line: the first clause of the reason. The whole sentence and
                    the words it came from are a click away, so a row stays a row. */}
                <details>
                  <summary className="cursor-pointer">{shortFlag(flag.why)}</summary>
                  <p className="mt-1 text-xs text-ink-body">
                    {flag.why}
                    {flag.phrase && flag.phrase !== flag.why && <span className="text-ink-muted"> — &ldquo;{flag.phrase}&rdquo;</span>}
                  </p>
                </details>
              </li>
            ))}
          </ul>
        )}
        {notPartition === null ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {/* The two free-text boxes are written out with LITERAL names: the
                  numeric-input census reads names off the source and treats one
                  it cannot read as possibly numeric. */}
              <label className="col-span-2 flex flex-col gap-0.5 text-xs text-ink-muted">
                Name
                <input type="text" name="name" value={edits.name} onChange={(event) => set("name", event.currentTarget.value)} className={FIELD_CLASS} />
              </label>
              <Field name="studWidthIn" label="Stud width (in)" value={edits.studWidthIn} onChange={(v) => set("studWidthIn", num(v))} />
              <Field name="studSpacingIn" label="Spacing (in o.c.)" value={edits.studSpacingIn} onChange={(v) => set("studSpacingIn", num(v))} />
              <Field name="boardThicknessIn" label="Board (in)" value={edits.boardThicknessIn} onChange={(v) => set("boardThicknessIn", num(v))} />
              <Field name="layersPerSide" label="Layers per side" value={edits.layersPerSide} onChange={(v) => set("layersPerSide", num(v))} />
              <label className="flex flex-col gap-0.5 text-xs text-ink-muted">
                Insulation
                <input
                  type="text"
                  name="insulation"
                  value={edits.insulation ?? ""}
                  onChange={(event) => set("insulation", event.currentTarget.value.trim() === "" ? null : event.currentTarget.value)}
                  className={FIELD_CLASS}
                />
              </label>
              <Field name="hourlyRating" label="Fire rating (hr)" value={edits.hourlyRating} onChange={(v) => set("hourlyRating", num(v))} />
              <Field name="thicknessIn" label="Wall thickness (in)" value={edits.thicknessIn} onChange={(v) => set("thicknessIn", num(v))} />
            </div>
            {type.assembly.components.length > 0 && (
              <ul className="text-xs text-ink-body" data-legend="parts">
                {type.assembly.components.map((c, index) => (
                  <li key={index}>
                    {c.description} <span className="text-ink-muted">· {BASIS_LABEL[c.basis] ?? c.basis}{c.factor !== 1 ? ` × ${fraction(c.factor)}` : ""}{c.unit ? ` ${c.unit}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
            {canAdd && !inLibrary && !added && (
              <div className="flex flex-col items-start gap-1">
                <button
                  type="button"
                  onClick={onAdd}
                  disabled={isPending}
                  className="min-h-[40px] rounded-md border border-brand bg-tag-brand px-3 text-sm font-medium text-tag-brand-ink hover:opacity-90 disabled:opacity-50"
                  data-legend="add"
                >
                  {isPending ? "Adding…" : `Add ${type.code} to your library`}
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-ink-body">Not offered for the library.</p>
        )}
        {message !== null && (
          <p className="text-sm text-ink-body" data-legend="message">
            {message}
          </p>
        )}
        {type.lines.length > 0 && (
          <details className="text-xs text-ink-muted">
            <summary className="cursor-pointer">The legend&rsquo;s own words</summary>
            <ul className="mt-1 list-inside list-disc">
              {type.lines.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </li>
  );
}

const BASIS_LABEL: Record<string, string> = {
  LINEAR_FT: "per foot of wall",
  FACE_SQFT: "per sq ft of face",
  BOARDED_SQFT: "per sq ft boarded",
  STUDS: "per stud",
  PER_RUN: "per run",
};

const FIELD_CLASS = "min-h-[36px] rounded-md border border-line-card bg-canvas px-2 text-sm text-ink";

function Field({
  name,
  label,
  value,
  onChange,
}: {
  name: string;
  label: string;
  value: number | null;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5 text-xs text-ink-muted">
      {label}
      <input
        type="text"
        name={name}
        inputMode="decimal"
        value={value === null ? "" : String(value)}
        onChange={(event) => onChange(event.currentTarget.value)}
        className={FIELD_CLASS}
      />
    </label>
  );
}

/** The crop of the drawing the reader placed for this type, cut from the page in the browser. */
function LegendCrop({ page, crop, code }: { page: PdfPage | null; crop: StoredCrop | null; code: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"waiting" | "drawn" | "failed">("waiting");
  useEffect(() => {
    if (page === null || crop === null || ref.current === null) return;
    let cancelled = false;
    const target = ref.current;
    (async () => {
      try {
        const dpr = window.devicePixelRatio || 1;
        const widthCss = Math.min(target.parentElement?.clientWidth ?? 360, 480);
        const scale = (widthCss / crop.width) * dpr;
        const drawn = await renderRect(page, crop, scale);
        if (cancelled) return;
        target.width = drawn.width;
        target.height = drawn.height;
        target.style.width = `${widthCss}px`;
        target.style.height = `${Math.round(drawn.height / dpr)}px`;
        target.getContext("2d")?.drawImage(drawn, 0, 0);
        setState("drawn");
      } catch {
        if (!cancelled) setState("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, crop]);
  if (crop === null) {
    return <p className="text-xs text-ink-muted">No crop was placed for {code} — the code was not found printed on the legend page.</p>;
  }
  return (
    <div className="rounded-md border border-line-card bg-white p-1" data-legend="crop" data-legend-crop-state={state}>
      <canvas ref={ref} aria-label={`The legend's drawing for ${code}`} />
      {state === "waiting" && <p className="p-2 text-xs text-ink-muted">Rendering the crop…</p>}
      {state === "failed" && <p className="p-2 text-xs text-ink-muted">The crop couldn&rsquo;t be rendered here.</p>}
    </div>
  );
}
