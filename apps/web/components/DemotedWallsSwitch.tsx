"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveDemotedWallsSwitch } from "@/lib/actions";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";

export function DemotedWallsSwitch({ on, isOwner }: { on: boolean; isOwner: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  return (
    <div data-settings="demoted-walls" className="rounded-lg border border-line-card bg-surface p-4">
      <ActionForm
        action={saveDemotedWallsSwitch}
        resetOnSuccess={false}
        onSuccess={() => {
          setSaved(true);
          router.refresh();
        }}
      >
        <label className="flex items-start gap-3 text-sm text-ink-body">
          <input
            type="checkbox"
            name="demotedWallsOn"
            defaultChecked={on}
            disabled={!isOwner}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-line-card bg-canvas text-link focus:ring-link disabled:opacity-50"
          />
          <span>
            <span className="font-medium text-ink">Keep doubtful runs on the sheet</span>
            <span className="ml-2 text-xs text-ink-muted">new — off until you turn it on</span>
            <span className="mt-1 block text-xs text-ink-muted">
              When &ldquo;Check these are walls&rdquo; decides a run is a countertop, a fixture or a reference line, it
              stays on the drawing greyed out and marked &ldquo;probably not a wall&rdquo;, left out of the total, with
              one click to put it back. Off, those runs are taken off the sheet and only Find the walls brings them
              back.
            </span>
          </span>
        </label>
        <div className="mt-3 flex items-center gap-3">
          <SubmitButton disabled={!isOwner}>Save</SubmitButton>
          {!isOwner && <span className="text-xs text-ink-muted">Only the account owner can change this.</span>}
          {saved && <span className="text-xs text-ink-muted">Saved.</span>}
        </div>
      </ActionForm>
    </div>
  );
}
