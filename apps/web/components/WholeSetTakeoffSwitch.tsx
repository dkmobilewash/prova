"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveWholeSetTakeoffSwitch } from "@/lib/actions";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";

/** The owner's switch for "Find walls on every floor plan" — the room finder's
 *  switch with the words changed, and OFF until somebody turns it on. */
export function WholeSetTakeoffSwitch({ on, isOwner }: { on: boolean; isOwner: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  return (
    <div data-settings="whole-set-takeoff" className="rounded-lg border border-line-card bg-surface p-4">
      <ActionForm
        action={saveWholeSetTakeoffSwitch}
        resetOnSuccess={false}
        onSuccess={() => {
          setSaved(true);
          router.refresh();
        }}
      >
        <label className="flex items-start gap-3 text-sm text-ink-body">
          <input
            type="checkbox"
            name="wholeSetTakeoffOn"
            defaultChecked={on}
            disabled={!isOwner}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-line-card bg-canvas text-link focus:ring-link disabled:opacity-50"
          />
          <span>
            <span className="font-medium text-ink">Find walls on every floor plan at once</span>
            <span className="ml-2 text-xs text-ink-muted">new — off until you turn it on</span>
            <span className="mt-1 block text-xs text-ink-muted">
              Once the scales are set, one button on the takeoff finds the walls on every floor-plan sheet in the set
              while you watch the count climb, and lists what it found on each sheet and which sheets it passed over
              and why. Same finder as the one-sheet button; nothing leaves your account and nothing is spent.
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
