"use client";

import { useRef, useState, useTransition } from "react";
import { sendOutboundEmail } from "@/lib/actions";
import { inputClass, labelClass, type JobOption } from "@/components/RfiFields";

/** The entry point this feature shipped without.
 *
 * `sendOutboundEmail` was written, tested, exported and re-exported through
 * the barrel, and called from nowhere — so `/messages` was a delivery log
 * with no way to create an entry, and every counter read 0 permanently.
 * The page rendered perfectly the whole time, which is exactly why clicking
 * through it proved nothing. `lib/actions/reachable.test.ts` now fails if
 * any action ends up in that state again.
 */
export function MessageComposer({
  jobs,
  canSend,
}: {
  jobs: JobOption[];
  canSend: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  if (!canSend) {
    return (
      <p className="text-sm text-slate-500">
        Sending is switched off until the three settings above are in place. Nothing here can
        send in the meantime — a compose box that always fails would be worse than none.
      </p>
    );
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
      >
        Send an email
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
          const result = await sendOutboundEmail(formData);
          if (result.ok) {
            formRef.current?.reset();
            setIsOpen(false);
          } else {
            setError(result.error);
          }
        });
      }}
      className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4"
    >
      <h2 className="text-sm font-semibold text-slate-300">Send an email</h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          To
          <input
            type="email"
            name="toAddress"
            required
            placeholder="super@gc.example"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Their name
          <input type="text" name="toName" placeholder="optional" className={inputClass} />
        </label>
      </div>

      <label className={labelClass}>
        About which job
        <select name="jobId" defaultValue="" className={inputClass}>
          <option value="">Not tied to a job</option>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {job.name}
            </option>
          ))}
        </select>
      </label>

      <label className={labelClass}>
        Subject
        <input type="text" name="subject" required className={inputClass} />
      </label>

      <label className={labelClass}>
        Message
        <textarea name="body" required rows={6} className={inputClass} />
        <span className="text-xs text-slate-500">
          Plain text. It goes out from your own domain, not ours — which is the whole reason this
          exists, and what keeps it out of a GC&apos;s spam folder.
        </span>
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        {/* Disabled in flight, and this one matters more than most: there is
            no idempotency key on a send. A second click is a second email to
            a real person, and the first thing they'd notice is that we sent
            it twice. */}
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {isPending ? "Sending…" : "Send"}
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
