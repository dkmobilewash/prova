"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveAutoPostSwitch } from "@/lib/actions";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";

export function AutoPostSwitch({ on, isOwner }: { on: boolean; isOwner: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  return (
    <div data-settings="auto-post" className="rounded-lg border border-line-card bg-surface p-4">
      <ActionForm
        action={saveAutoPostSwitch}
        resetOnSuccess={false}
        onSuccess={() => {
          setSaved(true);
          router.refresh();
        }}
      >
        <label className="flex items-start gap-3 text-sm text-ink-body">
          <input
            type="checkbox"
            name="autoPostOn"
            defaultChecked={on}
            disabled={!isOwner}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-line-card bg-canvas text-link focus:ring-link disabled:opacity-50"
          />
          <span>
            <span className="font-medium text-ink">Auto-post proven items</span>
            <span className="mt-1 block text-xs text-ink-muted">
              A wall group whose type comes from a source measured right at least 97% of the time on our training
              plans and 95% on plans it was never tuned on posts straight to the estimate, labelled &ldquo;auto, from
              &lt;source&gt;&rdquo;. The review queue says how many feet posted this way, with Undo per sheet.
              Everything else still waits for you. Today no source has cleared that bar, so nothing posts yet.
            </span>
          </span>
        </label>
        {isOwner && (
          <div className="mt-3 flex items-center gap-3">
            <SubmitButton>Save</SubmitButton>
            {saved && <span className="text-xs text-ink-muted">Saved.</span>}
          </div>
        )}
      </ActionForm>
    </div>
  );
}
