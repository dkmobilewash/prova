"use client";

import { useState, useTransition } from "react";
import { createJob } from "@/lib/actions";

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
  "rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";

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
 * redirects on success, which never returns here.
 */
export function NewJobForm({ contacts }: { contacts: GcOption[] }) {
  const [isNewContact, setIsNewContact] = useState(contacts.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        // Whichever half of the picker is not in use contributes nothing,
        // so the server never has to guess which one the person meant.
        if (isNewContact) {
          formData.delete("contactId");
        } else {
          formData.delete("contactName");
          formData.delete("contactEmail");
        }
        setError(null);
        startTransition(async () => {
          const result = await createJob(formData);
          if (!result.ok) setError(result.error);
        });
      }}
      onInput={() => setError(null)}
      className="flex flex-col gap-4"
    >
      <label className="flex flex-col gap-1 text-sm text-slate-300">
        Job name
        <input name="jobName" required className={field} placeholder="Building C — level 3 drywall" />
      </label>

      <label className="flex flex-col gap-1 text-sm text-slate-300">
        Scope
        <textarea
          name="scope"
          className={field}
          placeholder="Metal stud framing, hang, tape and finish, levels 3-5."
        />
      </label>

      <div className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <p className="text-sm font-medium text-slate-200">General contractor</p>

        {contacts.length === 0 ? (
          <p className="text-sm text-slate-400">
            No GCs on your account yet — this one will be the first.
          </p>
        ) : isNewContact ? (
          <button
            type="button"
            onClick={() => {
              setIsNewContact(false);
              setError(null);
            }}
            className="self-start text-sm text-blue-400 hover:underline"
          >
            ← Pick one you already work with
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setIsNewContact(true);
              setError(null);
            }}
            className="self-start text-sm text-blue-400 hover:underline"
          >
            + Add a new GC
          </button>
        )}

        {isNewContact ? (
          <>
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              GC name
              <input name="contactName" required className={field} placeholder="Turner Construction" />
            </label>
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              GC email (optional)
              <input name="contactEmail" type="email" className={field} placeholder="pm@turner.com" />
            </label>
            {contacts.length > 0 && (
              <p className="text-xs text-slate-500">
                Only add a new one if they aren&apos;t in the list. A second row for the same GC
                splits their payment history and their standing terms across two records.
              </p>
            )}
          </>
        ) : (
          <label className="flex flex-col gap-1 text-sm text-slate-300">
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

      <button
        type="submit"
        disabled={isPending}
        className="mt-2 inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "Creating…" : "Create job"}
      </button>

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}
