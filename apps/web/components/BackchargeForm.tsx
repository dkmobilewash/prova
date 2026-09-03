"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createBackcharge } from "@/lib/actions";
import { BackchargeFields } from "@/components/BackchargeFields";
import type { JobOption } from "@/components/RfiFields";
import { localToday } from "@/components/localToday";

export function BackchargeForm({
  jobs,
  defaultJobId,
}: {
  jobs: JobOption[];
  defaultJobId?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  if (jobs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/50 p-5">
        <p className="text-sm font-medium text-slate-200">No jobs yet</p>
        <p className="mt-1 text-sm text-slate-400">
          A backcharge is a deduction from a specific job&apos;s money, so it has to belong to one.
          Create a job and the form will appear here.
        </p>
        <Link
          href="/dashboard"
          className="mt-3 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          Go to Jobs
        </Link>
      </div>
    );
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
      >
        Log a backcharge
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          try {
            const result = await createBackcharge(formData);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            // On top of the action's own revalidatePath. Browser testing found
      // two union-compliance forms leaving the page stale until a manual
      // reload while others updated live; every action revalidates and
      // every form calls them the same way, so this is NOT a root-cause
      // fix. It is applied here because these components share that exact
      // pattern, and the same bug would sit unseen until someone hit it.
      // A save that looks like it did nothing gets clicked again, and no
      // create action here is idempotent.
            router.refresh();
            formRef.current?.reset();
            setIsOpen(false);
          } catch {
            setError("Could not log the backcharge");
          }
        });
      }}
      className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4"
    >
      <h2 className="text-sm font-semibold text-slate-300">Log a backcharge</h2>

      <BackchargeFields
        jobs={jobs}
        defaultJobId={defaultJobId}
        defaults={{
          gcReference: null,
          // NOT "CLEANUP". Everything else on this form is blank by
          // default because a value nobody chose is a value nobody can
          // trust, and the category was the one field quietly breaking
          // that: a backcharge logged in a hurry became a cleanup
          // backcharge, with nothing on the row to say the tag was a
          // default rather than a decision. OTHER is what the schema
          // itself defaults to and is the honest starting point.
          category: "OTHER",
          description: "",
          claimedAmount: "",
          // The date the GC's notice is dated is usually not today, but
          // today is the closest useful starting point and the field is
          // required — an empty required date reads as a broken form.
          issuedOn: localToday(),
          receivedOn: localToday(),
          respondByDate: null,
        }}
      />

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save backcharge"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setIsOpen(false);
            setError(null);
          }}
          className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
