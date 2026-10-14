"use client";

import { useState } from "react";
import {
  PACKAGE_SLOTS,
  PACKAGE_SLOT_LABEL,
  SKIP_SENTENCE,
  buildPackage,
  packageFileName,
  packageStamp,
  planPackage,
  type PackageEntry,
  type PackagePart,
  type PackageSlot,
  type SkippedPart,
} from "@/lib/estimating/bid-package";

/**
 * BUILDING THE BID PACKAGE — the last manual hour of every bid.
 *
 * What this replaces: print the proposal, download the GC's form, find the cut
 * sheets, open Acrobat or Preview, combine, reorder, save, name it. Of the 34
 * sub-tasks in the estimating workflow, assembling a package was one of only
 * three the app did not do at all.
 *
 * ── IT MERGES ON THIS MACHINE AND UPLOADS NOTHING ──
 *
 * `lib/estimating/bid-package.ts` carries the full argument; the short version
 * is that these are the most confidential documents this product touches, a
 * merge needs no server, and a Server Action body is capped at 1 MB anyway. So
 * the files are read with `FileReader`-era APIs in the page, stapled together
 * here, and handed straight to a download. Nothing is stored, so there is
 * nothing to clean up and nothing to leak.
 *
 * ── WHAT IT DOES NOT DO YET, SAID ON THE SCREEN ──
 *
 * The proposal comes in as a FILE, printed with the button above. It is not
 * generated: the proposal page is print-styled HTML and a second renderer of
 * the document that decides who pays when scope is disputed would be two
 * sources of one legal text.
 *
 * The addenda and compliance certificates this company has already uploaded are
 * NOT pulled in automatically yet. That is the next slice and it is where this
 * stops being a merge tool — but it needs a validated read back out of the blob
 * store per document, and shipping the merge first means that slice lands on an
 * engine already proven against real files.
 */

/** Which slots a person attaches by hand today. Every slot in `PACKAGE_SLOTS`
 *  is offered: the two that will later fill themselves in are still useful as
 *  manual attachments now, and leaving them out would make the order on screen
 *  disagree with the order in the file. */
const OFFERED: readonly PackageSlot[] = PACKAGE_SLOTS;

type Picked = Partial<Record<PackageSlot, File[]>>;

export function BidPackageBuilder({ projectName }: { projectName: string }) {
  const [picked, setPicked] = useState<Picked>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ entries: PackageEntry[]; skipped: SkippedPart[]; pages: number } | null>(
    null,
  );

  const chosenCount = OFFERED.reduce((total, slot) => total + (picked[slot]?.length ?? 0), 0);

  async function build() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const parts: PackagePart[] = [];
      for (const slot of OFFERED) {
        for (const file of picked[slot] ?? []) {
          parts.push({
            slot,
            name: file.name,
            bytes: new Uint8Array(await file.arrayBuffer()),
          });
        }
      }

      const built = await buildPackage(planPackage(parts));
      setResult({ entries: built.entries, skipped: built.skipped, pages: built.totalPages });

      // NULL IS A REAL ANSWER and is not an error to throw. pdf-lib's `save()`
      // on an empty document emits a one-page blank PDF — measured — so the
      // builder returns no bytes rather than a blank file somebody could send
      // to a GC. The skip list below says why each part was left out.
      if (built.bytes === null) return;

      const blob = new Blob([built.bytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      // ── THE CLOCK IS READ HERE, INSIDE THE PRESS, AND THAT IS THE POINT ──
      //
      // A production click-through found two builds of one bid downloading
      // under the same name, with the browser quietly appending `(1)`. A date
      // passed down as a prop would not fix it: every build made from one page
      // load would still share a stamp. Reading the clock at the press is what
      // makes two packages two names.
      //
      // Safe to read a clock here for the reason `localToday.ts` gives — this
      // is an event handler, not render, so there is no server-rendered markup
      // for it to disagree with.
      link.download = packageFileName(projectName, packageStamp(new Date()));
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("That package could not be built. Check the files are PDFs and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="print:hidden mt-6 rounded-md border border-line-card p-4">
      <h3 className="text-sm font-semibold text-ink">Build the bid package</h3>
      <p className="mt-1 text-xs text-ink-muted">
        One PDF, in the order a GC opens it: their form first, then your proposal, then the numbers
        behind it. Print the proposal above first — the files stay on this computer and nothing is
        uploaded.
      </p>

      <ul className="mt-3 flex flex-col gap-2">
        {OFFERED.map((slot) => (
          <li key={slot} className="flex flex-wrap items-center gap-2">
            <label className="flex min-w-[14rem] flex-col text-xs text-ink-label">
              <span className="font-medium text-ink-body">{PACKAGE_SLOT_LABEL[slot].label}</span>
              <span className="text-ink-muted">{PACKAGE_SLOT_LABEL[slot].covers}</span>
            </label>
            <input
              type="file"
              accept="application/pdf"
              multiple
              data-package-slot={slot}
              aria-label={`${PACKAGE_SLOT_LABEL[slot].label} — PDF files`}
              onChange={(event) =>
                setPicked((current) => ({ ...current, [slot]: [...(event.target.files ?? [])] }))
              }
              className="min-h-[36px] text-xs text-ink-body"
            />
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => void build()}
        disabled={busy || chosenCount === 0}
        aria-busy={busy}
        data-package="build"
        className="mt-3 inline-flex min-h-[36px] items-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-40"
      >
        {busy ? "Building…" : "Build the package"}
      </button>

      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}

      {result && (
        <div className="mt-3 text-xs">
          {result.entries.length > 0 ? (
            <>
              <p className="text-ink-body">
                {result.pages} page{result.pages === 1 ? "" : "s"}, in this order:
              </p>
              <ol className="mt-1 list-decimal pl-5 text-ink-muted">
                {result.entries.map((entry) => (
                  <li key={`${entry.slot}-${entry.name}-${entry.startsOnPage}`}>
                    {PACKAGE_SLOT_LABEL[entry.slot].label} — {entry.name} ({entry.pages} page
                    {entry.pages === 1 ? "" : "s"}, from page {entry.startsOnPage})
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="text-rose-300">
              Nothing could go in, so no file was made. Every part is listed below with the reason.
            </p>
          )}

          {/* EVERY SKIP IS NAMED. A missing bid form is why a bid gets
              rejected, so a part that did not make it must never be silent —
              the builder reports them and this prints all of them. */}
          {result.skipped.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-amber-300">
              {result.skipped.map((skip) => (
                <li key={`${skip.slot}-${skip.name}-${skip.reason}`}>
                  Left out — {PACKAGE_SLOT_LABEL[skip.slot].label}, {skip.name}:{" "}
                  {SKIP_SENTENCE[skip.reason]}.
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
