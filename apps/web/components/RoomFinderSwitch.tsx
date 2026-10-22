"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveRoomFinderSwitch } from "@/lib/actions";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * The per-company switch for "Find the rooms" on the takeoff. OFF until the
 * owner ticks it; shown to everyone so a person who cannot see the button on
 * the takeoff can find out why. Owner-only on the server (`ownerRefusal`),
 * and the refusal is rendered by `ActionForm` rather than thrown.
 *
 * AN `ActionForm`, NOT AN `onSubmit` HANDLER. The first version attached the
 * action in `onSubmit`, and a press before React had hydrated the page
 * submitted the form NATIVELY: a page POST, a navigation, every fetch on the
 * page aborted and the error boundary — found by the e2e, which pressed
 * Save 100 ms after the HTML arrived. A form whose `action` IS the server
 * action works before hydration too, which is the whole point of the pattern
 * every other settings form here uses.
 */
export function RoomFinderSwitch({ on, isOwner }: { on: boolean; isOwner: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  return (
    <div data-settings="room-finder" className="rounded-lg border border-line-card bg-surface p-4">
      <ActionForm
        action={saveRoomFinderSwitch}
        resetOnSuccess={false}
        onSuccess={() => {
          setSaved(true);
          router.refresh();
        }}
      >
        <label className="flex items-start gap-3 text-sm text-ink-body">
          <input
            type="checkbox"
            name="roomFinderOn"
            defaultChecked={on}
            disabled={!isOwner}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-line-card bg-canvas text-link focus:ring-link disabled:opacity-50"
          />
          <span>
            <span className="font-medium text-ink">Find the rooms on a takeoff</span>
            <span className="ml-2 text-xs text-ink-muted">new — off until you turn it on</span>
            <span className="mt-1 block text-xs text-ink-muted">
              After the walls are found on a sheet, a second button outlines each room they enclose, reads its name and
              number off the drawing, and lists its square feet and perimeter. Rooms save as areas you can edit like any
              other. Nothing leaves your account: it is worked out from the drawing, in code.
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
