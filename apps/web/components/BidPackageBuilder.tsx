"use client";

import { useState, useTransition } from "react";
import { Spinner } from "@/components/Spinner";
import { uploadDocumentFile } from "@/lib/document-upload-client";
import { submitBidPackage } from "@/lib/actions";
import { submissionBody, submissionSubject } from "@/lib/estimating/bid-submission";
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

/** What this job's bid can be sent to, when one is linked to it. */
export type SubmitTarget = {
  bidInvitationId: string;
  companyId: string;
  companyName: string;
  gcName: string;
  /** Every address already recorded against the GC. The person CHOOSES from
   *  these; the action refuses anything else. A free-text box would make "who
   *  did we send the bid to" a question about somebody's typing. */
  addresses: { address: string; name: string | null }[];
  /** Why it cannot be sent, when that is the answer — no bid linked, no
   *  address on file, sending not set up. Shown instead of the controls. */
  problem: string | null;
  /** What the estimate check already found for this bid, newest first. Read
   *  only: the agent advises and writes nothing (`lib/agents/core.ts`). */
  findings: { id: string; title: string; href: string | null }[];
};

export function BidPackageBuilder({
  projectName,
  submit,
}: {
  projectName: string;
  /**
   * Absent when this job has no bid linked to it, which is most jobs: a
   * `BidInvitation` is company-scoped and only a WON one carries `wonJobId`.
   * The package still builds and downloads — assembling is useful on its own
   * and was the whole of this control until sending existed.
   */
  submit?: SubmitTarget;
}) {
  const [picked, setPicked] = useState<Picked>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ entries: PackageEntry[]; skipped: SkippedPart[]; pages: number } | null>(
    null,
  );
  /**
   * The built package, held in memory for a send.
   *
   * NOT UPLOADED ON BUILD. Pressing Build downloads and uploads nothing — the
   * merge is local and that is the whole design. Only pressing Send puts the
   * bytes anywhere, and the action deletes them again once they are attached.
   */
  const [built, setBuilt] = useState<{ bytes: Uint8Array; fileName: string; pages: number } | null>(null);
  const [sending, startSending] = useTransition();
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const chosenCount = OFFERED.reduce((total, slot) => total + (picked[slot]?.length ?? 0), 0);

  async function build() {
    setBusy(true);
    setError(null);
    setResult(null);
    setBuilt(null);
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
      const fileName = packageFileName(projectName, packageStamp(new Date()));
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);

      // Kept so Send attaches EXACTLY what was downloaded and checked, rather
      // than rebuilding and hoping the two agree.
      setBuilt({ bytes: built.bytes, fileName, pages: built.totalPages });
      setSent(false);
      setSendError(null);
    } catch {
      setError("That package could not be built. Check the files are PDFs and try again.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Uploads the built package and submits it.
   *
   * THE FORM IS READ SYNCHRONOUSLY, before the first await — React 19's
   * `formActionCensus` rule, and the reason is that the event's own FormData
   * is gone by the time an upload resolves.
   */
  function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!built || !submit) return;
    const form = new FormData(event.currentTarget);
    setSendError(null);

    startSending(async () => {
      const file = new File([built.bytes as BlobPart], built.fileName, { type: "application/pdf" });
      const uploaded = await uploadDocumentFile("bid-package", submit.companyId, file);
      if (!uploaded.ok) {
        setSendError(uploaded.error);
        return;
      }

      form.set("fileName", built.fileName);
      form.set("pages", String(built.pages));
      const result = await submitBidPackage(submit.bidInvitationId, uploaded.fileUrl, form);
      if (result.ok) setSent(true);
      else setSendError(result.error);
    });
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

      {/* ── SENDING IT, AND ONLY ONCE THERE IS SOMETHING TO SEND ──

          The control appears after a build, because the thing being sent is
          the file the person just downloaded and checked — not a rebuild that
          might differ from it.

          This is a CONFIRM SCREEN, not an arm/confirm pair. That pattern is
          for void and delete, where the danger is a second click landing on a
          button that moved. Here the danger is sending the wrong thing to the
          wrong GC, so the answer is to show what is about to happen and ask
          somebody to read it — the same call `PayApplications` makes before a
          credit note. */}
      {built !== null && submit !== undefined && (
        <div className="mt-4 border-t border-line-card pt-4">
          <h4 className="text-sm font-semibold text-ink">Send it to {submit.gcName}</h4>

          {submit.problem !== null ? (
            <p className="mt-1 text-xs text-amber-300">{submit.problem}</p>
          ) : sent ? (
            <p className="mt-1 text-xs text-ink-body">
              Sent to {submit.gcName}. It is on the{" "}
              <a className="text-link hover:underline" href="/messages">
                message log
              </a>{" "}
              with whatever the provider says about delivery.
            </p>
          ) : (
            <form onSubmit={send} className="mt-2 flex flex-col gap-2">
              {/* ── WHAT THE ESTIMATE CHECK FOUND, ABOVE THE BUTTON ──

                  The agent's switch is literally called `checkerBeforeSend`
                  and `estimateCheck.ts` opens "before a bid goes out" — but it
                  was triggered by the status flipping to SUBMITTED, which is
                  after the estimator says they already sent it. This is the
                  moment it was written for. A read only: the agent advises and
                  writes nothing. */}
              {submit.findings.length > 0 && (
                <div className="rounded-md border border-line-row p-2 text-xs">
                  <p className="font-medium text-amber-300">
                    The estimate check flagged {submit.findings.length}{" "}
                    {submit.findings.length === 1 ? "thing" : "things"} on this bid.
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-ink-muted">
                    {submit.findings.map((finding) => (
                      <li key={finding.id}>
                        {finding.href ? (
                          <a className="text-link hover:underline" href={finding.href}>
                            {finding.title}
                          </a>
                        ) : (
                          finding.title
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-ink-muted">
                    Nothing here stops the send. It is what somebody would want to have read first.
                  </p>
                </div>
              )}

              <label className="flex flex-col text-xs text-ink-label">
                To
                {/* CHOSEN FROM THE RECORDED SET, never typed. The action
                    refuses an address that is not on this GC's contact. */}
                <select
                  name="toAddress"
                  data-submit="to"
                  className="mt-1 min-h-[36px] rounded-md border border-line-card bg-surface px-2 text-xs text-ink-body"
                >
                  {submit.addresses.map((one) => (
                    <option key={one.address} value={one.address}>
                      {one.name ? `${one.name} — ${one.address}` : one.address}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col text-xs text-ink-label">
                Subject
                <input
                  name="subject"
                  defaultValue={submissionSubject(projectName, submit.companyName)}
                  className="mt-1 min-h-[36px] rounded-md border border-line-card bg-surface px-2 text-xs text-ink-body"
                />
              </label>

              <label className="flex flex-col text-xs text-ink-label">
                Message
                <textarea
                  name="body"
                  rows={6}
                  defaultValue={submissionBody({
                    projectName,
                    companyName: submit.companyName,
                    fileName: built.fileName,
                    pages: built.pages,
                  })}
                  className="mt-1 rounded-md border border-line-card bg-surface px-2 py-1 text-xs text-ink-body"
                />
              </label>

              <p className="text-xs text-ink-muted">
                Attaching {built.fileName} — {built.pages} page{built.pages === 1 ? "" : "s"}.
              </p>

              {/* ── THE NAMED-INTENT CONFIRM ──

                  `PayApplications` asks this way before a credit note, and its
                  action refuses one that arrives without it: the screen is the
                  explanation and the server is the enforcement. A bid reaching
                  a GC cannot be recalled by anybody, so the press that sends it
                  names who it is going to. */}
              <label className="flex items-start gap-2 text-xs text-ink-body">
                <input type="checkbox" name="confirmSend" data-submit="confirm" className="mt-0.5" />
                <span>
                  Yes — send this bid to {submit.gcName}. It cannot be unsent.
                </span>
              </label>

              {sendError && <p className="text-xs text-rose-300">{sendError}</p>}

              {/* Disabled in flight, and this one matters more than most:
                  there is no idempotency key on a send, so a second click is a
                  second bid in a GC's inbox. */}
              <button
                type="submit"
                disabled={sending}
                aria-busy={sending}
                data-submit="send"
                className="inline-flex min-h-[36px] w-fit items-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-40"
              >
                {sending ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Spinner />
                    Sending…
                  </span>
                ) : (
                  "Send the bid"
                )}
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
