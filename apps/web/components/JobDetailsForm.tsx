"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { deleteEstimateJob, updateJobDetails } from "@/lib/actions";

type Contact = { id: string; name: string };

/**
 * The job's own details, and the only way to correct them.
 *
 * Until this existed a job's name, client and scope were fixed at creation
 * — the page could edit a line item, a forecast and the schedule, and
 * nothing else. A name typed wrong, or drafted wrong by the assistant from
 * a spoken scope, was permanent, and the remedy was somebody running SQL.
 *
 * Placed with Job status and Schedule, well above the three fixed lower
 * slots (Retainage → Field Reports → Pay Apps) that CLAUDE.md says nothing
 * marks in the file and nothing may reorder.
 */
export function JobDetailsForm({
  jobId,
  name,
  scope,
  contactId,
  contacts,
  isEstimate,
  canRemove,
  siteAddress,
  siteStatus,
}: {
  jobId: string;
  name: string;
  scope: string | null;
  contactId: string;
  contacts: Contact[];
  isEstimate: boolean;
  /** Owner only — the action refuses anyone else anyway; this keeps a
   *  control off screen that a person could never use. */
  canRemove: boolean;
  /** Prefilled from the bid's free-text location when none is saved yet. */
  siteAddress: string | null;
  /** "none" = nothing saved yet; "found" / "notFound" = whether the saved
   *  address was found on a map — weather needs coordinates. */
  siteStatus: "none" | "found" | "notFound";
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const label = "flex flex-col gap-1 text-sm text-ink-label";
  const input =
    "rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-brand focus:outline-none";

  function save(formData: FormData) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateJobDetails(jobId, formData);
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="rounded-lg border border-line-card bg-surface p-4">
      <form action={save} className="flex flex-col gap-3">
        <label className={label}>
          Job name
          <input name="name" defaultValue={name} className={input} />
        </label>

        <label className={label}>
          Client
          {/* A disabled select is left out of the submitted form, so on a
              contracted job the client never reached the action and every
              save failed with "A job needs a client." The hidden field
              carries it; the action still refuses a change once contracted. */}
          {!isEstimate && <input type="hidden" name="contactId" value={contactId} />}
          <select name={isEstimate ? "contactId" : undefined} defaultValue={contactId} disabled={!isEstimate} className={input}>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name}
              </option>
            ))}
          </select>
        </label>
        {!isEstimate && (
          // Said on the control rather than only in the refusal: a disabled
          // field with no explanation is the thing people email about.
          <p className="-mt-1 text-xs text-ink-muted">
            The client is fixed once a job is contracted — it is who signed, and who everything
            billed against this job was sent to.
          </p>
        )}

        <label className={label}>
          Site address
          <input
            name="siteAddress"
            defaultValue={siteAddress ?? ""}
            placeholder="123 Main St, Portland, OR 97201"
            className={input}
          />
        </label>
        {/* Said here, where it can be fixed: a report can only fill in the
            weather for a place that was found. */}
        <p className="-mt-1 text-xs text-ink-muted">
          {siteStatus === "found"
            ? "Daily reports fill in the weather for this address automatically."
            : siteStatus === "notFound"
              ? "Couldn't find this address on a map, so daily reports can't fill in the weather. Try a street address or \"City, ST\"."
              : "Save where the work is and daily reports fill in the weather automatically."}
        </p>

        <label className={label}>
          Scope
          <textarea name="scope" defaultValue={scope ?? ""} rows={2} className={input} />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save details"}
          </button>
          {saved && !error && <span className="text-sm text-ink-muted">Saved.</span>}
        </div>

        {error && (
          // Rendered, never thrown: production redacts a thrown Server
          // Action message to a digest and this box would stay empty.
          <p className="text-sm text-rose-300">{error}</p>
        )}
      </form>

      {canRemove && isEstimate && (
        <div className="mt-4 border-t border-line-card pt-4">
          <p className="mb-2 text-xs text-ink-muted">
            An estimate nobody has worked can be removed. Once anything is filed against it — an
            invoice, hours, an RFI — it stays.
          </p>
          {/* "Remove", not "Remove this estimate", and this is geometry
              rather than copy. CLAUDE.md's rule 2 for an armed delete —
              "Cancel inherits the Delete pixel" — was measured against
              clusters whose delete button is one short word. A 147px label
              makes the armed pair NARROWER than the button it replaces, so
              the pair no longer covers the same span: measured in the
              running app, a second click at the exact centre of where
              "Remove this estimate" had been landed on "Remove it", the
              confirm. That is the precise failure the rule exists to
              prevent, arriving through the label rather than through the
              order.

              The sentence above already says what is removed, and
              `describe` says what it costs on hover, so the long label was
              carrying nothing the screen did not already say twice. */}
          <ConfirmDeleteButton
            label="Remove"
            confirmLabel="Remove it"
            // Required since #261. #265 landed this call site without one,
            // and main went red at typecheck the moment both were in the
            // same tree — each PR was green against its own base, which is
            // CLAUDE.md's "the check is the SHA" gap arriving from the
            // other direction: CI answered about two commits that never
            // existed together.
            describe="Removes the estimate and its line items for good. It can only happen while nothing has been filed against the job — no invoice, no hours, no RFI — so there is no history to lose."
            hint={name}
            action={async () => {
              const result = await deleteEstimateJob(jobId);
              if (result.ok) router.push("/jobs");
              else setError(result.error);
            }}
          />
        </div>
      )}
    </div>
  );
}
