"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { createBidInvitation, readBidInvitationText } from "@/lib/actions";
import type { BidInviteReadResult } from "@/lib/actions/bidInviteRead";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { TRADE_SCOPE_OPTIONS } from "@/lib/trade-scopes";

const field =
  "rounded-md border border-line-card bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus:border-link focus:outline-none sm:text-sm";

/**
 * "+ Log a bid" on /bids. A bid invitation could only be logged from a GC's
 * own contact page, which nobody looking for "log a bid" thinks to open
 * (contractor click test, 2026-10-11). Same fields as that page's form and
 * the SAME action — createBidInvitation(contactId, formData) — with the GC
 * picked here instead of implied by the page. The action itself checks the
 * contact belongs to this company.
 *
 * Collapsed behind its button like every add-form; `?new=1` (the area card
 * and ⌘K) opens it already.
 *
 * PASTE THE INVITATION, WHICH SAVES NOTHING. The text goes to
 * `readBidInvitationText`, which returns a proposal; the form remounts filled
 * with it (the `formKey` below) and the person checks it and presses "Log
 * invitation" as before. The note and the checks are held HERE, above the
 * remount, for the reason `QuoteReader`'s `note` prop records: state inside
 * the keyed form is thrown away by the very remount that fills it.
 */
/** The picked GC is the action's bound first argument on the contact page;
 * here it rides in the form. */
export const logBid = (formData: FormData) => createBidInvitation(String(formData.get("contactId") ?? ""), formData);

export function LogBidForm({ gcs, startOpen = false }: { gcs: { id: string; name: string }[]; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [pasted, setPasted] = useState("");
  const [suggestion, setSuggestion] = useState<BidInviteReadResult | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [readError, setReadError] = useState<string | null>(null);
  const [isReading, startReading] = useTransition();
  function read() {
    setReadError(null);
    startReading(async () => {
      const result = await readBidInvitationText(pasted);
      if (!result.ok) {
        setReadError(result.error);
        return;
      }
      setSuggestion(result.value);
      setFormKey((key) => key + 1);
    });
  }

  function close() {
    setOpen(false);
    setSuggestion(null);
    setPasted("");
    setReadError(null);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-6 inline-flex min-h-11 items-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-brand-hover mouse:min-h-9"
      >
        + Log a bid
      </button>
    );
  }

  return (
    <section className="mb-6 rounded-lg border border-line-card bg-surface p-4" data-bids="log-bid">
      <h2 className="mb-3 text-sm font-semibold text-ink-label">Log a bid invitation</h2>
      {gcs.length === 0 ? (
        <p className="text-sm text-ink-body">
          Bids are logged against the GC who invited you, and there are no contacts yet.{" "}
          <Link href="/contacts" className="text-link hover:underline">
            Add the GC
          </Link>{" "}
          first, then come back.
        </p>
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-2" data-bids="paste-invite">
            <label className="flex flex-col gap-1 text-sm text-ink-label">
              Paste the invitation
              <textarea
                name="invitationText"
                value={pasted}
                onChange={(event) => setPasted(event.currentTarget.value)}
                rows={4}
                placeholder="Paste the GC's email, or a BuildingConnected or Dodge listing…"
                className={field}
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={read}
                disabled={isReading || pasted.trim().length === 0}
                className="inline-flex min-h-11 items-center rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-rail-hover disabled:cursor-not-allowed disabled:opacity-60 mouse:min-h-9"
              >
                {isReading ? "Reading it…" : "Fill the form from it"}
              </button>
              <span className="text-xs text-ink-muted">
                C Stream fills the fields in and you check them. Nothing is saved until you press Log invitation.
              </span>
            </div>
            {readError && !isReading && (
              <p className="text-sm text-tag-amber-ink" data-bids="paste-error">
                {readError}
              </p>
            )}
            {suggestion && !isReading && !readError && (
              <div className="rounded-md border border-line-card bg-canvas p-3 text-sm text-ink-body" data-bids="paste-read">
                <p>{suggestion.note}</p>
                {suggestion.checks.length > 0 && (
                  <>
                    <p className="mt-2 font-medium text-ink-label">Check these before you save:</p>
                    <ul className="mt-1 list-disc pl-5">
                      {suggestion.checks.map((check) => (
                        <li key={check}>{check}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>

            <ActionForm key={formKey} action={logBid} onSuccess={close} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm text-ink-label">
                GC
                <select name="contactId" required defaultValue={suggestion?.contactId ?? ""} className={field}>
                  <option value="" disabled>
                    Pick the GC…
                  </option>
                  {gcs.map((gc) => (
                    <option key={gc.id} value={gc.id}>
                      {gc.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-ink-label">
                Project name
                <input
                  name="projectName"
                  required
                  autoComplete="off"
                  defaultValue={suggestion?.projectName ?? ""}
                  placeholder="Downtown office build-out…"
                  className={field}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-ink-label">
                Trade
                <select name="tradeScope" defaultValue={suggestion?.tradeScope ?? ""} className={field}>
                  <option value="">No trade tag</option>
                  {TRADE_SCOPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-ink-label">
                Bid due date
                <input name="dueDate" type="date" defaultValue={suggestion?.dueDate ?? ""} className={field} />
              </label>
              <label className="flex flex-col gap-1 text-sm text-ink-label">
                Bid $ (if known)
                <input name="bidAmount" type="text" inputMode="decimal" autoComplete="off" placeholder="Optional" className={`w-28 ${field}`} />
              </label>
              <label className="flex min-w-[180px] flex-1 basis-full flex-col gap-1 text-sm text-ink-label">
                Notes
                <textarea
                  name="notes"
                  rows={suggestion?.notes ? Math.min(6, suggestion.notes.split("\n").length + 1) : 2}
                  defaultValue={suggestion?.notes ?? ""}
                  placeholder="Optional"
                  className={field}
                />
              </label>
              <div className="flex gap-2">
                <SubmitButton
                  type="submit"
                  className="inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-brand-hover"
                >
                  Log invitation
                </SubmitButton>
                <button
                  type="button"
                  onClick={close}
                  className="inline-flex min-h-11 items-center rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-rail-hover mouse:min-h-9"
                >
                  Cancel
                </button>
              </div>
            </ActionForm>
        </>
      )}
    </section>
  );
}
