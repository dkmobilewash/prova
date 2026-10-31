"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveScannedPlansSwitch } from "@/lib/actions";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";

/** The per-company switch for reading scanned sheets. Same shape as
 *  `RoomFinderSwitch`, for the same reasons (an `ActionForm`, not `onSubmit`). */
export function ScannedPlansSwitch({ on, isOwner }: { on: boolean; isOwner: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  return (
    <div data-settings="scanned-plans" className="rounded-lg border border-line-card bg-surface p-4">
      <ActionForm
        action={saveScannedPlansSwitch}
        resetOnSuccess={false}
        onSuccess={() => {
          setSaved(true);
          router.refresh();
        }}
      >
        <label className="flex items-start gap-3 text-sm text-ink-body">
          <input
            type="checkbox"
            name="scannedPlansOn"
            defaultChecked={on}
            disabled={!isOwner}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-line-card bg-canvas text-link focus:ring-link disabled:opacity-50"
          />
          <span>
            <span className="font-medium text-ink">Read scanned sheets</span>
            <span className="ml-2 text-xs text-ink-muted">new — off until you turn it on</span>
            <span className="mt-1 block text-xs text-ink-muted">
              A scanned sheet is a picture of a drawing, so Find the walls has nothing to read. With this on, the takeoff
              reads the lines and the printed scale off the picture in the background, and Find the walls works on them —
              marked as read from an image, to check more carefully. Nothing leaves your account: it is worked out in code,
              with no model.
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
