import { requireCompanyContext } from "@/lib/auth";
import { LABEL_DIR_VAR, readLabels, writeLabels } from "@/lib/plan-ingest/labelStore";
import { labelFile, type LabelCandidate, type LabelVerdict } from "@/lib/takeoff/labelRows";
import { NextResponse } from "next/server";

/**
 * ── SAVING A REVIEWED SHEET AS TRAINING DATA ──
 *
 * A reviewed sheet is not only an answer key, it is the feature vector of
 * every candidate the finder produced with the reviewer's verdict on it. That
 * is the bottleneck for the hybrid plan: synthetic training was measured and
 * lost, so real labelled sheets are the only way forward.
 *
 * Writes to a folder on this machine. `labelStore.ts` holds the gate and its
 * reasons — unset variable, production build and path escape all refuse there,
 * and this route adds nothing to that beyond requiring a signed-in user.
 *
 * NOT customer-facing. It exists so a hired estimator can label sheets on a
 * machine we set up, and it is inert anywhere `TAKEOFF_LABEL_DIR` is not set,
 * which is every deployment.
 */
export async function POST(request: Request) {
  // Signed in, because this writes a file. The gate that matters is in
  // `labelStore`, but an unauthenticated write endpoint is not a thing to
  // leave lying about even behind one.
  await requireCompanyContext();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "The request body was not JSON." }, { status: 400 });
  }

  const parsed = body as {
    set?: unknown;
    sheet?: unknown;
    candidates?: unknown;
    verdicts?: unknown;
  };
  if (typeof parsed.set !== "string" || typeof parsed.sheet !== "string") {
    return NextResponse.json(
      { ok: false, error: "A plan set and a sheet are needed to name the file." },
      { status: 400 },
    );
  }
  if (!Array.isArray(parsed.candidates)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "No candidates were sent. A sheet saved without them is a score and " +
          "not training data, which is the whole point of this.",
      },
      { status: 400 },
    );
  }

  // ── THE VERDICTS ARE CARRIED BACK TO THE PAIRINGS HERE ──
  //
  // A reviewer judges runs; a model decides pairings. `labelFile` does the
  // carrying and is tested on its own, because a label attached to the wrong
  // candidate trains the model to do the opposite of what the reviewer said
  // and nothing about the file would look wrong.
  const input = body as {
    set: string;
    sheet: string;
    page?: number;
    reviewedBy?: string;
    secondsSpent?: number;
    feetPerUnit?: number;
    reviewComplete?: boolean;
    unreviewed?: number;
    /** Acknowledges replacing a larger saved review. */
    replacing?: boolean;
    candidates: LabelCandidate[];
    verdicts?: LabelVerdict[];
  };
  const file = labelFile({
    set: input.set,
    sheet: input.sheet,
    page: input.page ?? 1,
    reviewedBy: input.reviewedBy ?? "",
    secondsSpent: input.secondsSpent ?? 0,
    feetPerUnit: input.feetPerUnit ?? 1,
    reviewComplete: input.reviewComplete === true,
    candidates: input.candidates,
    verdicts: input.verdicts ?? [],
    unreviewed: input.unreviewed ?? 0,
  });
  // ── A SAVE MUST NOT QUIETLY REPLACE A BIGGER REVIEW ──
  //
  // The app cannot RELOAD a saved review, so opening a sheet that already has
  // labels starts from a blank one — and Save then replaces everything that
  // was there. That is how Camp Bow Wow A101's 143 verdicts became 15: a
  // second pass over the same sheet, saved, and about twenty-four minutes of
  // somebody's work gone with no warning and no copy.
  //
  // Until a sheet's labels can be loaded back in, this refuses the shape of
  // that accident: a save carrying far fewer verdicts than the file already
  // holds. It does not refuse a smaller save outright — a reviewer may
  // legitimately redo a sheet — it refuses an UNACKNOWLEDGED one, and says
  // exactly what it is protecting so the answer is obvious.
  const existing = await readLabels(parsed.set, parsed.sheet, process.env);
  if (existing !== null) {
    const had = existing.verdicts?.length ?? 0;
    const now = file.verdicts.length;
    if (had >= 20 && now < had * 0.6 && input.replacing !== true) {
      return NextResponse.json(
        {
          ok: false,
          error:
            `This sheet already has ${had} verdicts and this save carries ${now}. ` +
            `Saving would replace the larger review. If that is what you want, ` +
            `save again with "replacing" set.`,
          had,
          now,
        },
        { status: 409 },
      );
    }
  }

  const written = await writeLabels(parsed.set, parsed.sheet, file);
  if (!written.ok) {
    return NextResponse.json({ ok: false, error: written.error }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    path: written.path,
    candidates: parsed.candidates.length,
    rows: file.rows.length,
    note: `Set ${LABEL_DIR_VAR} to change where these go.`,
  });
}
