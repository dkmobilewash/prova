"use client";

import { useState, useTransition } from "react";
import { regenerateIntakeEmailAddress } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";

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
 * REGENERATE IS OWNER-ONLY AND TWO-STEP, through the shared
 * `<RowActions>`/`<ConfirmDelete>` — not a hand-rolled armed `useState`.
 * The armed-delete census (`rowActionsCensus.test.ts`) caught exactly that
 * the first time this component was written: `const [armed, setArmed] =
 * useState(false)` matches its `(?:onfirm|rmed)` pattern, because it is the
 * same mechanism issue #152 catalogued twenty times over — a hand-rolled
 * arm/disarm that a later sibling button can sit next to unguarded. This is
 * not literally a delete, but it drops a live credential the same way
 * `IntegrationControls`' disconnect does (that file is the reference this
 * one now follows), so it gets the same two-step treatment. The cluster is
 * left-aligned (no `shrink-0`), so `pinned` stays at its default "start":
 * Cancel keeps the first slot, which is the one this row's buttons vacate.
 * `label="New address"` is 11 characters, under the 12-char ceiling
 * `rowActionsCensus.test.ts` enforces so the armed pair still covers the
 * pixels the button it replaced.
 *
 * The server enforces owner (`ownerRefusal` inside the action refuses
 * anyone else); `isOwner` here only decides whether the control renders at
 * all, the same cosmetic-versus-boundary split every list page uses.
 *
 * `key={address}` on the `<RowActions>` is what disarms it on success:
 * the action revalidates `/intake` and the new address arrives by prop, the
 * key changes, and React remounts the cluster fresh rather than leaving it
 * stuck armed with a disabled confirm. On failure the address — and so the
 * key — does not change, so the row stays armed with the error shown and
 * only Cancel live, which is `ConfirmDelete`'s documented retry shape.
 */
export function IntakeForwardBox({ address, isOwner }: { address: string; isOwner: boolean }) {
  const [copied, setCopied] = useState(false);
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
        {/* The address itself is display text, not an action, so it stays
            outside <RowActions> — only its two BUTTONS are the row's
            actions, and only those hide while the regenerate control is
            armed. Losing sight of the address you are about to replace
            while confirming would be its own small hazard. */}
        <code className="select-all rounded border border-line-card bg-surface-muted px-2 py-1 text-sm text-ink" data-testid="intake-forward-address">
          {address}
        </code>
        <RowActions
          key={address}
          className="flex flex-wrap items-center gap-2"
          destructive={
            isOwner ? (
              <ConfirmDelete
                label="New address"
                confirmLabel="Replace it"
                pendingLabel="Replacing…"
                describe="Everyone still forwarding to the current address starts bouncing. Do this only if the address has leaked or is collecting junk."
                pending={pending}
                onConfirm={regenerate}
                armedClassName="flex flex-wrap items-center gap-2"
                hint={
                  <span className="text-xs text-ink-muted">
                    Replaces this address. Anything still being forwarded to the current one will
                    stop arriving.
                  </span>
                }
                deleteClassName="rounded border border-line-card px-3 py-1 text-sm text-ink-muted hover:bg-surface-muted disabled:opacity-50"
                cancelClassName="rounded border border-line-card px-3 py-1 text-sm text-ink hover:bg-surface"
                confirmClassName="rounded border border-red-500 px-3 py-1 text-sm text-red-400 hover:bg-tag-rose disabled:opacity-50"
              />
            ) : undefined
          }
        >
          <button
            type="button"
            onClick={copy}
            className="rounded border border-line-card px-3 py-1 text-sm text-ink hover:bg-surface-muted"
          >
            {copied ? "Copied" : "Copy address"}
          </button>
        </RowActions>
      </div>
      {note && <p className="mt-2 text-sm text-ink-body">{note}</p>}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </section>
  );
}
