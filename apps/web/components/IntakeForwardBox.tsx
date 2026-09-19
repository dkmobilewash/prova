"use client";

import { useState, useTransition } from "react";
import { regenerateIntakeEmailAddress } from "@/lib/actions";

/**
 * "Forward documents to…" — the company's own inbound address, on the tray
 * it fills.
 *
 * The address is COMPUTED SERVER-SIDE and passed down; this component never
 * sees the token apart from inside the string it shows. When the install
 * has no inbound domain configured the page renders nothing at all rather
 * than an address that bounces — an instruction that does not work is worse
 * than no instruction.
 *
 * The copy button is the whole interaction for most people: the address is
 * 40-odd characters of token and nobody should type it. `execCommand` is
 * not fallen back to — on the clipboard API failing (http, ancient
 * browser), the address is still selectable text right there.
 *
 * REGENERATE IS OWNER-ONLY AND TWO-STEP. The server enforces owner (the
 * action refuses anyone else); `isOwner` here only decides whether to show
 * the button, the same cosmetic-versus-boundary split every list page uses.
 * The confirm is an inline armed state, never `window.confirm`, and the
 * armed copy says the real cost: everyone forwarding to the old address
 * starts bouncing.
 */
export function IntakeForwardBox({ address, isOwner }: { address: string; isOwner: boolean }) {
  const [copied, setCopied] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function copy() {
    setError(null);
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy — select the address and copy it yourself.");
    }
  }

  function regenerate() {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const result = await regenerateIntakeEmailAddress();
      setArmed(false);
      if (result.ok) {
        // The page revalidates and the new address arrives by prop; the
        // note says what just happened so the change is not silent.
        setNote("New address issued. The old one no longer works — share this one.");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <section
      className="mb-8 rounded-lg border border-line-card bg-surface p-4"
      data-tour="intake-forward"
    >
      <h2 className="mb-1 text-sm font-semibold text-ink-label">Or forward it by email</h2>
      <p className="mb-3 max-w-3xl text-xs text-ink-muted">
        Paperwork that arrives in your inbox can come straight here: forward the email to this
        address and its attachments land in the tray below, marked with who sent it. Only people
        with this address can use it — it is yours, not public.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="select-all rounded border border-line-card bg-surface-muted px-2 py-1 text-sm text-ink" data-testid="intake-forward-address">
          {address}
        </code>
        <button
          type="button"
          onClick={copy}
          className="rounded border border-line-card px-3 py-1 text-sm text-ink hover:bg-surface-muted"
        >
          {copied ? "Copied" : "Copy address"}
        </button>
        {isOwner && !armed && (
          <button
            type="button"
            onClick={() => setArmed(true)}
            className="rounded border border-line-card px-3 py-1 text-sm text-ink-muted hover:bg-surface-muted"
          >
            Get a new address
          </button>
        )}
      </div>
      {isOwner && armed && (
        <div className="mt-3 rounded border border-line-card bg-surface-muted p-3">
          <p className="mb-2 text-sm text-ink-body">
            Replace this address? Anything still being forwarded to the current one will stop
            arriving, and everyone using it needs the new address. Do this if the address has
            leaked or is collecting junk.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setArmed(false)}
              disabled={pending}
              className="rounded border border-line-card px-3 py-1 text-sm text-ink hover:bg-surface"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={regenerate}
              // Disabled while in flight — the action is not idempotent
              // (each click would mint another token) and this app has a
              // standing scar from live buttons through slow round trips
              // (#19).
              disabled={pending}
              className="rounded border border-red-500 px-3 py-1 text-sm text-red-400 hover:bg-tag-rose disabled:opacity-50"
            >
              {pending ? "Replacing…" : "Yes, replace the address"}
            </button>
          </div>
        </div>
      )}
      {note && <p className="mt-2 text-sm text-ink-body">{note}</p>}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </section>
  );
}
