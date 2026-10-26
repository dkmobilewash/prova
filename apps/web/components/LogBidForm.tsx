"use client";

import { useState } from "react";
import Link from "next/link";
import { createBidInvitation } from "@/lib/actions";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { BidDetailsFields } from "@/components/BidDetailsFields";

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
 */
/** The picked GC is the action's bound first argument on the contact page;
 * here it rides in the form. */
export const logBid = (formData: FormData) => createBidInvitation(String(formData.get("contactId") ?? ""), formData);

export function LogBidForm({
  gcs,
  startOpen = false,
  projectChoices = [],
}: {
  gcs: { id: string; name: string }[];
  startOpen?: boolean;
  /** Projects already on file, so a second GC's invitation for the same job
   * can go on the same project instead of a new one. */
  projectChoices?: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(startOpen);

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
        <ActionForm
          action={logBid}
          onSuccess={() => setOpen(false)}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="flex flex-col gap-1 text-sm text-ink-label">
            GC
            <select name="contactId" required defaultValue="" className={field}>
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
          <BidDetailsFields />
          {projectChoices.length > 0 && (
            <label className="flex flex-col gap-1 text-sm text-ink-label">
              Same job as…
              <select name="bidProjectId" defaultValue="" className={`max-w-xs ${field}`}>
                <option value="">A new job</option>
                {projectChoices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex min-h-11 items-center gap-2 text-sm text-ink-label">
            <input type="checkbox" name="weReachedOut" className="h-5 w-5" />
            We reached out (they didn&rsquo;t invite us)
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
              onClick={() => setOpen(false)}
              className="inline-flex min-h-11 items-center rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-rail-hover mouse:min-h-9"
            >
              Cancel
            </button>
          </div>
        </ActionForm>
      )}
    </section>
  );
}
