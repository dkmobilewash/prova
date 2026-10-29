"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveDoorsWindowsSwitch } from "@/lib/actions";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";

export function DoorsWindowsSwitch({ on, isOwner }: { on: boolean; isOwner: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  return (
    <div id="doors-windows" data-settings="doors-windows" className="scroll-mt-20 rounded-lg border border-line-card bg-surface p-4">
      <ActionForm
        action={saveDoorsWindowsSwitch}
        resetOnSuccess={false}
        onSuccess={() => {
          setSaved(true);
          router.refresh();
        }}
      >
        <label className="flex items-start gap-3 text-sm text-ink-body">
          <input
            type="checkbox"
            name="doorsWindowsOn"
            defaultChecked={on}
            disabled={!isOwner}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-line-card bg-canvas text-link focus:ring-link disabled:opacity-50"
          />
          <span>
            <span className="font-medium text-ink">Count the doors and windows on the plan</span>
            <span className="ml-2 text-xs text-ink-muted">new — off until you turn it on</span>
            <span className="mt-1 block text-xs text-ink-muted">
              After Find the walls, reads the door swings and window symbols off the drawing: each door counted and
              measured from its own leaf, placed on its wall run, and named from the door schedule when the plan carries
              a mark beside it. Windows are offered as &ldquo;check these&rdquo; — the symbol is harder to tell from
              casework than a swing is. No model is used.
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
