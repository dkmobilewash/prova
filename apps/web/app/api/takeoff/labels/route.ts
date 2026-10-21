import { requireCompanyContext } from "@/lib/auth";
import { LABEL_DIR_VAR, labellingAllowed, readLabels, writeLabels } from "@/lib/plan-ingest/labelStore";
import { labelFile, type LabelCandidate, type LabelVerdict } from "@/lib/takeoff/labelRows";
import type { SplitRecord } from "@/lib/takeoff/answerKeyReview";
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
/**
 * ── READING A SAVED SHEET BACK ──
 *
 * This route had a POST and no GET, so a sheet could be labelled and never
 * reopened: coming back to add a few traces meant deciding every candidate
 * again. Nothing was broken — the capability was simply absent, and the
 * labelling page had no way to ask.
 *
 * Returns the saved file as it sits on disk. The page matches its verdicts to
 * the candidates the finder produces NOW, by geometry, and refuses rather than
 * restore half a review — `lib/takeoff/restoreSaved.ts` says why at length.
 *
 * Same gate as the write: `labelStore.ts` refuses when the variable is unset,
 * on a production build, and on any path escape, so this is inert in every
 * deployment. A signed-in user is required here as it is for the POST.
 */
/** The same answer for a read and a write, and the same one a customer's
 *  deployment gives for an unknown route: labelling is not a thing here. The
 *  refusal's reason is logged by the store, never sent — a server's
 *  environment has no business in a response. */
function notHere() {
  return NextResponse.json({ ok: false, error: "Labelling is off here." }, { status: 404 });
}

export async function GET(request: Request) {
  await requireCompanyContext();

  const url = new URL(request.url);
  const set = url.searchParams.get("set") ?? "";
  const sheet = url.searchParams.get("sheet") ?? "";
  if (set === "" || sheet === "") {
    return NextResponse.json(
      { ok: false, error: "Ask for a set and a sheet." },
      { status: 400 },
    );
  }
  if (!labellingAllowed(process.env)) return notHere();

  const saved = await readLabels(set, sheet);
  if (saved === null) {
    // NOT an error: a sheet nobody has labelled is the ordinary case, and the
    // page needs to tell the two apart without reading a message.
    return NextResponse.json({ ok: true, saved: null });
  }
  return NextResponse.json({ ok: true, saved });
}

export async function POST(request: Request) {
  // Signed in, because this writes a file. The gate that matters is in
  // `labelStore`, but an unauthenticated write endpoint is not a thing to
  // leave lying about even behind one.
  await requireCompanyContext();
  if (!labellingAllowed(process.env)) return notHere();

  let body: unknown;
  try {
    body = await request.json();
  } catch (cause) {
    // ── SAY WHAT WENT WRONG, AND HOW BIG IT WAS ──
    //
    // "The request body was not JSON" is true and useless. On 2026-10-20 it
    // was the only thing anybody could see while a reviewer's finished sheet
    // sat in an open tab: the body was 11.27 MB, the middleware TRUNCATED it
    // at 10 MB, and `request.json()` threw on half a document. Nothing in the
    // message said size, and the cause was found in a Next log line nobody
    // was looking at.
    //
    // The length and the parser's own complaint go to the server log — not
    // to the browser, which has no business being told how the server failed
    // — and the reviewer is told the one thing that helps: their work is
    // still on the page.
    const length = request.headers.get("content-length");
    // eslint-disable-next-line no-console
    console.error(
      `[labels] could not parse a save body` +
        (length === null ? "" : ` of ${(Number(length) / (1024 * 1024)).toFixed(2)} MB`) +
        `: ${String(cause).slice(0, 200)}`,
    );
    return NextResponse.json(
      {
        ok: false,
        error:
          "The request body could not be read — it may be too large. Nothing was saved, " +
          "and your decisions are still on this page. The server log has the details.",
      },
      { status: 400 },
    );
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
    /**
     * ── THE MERGE: WHAT THE REOPEN COULD NOT SHOW ──
     *
     * Saved decisions whose candidates this build no longer proposes. They
     * are written back exactly as they came, each naming the build that
     * produced the candidate it judged. Without this, adding one trace to a
     * sheet labelled on an older finder would delete every decision that no
     * longer matches — which is the same accident the guard below was written
     * for, arriving through a different door.
     */
    carried?: (LabelVerdict & { finderVersion?: string })[];
    /** Splits the reviewer made, as geometry, so a reopen need not guess. */
    splits?: SplitRecord[];
    /** The previous file's rows, kept whole for one generation. */
    carriedRows?: { finderVersion: string | null; rows: readonly unknown[] } | null;
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
    carried: input.carried ?? [],
    splits: input.splits ?? [],
    carriedRows: input.carriedRows ?? null,
  });
  // ── A SAVE MUST NOT QUIETLY REPLACE A BIGGER REVIEW ──
  //
  // The app cannot RELOAD a saved review, so opening a sheet that already has
  // labels starts from a blank one — and Save then replaces everything that
  // was there. That is how Camp Bow Wow A101's 143 verdicts became 15: a
  // second pass over the same sheet, saved, and about twenty-four minutes of
  // somebody's work gone with no warning and no copy.
  //
  // A sheet's labels CAN be loaded back in now (`restoreSaved`), and a save
  // merges in every verdict the reopen could not show — so the ordinary path
  // no longer shrinks a file at all. This stays as the backstop it always
  // was: it refuses the SHAPE of that accident, a save carrying far fewer
  // verdicts than the file already holds, whatever produced it. It does not refuse a smaller save outright — a reviewer may
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
