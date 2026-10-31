"use client";

import { useState } from "react";
import { createJob } from "@/lib/actions";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import type { JobStartReturn } from "@/lib/bid/jobStartDestination";

export interface GcOption {
  id: string;
  name: string;
  /** Shown beside the name so two GCs with similar names are tellable
   * apart, and so an accidental duplicate already in the list is visible
   * rather than inferred. */
  email: string | null;
  jobCount: number;
}

const field =
  "rounded-md border border-line-card bg-surface px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";

/**
 * Starting a job used to mint a brand-new Contact every single time, off a
 * free-text "client name" box, with no picker anywhere in the app. Three
 * jobs for one GC meant three Contact rows — which split that GC's payment
 * reliability, project history, bid pipeline and interaction log three
 * ways, and left their standing retainage terms permanently unreachable,
 * because the job pre-fills retainage from a contact that was freshly
 * minted with nulls a second earlier.
 *
 * So: pick an existing GC by default, and add a new one only when this
 * really is the first job with them. The picker is the default because the
 * duplicate is the failure mode; "Add a new GC" is one click away and says
 * exactly what it does.
 *
 * A client component so the action's refusal can be rendered. `createJob`
 * redirects on success, which never returns here — to step 2 of the
 * bid-creation stepper (`/jobs/new/[jobId]/items`), not straight to the
 * job's own page. See `BidWizardSteps` for why.
 */
export function NewJobForm({
  contacts,
  returnTo,
  submitLabel = "Start the job — add the work next →",
}: {
  contacts: GcOption[];
  /** Which product this form is in, sent to `createJob` as a WORD (never a
   * URL) so the action knows where to land (`lib/bid/jobStartDestination.ts`).
   * Absent = the CRM's own stepper, as before. */
  returnTo?: JobStartReturn;
  /** The button's words. The default names the CRM's next screen. */
  submitLabel?: string;
}) {
  const [isNewContact, setIsNewContact] = useState(contacts.length === 0);

  return (
    <ActionForm
      action={(formData) => {
        // Whichever half of the picker is not in use contributes nothing,
        // so the server never has to guess which one the person meant.
        if (isNewContact) {
          formData.delete("contactId");
        } else {
          formData.delete("contactName");
          formData.delete("contactEmail");
        }
        return createJob(formData);
      }}
      className="flex flex-col gap-4"
    >
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      <label className="flex flex-col gap-1 text-sm text-ink-label" data-tour="new-job-name">
        Job name
        <input name="jobName" required className={field} placeholder="Building C — level 3 drywall" />
      </label>

      <label className="flex flex-col gap-1 text-sm text-ink-label" data-tour="new-job-scope">
        Scope
        <textarea
          name="scope"
          className={field}
          placeholder="Metal stud framing, hang, tape and finish, levels 3-5."
        />
      </label>

      {/* Enter in the GC picker or the add-a-GC boxes picks or types — it
          never submits the whole form (UX test 2026-10-11: Enter to choose
          the GC started the job). Buttons are left alone so Enter still
          presses "+ Add a new GC". Enter in Job name still submits. */}
      <div
        className="flex flex-col gap-2 rounded-lg border border-line-card bg-surface/60 p-4"
        data-tour="new-job-client"
        onKeyDown={(event) => {
          const tag = (event.target as HTMLElement).tagName;
          if (event.key === "Enter" && (tag === "SELECT" || tag === "INPUT")) event.preventDefault();
        }}
      >
        <p className="text-sm font-medium text-ink-label">General contractor</p>

        {contacts.length === 0 ? (
          <p className="text-sm text-ink-body">
            No GCs on your account yet — this one will be the first.
          </p>
        ) : isNewContact ? (
          <button
            type="button"
            onClick={() => setIsNewContact(false)}
            className="self-start text-sm text-link hover:underline"
          >
            ← Pick one you already work with
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setIsNewContact(true)}
            className="self-start text-sm text-link hover:underline"
          >
            + Add a new GC
          </button>
        )}

        {isNewContact ? (
          <>
            <label className="flex flex-col gap-1 text-sm text-ink-label">
              GC name
              <input name="contactName" required className={field} placeholder="Turner Construction" />
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink-label">
              GC email (optional)
              <input name="contactEmail" type="email" className={field} placeholder="pm@turner.com" />
            </label>
            {contacts.length > 0 && (
              <p className="text-xs text-ink-muted">
                Only add a new one if they aren&apos;t in the list. Listing the same GC twice
                splits their payment history and their retainage terms across the two.
              </p>
            )}
          </>
        ) : (
          <label className="flex flex-col gap-1 text-sm text-ink-label">
            Which GC is this job for?
            <select name="contactId" required defaultValue="" className={field}>
              <option value="" disabled>
                Choose a GC…
              </option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                  {contact.email ? ` — ${contact.email}` : ""}
                  {contact.jobCount > 0
                    ? ` (${contact.jobCount} job${contact.jobCount === 1 ? "" : "s"})`
                    : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <SubmitButton
        type="submit"
        data-tour="new-job-create"
        // Sticky above the phone tabs (--shell-tabs, 0 on desktop): opening
        // "+ Add a new GC" pushed it below the fold (UX test 2026-10-11).
        className="sticky bottom-[calc(var(--shell-tabs,0px)+0.75rem)] z-10 mt-2 inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 shadow-md hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-60 mouse:min-h-9"
      >
        {/* "Continue →" said nothing about what pressing it does. It starts
            the job — a real row, in the jobs list, from this moment — and
            moves to the screen for putting work on it. A label that names
            the destination is the difference between a button somebody
            presses and one somebody hesitates over. */}
        {submitLabel}
      </SubmitButton>
    </ActionForm>
  );
}
