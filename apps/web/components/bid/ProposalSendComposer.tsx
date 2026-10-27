"use client";

import { useState, useTransition } from "react";
import { Spinner } from "@/components/Spinner";
import { sendBidProposal } from "@/lib/actions";

/** One earlier send of this proposal, already worded for the reader. */
export type ProposalSendHistoryItem = {
  id: string;
  /** "Oct 27, 2026", formatted on the server in the viewer's zone. */
  when: string;
  toAddress: string;
  reached: boolean;
  detail: string | null;
};

/**
 * "SEND THE PROPOSAL TO <GC>" — C Stream Bid's composer, one per GC invitation.
 *
 * PREFILLED FROM ROWS, NOTHING SENT ON ITS OWN. The address is chosen from the
 * ones on the GC's contact (the action refuses any other — a typed address
 * would make "who did we send the bid to" a question about somebody's typing,
 * `bid-submission.ts`), the subject and the short note are editable, and the
 * proposal under the note is built by the SERVER at the moment it sends
 * (`sendBidProposal`), never taken from this form. What it shows below is that
 * same text, read-only.
 *
 * TWO STEPS. "Send to <GC>" only arms; the second press names the address and
 * the price. Cancel takes the pixel the first button vacated — the left end of
 * a left-aligned row, and the TOP of the stacked pair below `sm` — so a hurried
 * double press lands on Cancel, never on the send (CLAUDE.md, "Cancel inherits
 * the delete pixel"). The action refuses a send without the second press.
 *
 * DISABLED WITH A SENTENCE when it cannot go: a preview or any non-production
 * copy, sending not set up, the bid closed, no price, no address on file.
 * The sentence comes from `proposalSendBlocker`, the same function the action
 * re-checks with.
 *
 * Read the form SYNCHRONOUSLY, before the transition — the event's FormData is
 * gone by the time anything awaits (`formActionCensus`).
 */
export function ProposalSendComposer({
  jobId,
  invitationId,
  mode,
  priceCents,
  totalLabel,
  gcName,
  recipients,
  subject,
  coverNote,
  documentText,
  blocker,
  history,
}: {
  jobId: string;
  invitationId: string;
  mode: string;
  /** The price this page shows for the GC, in cents — the action refuses if it moved. */
  priceCents: number;
  totalLabel: string;
  gcName: string;
  recipients: { address: string; name: string | null }[];
  subject: string;
  coverNote: string;
  documentText: string;
  blocker: string | null;
  history: ProposalSendHistoryItem[];
}) {
  const [armed, setArmed] = useState(false);
  const [to, setTo] = useState(recipients[0]?.address ?? "");
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sending, startSending] = useTransition();

  const chosen = recipients.find((one) => one.address === to) ?? recipients[0] ?? null;
  const chosenWords = chosen ? (chosen.name ? `${chosen.name} at ${chosen.address}` : chosen.address) : "";
  const sentBefore = history.some((one) => one.reached);

  function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!armed || sending) return;
    const form = new FormData(event.currentTarget);
    setError(null);
    startSending(async () => {
      const result = await sendBidProposal(jobId, invitationId, form);
      if (result.ok) {
        setSentTo(chosenWords);
        setArmed(false);
      } else {
        setError(result.error);
      }
    });
  }

  const field = "mt-1 min-h-11 w-full rounded-md border border-line-card bg-surface px-3 text-sm text-ink";

  return (
    <section
      className="mt-8 rounded-lg border border-line-card bg-surface p-4 print:hidden"
      data-proposal="send-composer"
      aria-labelledby={`send-${invitationId}`}
    >
      <h2 id={`send-${invitationId}`} className="text-base font-semibold text-ink">
        Send the proposal to {gcName}
      </h2>
      <p className="mt-1 text-sm text-ink-body">
        Sent as an email from your company&apos;s sending address: your note, then this proposal as text in the email
        itself, at {totalLabel}. No PDF is attached — to send one, print this page to PDF and use the bid package below.
      </p>

      {history.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 text-sm" data-proposal="send-history">
          {history.map((one) => (
            <li key={one.id} className={one.reached ? "text-ink-body" : "text-tag-rose-ink"}>
              {one.reached ? "Sent" : "Didn't send"} {one.when} to {one.toAddress}
              {!one.reached && one.detail ? <> — {one.detail}</> : null}
            </li>
          ))}
        </ul>
      )}

      {sentTo ? (
        <p className="mt-3 rounded-md bg-tag-green px-3 py-2 text-sm text-tag-green-ink" role="status" data-proposal="send-done">
          Sent to {sentTo}. The bid is marked submitted, and the copy that went out is kept against this bid.
        </p>
      ) : blocker ? (
        <p className="mt-3 rounded-md bg-tag-amber px-3 py-2 text-sm text-tag-amber-ink" data-proposal="send-blocked">
          {blocker}
        </p>
      ) : (
        <form onSubmit={send} className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="mode" value={mode} />
          <input type="hidden" name="priceCents" value={String(priceCents)} />
          {armed && <input type="hidden" name="confirmSend" value="yes" />}

          <label className="flex flex-col text-sm text-ink-label">
            To
            <select name="toAddress" value={to} onChange={(event) => setTo(event.target.value)} className={field} data-proposal="send-to">
              {recipients.map((one) => (
                <option key={one.address} value={one.address}>
                  {one.name ? `${one.name} — ${one.address}` : one.address}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col text-sm text-ink-label">
            Subject
            <input name="subject" defaultValue={subject} required className={field} />
          </label>

          <label className="flex flex-col text-sm text-ink-label">
            Your note
            <textarea
              name="body"
              rows={6}
              defaultValue={coverNote}
              required
              className="mt-1 w-full rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>

          <details className="text-sm text-ink-body">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-link">
              What goes under your note
            </summary>
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line-row p-3 font-sans text-sm text-ink-body" data-proposal="send-document">
              {documentText}
            </pre>
          </details>

          {sentBefore && (
            <p className="text-sm text-ink-muted">This bid has been sent before. Sending again puts a second copy in their inbox.</p>
          )}

          {error && (
            <p className="text-sm text-tag-rose-ink" role="alert">
              {error}
            </p>
          )}

          {armed ? (
            <div className="flex flex-col gap-2" data-proposal="send-confirm">
              <p className="text-sm font-medium text-ink">
                This emails the proposal to {chosenWords} now, at {totalLabel}. It cannot be unsent.
              </p>
              {/* Cancel FIRST: in this left-aligned row the first slot is the
                  one the arming button stood in, and below `sm` the column puts
                  it on top, where that button was. */}
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setArmed(false)}
                  disabled={sending}
                  className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-4 text-sm font-medium text-ink"
                  data-proposal="send-cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sending}
                  aria-busy={sending}
                  className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-40"
                  data-proposal="send-yes"
                >
                  {sending ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Spinner />
                      Sending…
                    </span>
                  ) : (
                    "Yes, send it"
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setArmed(true);
                }}
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
                data-proposal="send-arm"
              >
                Send to {gcName}
              </button>
            </div>
          )}
        </form>
      )}
    </section>
  );
}
