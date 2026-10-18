import { requireCompanyContext } from "@/lib/auth";
import { LABEL_DIR_VAR, writeLabels } from "@/lib/plan-ingest/labelStore";
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

  const written = await writeLabels(parsed.set, parsed.sheet, body);
  if (!written.ok) {
    return NextResponse.json({ ok: false, error: written.error }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    path: written.path,
    candidates: parsed.candidates.length,
    note: `Set ${LABEL_DIR_VAR} to change where these go.`,
  });
}
