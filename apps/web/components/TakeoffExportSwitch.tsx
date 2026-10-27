"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveTakeoffExportSwitch } from "@/lib/actions";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";

/** The per-company switch for the takeoff summary export. Same shape as
 *  `RoomFinderSwitch`, for the same reasons (an `ActionForm`, not `onSubmit`). */
export function TakeoffExportSwitch({ on, isOwner }: { on: boolean; isOwner: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  return (
    <div data-settings="takeoff-export" className="rounded-lg border border-line-card bg-surface p-4">
      <ActionForm
        action={saveTakeoffExportSwitch}
        resetOnSuccess={false}
        onSuccess={() => {
          setSaved(true);
          router.refresh();
        }}
      >
        <label className="flex items-start gap-3 text-sm text-ink-body">
          <input
            type="checkbox"
            name="takeoffExportOn"
            defaultChecked={on}
            disabled={!isOwner}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-line-card bg-canvas text-link focus:ring-link disabled:opacity-50"
          />
          <span>
            <span className="font-medium text-ink">Export a takeoff summary</span>
            <span className="ml-2 text-xs text-ink-muted">new — off until you turn it on</span>
            <span className="mt-1 block text-xs text-ink-muted">
              Two buttons on the takeoff: a CSV and a PDF of what was measured — walls by type with feet, height, board,
              studs and track; rooms with square feet and perimeter; other areas by item; doors from the schedule — each
              line naming the sheet it came from, and one marked-up sheet image per measured sheet. Quantities only, no
              prices. Nothing leaves your account: the files are built from your own takeoff, in code.
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
