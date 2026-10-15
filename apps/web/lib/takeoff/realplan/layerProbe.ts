
/**
 * ── DOES A REAL PLAN SET SAY WHICH LINES ARE WALLS? ──
 *
 *     REAL_PLAN_PDF="/path/to/a real set.pdf" REAL_PLAN_PAGES=1,21,30 \
 *       pnpm --filter @prova/web exec vitest run \
 *       --config vitest.eval.config.mts lib/takeoff/realplan/layers.eval.ts
 *
 * Every filter the wall finder has is GEOMETRY. That is why the letters of an
 * architect's logo come back as walls — they really are two parallel lines a
 * wall-thickness apart — and why the cars on a parking plan do too. Geometry is
 * answering correctly; the question is wrong.
 *
 * A PDF exported from AutoCAD or Revit WITH LAYER INFORMATION carries every
 * stroke inside an optional-content group whose name is the CAD layer:
 * `A-WALL`, `A-ANNO-DIMS`, `S-GRID`, `A-FURN`, `G-ANNO-TTLB`. The drawing has
 * been telling us which lines are walls the whole time and nothing reads it.
 *
 * ── THIS EXISTS TO BE RUN BEFORE THE WORK, NOT AFTER IT ──
 *
 * The bench's fixtures all carry layer names, because we write them. That
 * proves nothing about an architect's export, and "no real set has layers" is
 * the one finding that would make the whole approach worthless. It costs one
 * command to rule out, so it is ruled out first.
 *
 * ── IT READS THE FILE, NOT OUR READER ──
 *
 * Deliberately NOT built on `sheetStrokes.ts`. A probe whose job is to decide
 * whether to change that module must not inherit its blind spots, and at the
 * time this was written that module did not look at optional content at all —
 * so building on it would have reported zero layers on every file in the world.
 * This walks the operator list itself.
 *
 * ── CONFIDENTIALITY ──
 *
 * `realPlan.eval.ts` sets the posture and this follows it: the path comes from
 * the environment, nothing is committed, and with no `REAL_PLAN_PDF` the file
 * runs one case that says so and passes.
 *
 * It prints LAYER NAMES, which is a deliberate exception to "metadata only" and
 * the reason is that the names ARE the measurement — a count of unnamed groups
 * answers nothing. They are structural, not drawing content: no room names, no
 * sheet titles, no notes, no dimensions, no text from the page. It runs on the
 * operator's own machine and prints to their own terminal, and the person who
 * chose the path chooses what to do with the output. A layer named after a
 * project would be the one thing here that carries any, so read before pasting.
 */

/** Longest name printed in full, so one pathological name cannot flood a terminal. */
const NAME_CAP = 60;

export type PageReport = {
  pageNumber: number;
  /** Every `constructPath`, the control: zero means a scan or a read that failed,
   *  and without it "no layers" and "no geometry" look identical. */
  pathOperators: number;
  /** Path operators that were inside SOME optional-content group. */
  underOptionalContent: number;
  /** Path operators per layer name, biggest first. */
  byLayer: { name: string; pathOperators: number; visible: boolean }[];
};

export async function readLayers(bytes: Buffer, pageNumbers: number[]): Promise<PageReport[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    verbosity: 0,
  }).promise;
  try {
    // ONE CONFIG FOR THE DOCUMENT. `getGroup(id).name` is how an id out of the
    // operator list becomes a layer name; `isVisible` is how a layer the
    // architect switched OFF is told from one they left on. Both are
    // `pdfjs-dist@4.10.38`, read from its source rather than remembered.
    const config = await doc.getOptionalContentConfig().catch(() => null);
    const out: PageReport[] = [];

    for (const pageNumber of pageNumbers) {
      if (pageNumber > doc.numPages) continue;
      const page = await doc.getPage(pageNumber);
      try {
        const ops = await page.getOperatorList();
        const { OPS } = pdfjs;
        const counts = new Map<string, { n: number; visible: boolean }>();
        let pathOperators = 0;
        let underOptionalContent = 0;
        // Marked content NESTS, so this is a stack and not a variable. The
        // entries are the layer in force, or null for a non-OC marked section
        // (`/Artifact BDC`, a tagged-PDF span) which must still be POPPED or
        // every later layer is attributed to the wrong group.
        const marks: (string | null)[] = [];

        for (let i = 0; i < ops.fnArray.length; i += 1) {
          const fn = ops.fnArray[i];
          if (fn === OPS.beginMarkedContent) {
            marks.push(null);
            continue;
          }
          if (fn === OPS.beginMarkedContentProps) {
            const args = ops.argsArray[i] as [string, unknown];
            marks.push(args?.[0] === "OC" ? idOf(args[1]) : null);
            continue;
          }
          if (fn === OPS.endMarkedContent) {
            marks.pop();
            continue;
          }
          if (fn !== OPS.constructPath) continue;
          pathOperators += 1;
          // The INNERMOST layer wins: content inside `A-WALL` inside a tagged
          // section belongs to A-WALL.
          const id = [...marks].reverse().find((m) => m !== null) ?? null;
          if (id === null) continue;
          underOptionalContent += 1;
          const group = config?.getGroup(id) ?? null;
          const name = (group?.name as string | undefined) ?? `(unnamed ${id})`;
          const at = counts.get(name) ?? { n: 0, visible: config?.isVisible?.({ type: "OCG", id }) !== false };
          at.n += 1;
          counts.set(name, at);
        }

        out.push({
          pageNumber,
          pathOperators,
          underOptionalContent,
          byLayer: [...counts.entries()]
            .map(([name, v]) => ({ name: name.slice(0, NAME_CAP), pathOperators: v.n, visible: v.visible }))
            .sort((a, b) => b.pathOperators - a.pathOperators),
        });
      } finally {
        page.cleanup();
      }
    }
    return out;
  } finally {
    await doc.destroy();
  }
}

/** The OC argument is `{ type: "OCG", id }` or `{ type: "OCMD", ids: [...] }`.
 *  An OCMD over several groups is attributed to its first, which is what the
 *  renderer's own visibility policy falls back to for the common single-group
 *  case; a multi-group OCMD is rare enough that over-reporting one name beats
 *  inventing a composite one. */
function idOf(oc: unknown): string | null {
  if (typeof oc !== "object" || oc === null) return null;
  const o = oc as { id?: unknown; ids?: unknown };
  if (typeof o.id === "string") return o.id;
  if (Array.isArray(o.ids) && typeof o.ids[0] === "string") return o.ids[0];
  return null;
}

