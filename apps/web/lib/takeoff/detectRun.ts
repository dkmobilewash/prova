import { detectForSheet, type SheetDetectInput, type SheetDetectResult } from "./offeredCandidates";
import { SheetTooSlowError, withTimeBudget } from "./timeBudget";
import { SheetTooDenseError, type WallCandidate } from "./wallVectors";

// The finder's run for `detectOffThread.ts`, in a module of its own so the worker can import it
// without importing the code that starts the worker.

/** One pairing as the viewer collects it (`onCandidate`): the run and its feature vector. */
export type FoundPairing = Pick<WallCandidate, "x1" | "y1" | "x2" | "y2" | "lengthFeet" | "thicknessFeet"> & { features: number[] };

export type DetectRequest = { input: Omit<SheetDetectInput, "onCandidate">; budgetMs: number };

/** What crosses back: the result without its function (`regroup`), which the page rebuilds. */
type Sent = Omit<SheetDetectResult, "found"> & { found: Omit<SheetDetectResult["found"], "regroup"> };

export type DetectReply =
  | { ok: true; detected: Sent; pairings: FoundPairing[] }
  | { ok: false; kind: "too-dense"; usableSegments: number }
  | { ok: false; kind: "too-slow"; stage: string; seconds: number }
  | { ok: false; kind: "failed"; message: string };

/** The work itself, the same in the worker and on the page. */
export function runDetection(request: DetectRequest): DetectReply {
  const pairings: FoundPairing[] = [];
  try {
    const detected = withTimeBudget(request.budgetMs, () =>
      detectForSheet({
        ...request.input,
        onCandidate: (features, wall) =>
          pairings.push({ x1: wall.x1, y1: wall.y1, x2: wall.x2, y2: wall.y2, lengthFeet: wall.lengthFeet, thicknessFeet: wall.thicknessFeet, features: [...features] }),
      }),
    );
    // A function cannot cross to the page; it rebuilds `regroup` from `regroupRecipe`.
    const { regroup, ...found } = detected.found;
    void regroup;
    return { ok: true, detected: { ...detected, found }, pairings };
  } catch (error) {
    if (error instanceof SheetTooSlowError) return { ok: false, kind: "too-slow", stage: error.stage, seconds: error.seconds };
    if (error instanceof SheetTooDenseError) return { ok: false, kind: "too-dense", usableSegments: error.usableSegments };
    return { ok: false, kind: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}
