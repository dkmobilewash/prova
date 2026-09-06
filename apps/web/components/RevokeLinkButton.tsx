"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { revokePortalAccess, revokeSignatureRequest } from "@/lib/actions";

/**
 * Takes back a link that is its own password.
 *
 * The two bearer URLs in this app — `/portal/<token>` and `/esign/<token>`
 * — had exactly one writer each and no way at all to withdraw one. This is
 * the button that was missing. Both flavours live in one component because
 * the decision, the warning and the two-step confirm are identical; only
 * the action and the sentence differ.
 *
 * TWO STEPS, no `window.confirm` — the app's rule for anything destructive.
 * This one earns it twice over: revoking is instant, irreversible for that
 * URL, and its effect is invisible from here. The person who feels it is a
 * GC clicking a bookmark that stops working, and nothing on this screen
 * will ever tell you they did.
 *
 * The confirm step spells out that re-enabling issues a DIFFERENT link,
 * because the intuition to correct is that this is a toggle. It is not: the
 * old URL is dead for good, which is the entire point of pressing it.
 */
export function RevokeLinkButton(
  props:
    | { kind: "portal"; contactId: string; clientName: string }
    | { kind: "signing"; signatureRequestId: string },
) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const label = props.kind === "portal" ? "Revoke portal link" : "Revoke signing link";
  const warning =
    props.kind === "portal"
      ? `${props.clientName}'s existing link stops working immediately — including any copy of it that has been forwarded on. Enabling the portal again issues a different link; the old one never works again.`
      : "The existing signing link stops working immediately, including any copy that has been forwarded on. Create a new signing link afterwards if the GC still needs to sign — it will be a different URL.";

  function handleRevoke() {
    setError(null);
    startTransition(async () => {
      const result =
        props.kind === "portal"
          ? await revokePortalAccess(props.contactId)
          : await revokeSignatureRequest(props.signatureRequestId);
      if (result.ok) {
        setIsConfirming(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  if (!isConfirming) {
    return (
      <button
        type="button"
        onClick={() => setIsConfirming(true)}
        className="text-xs font-medium text-red-400 hover:underline"
      >
        {label}
      </button>
    );
  }

  return (
    <div className="rounded-md border border-red-900 bg-red-950/40 p-3">
      <p className="text-xs text-red-200">{warning}</p>
      {error && (
        <p role="alert" className="mt-2 text-xs text-amber-300">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleRevoke}
          disabled={isPending}
          aria-busy={isPending || undefined}
          className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Revoking…" : "Yes, revoke it"}
        </button>
        <button
          type="button"
          onClick={() => {
            setIsConfirming(false);
            setError(null);
          }}
          disabled={isPending}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-60"
        >
          Keep it
        </button>
      </div>
    </div>
  );
}
