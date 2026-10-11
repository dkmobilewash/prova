"use client";

import { useState } from "react";

/** "Tell me when you add my state." Records a lead; emails the person
 * nothing. */
export function NotifyForm({ state }: { state: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [marketing, setMarketing] = useState(false);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <p role="status" className="mt-4 rounded-md bg-canvas p-4 font-semibold text-ink">
        Thanks. We will let you know at {email.trim()} when there is something for {state === "NM" ? "New Mexico" : state}.
      </p>
    );
  }
  return (
    <form
      className="mt-4 space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const response = await fetch("/api/notify", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name, email, company, state, marketingOptIn: marketing, website }),
          });
          if (response.ok) setDone(true);
          else setError(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "Something went wrong.");
        } catch {
          setError("Could not reach the server. Try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <label htmlFor="n-name" className="block font-semibold text-ink">
          Your name
        </label>
        <input id="n-name" type="text" name="name" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 min-h-touch w-full rounded-md border-2 border-line px-3 text-lg focus:border-ink" />
      </div>
      <div>
        <label htmlFor="n-email" className="block font-semibold text-ink">
          Email
        </label>
        <input id="n-email" name="email" required type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 min-h-touch w-full rounded-md border-2 border-line px-3 text-lg focus:border-ink" />
      </div>
      <div>
        <label htmlFor="n-company" className="block font-semibold text-ink">
          Company <span className="font-normal text-quiet">(optional)</span>
        </label>
        <input id="n-company" type="text" name="company" autoComplete="organization" value={company} onChange={(e) => setCompany(e.target.value)} className="mt-1 min-h-touch w-full rounded-md border-2 border-line px-3 text-lg focus:border-ink" />
      </div>
      <label className="flex min-h-touch items-start gap-3 text-ink">
        <input type="checkbox" className="mt-1 h-6 w-6 shrink-0" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
        <span>Also send me occasional emails from C-Stream about running a subcontracting business. (Optional.)</span>
      </label>
      <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="n-website">Website</label>
        <input id="n-website" type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>
      {error ? (
        <p role="alert" className="font-semibold text-danger">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy} className="min-h-primary w-full rounded-lg bg-brand px-5 text-lg font-bold text-ink hover:bg-brand-hover disabled:opacity-50">
        {busy ? "Saving..." : "Let me know"}
      </button>
    </form>
  );
}
