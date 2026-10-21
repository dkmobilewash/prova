"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveRoomFinderSwitch } from "@/lib/actions";

/**
 * The per-company switch for "Find the rooms" on the takeoff. OFF until the
 * owner ticks it; shown to everyone so a person who cannot see the button on
 * the takeoff can find out why. Owner-only on the server (`ownerRefusal`),
 * and the refusal is rendered here rather than thrown.
 */
export function RoomFinderSwitch({ on, isOwner }: { on: boolean; isOwner: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  return (
    <form
      data-settings="room-finder"
      className="rounded-lg border border-line-card bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setError(null);
        setSaved(false);
        startTransition(async () => {
          const result = await saveRoomFinderSwitch(formData);
          if (!result.ok) return setError(result.error);
          setSaved(true);
          router.refresh();
        });
      }}
    >
      <label className="flex items-start gap-3 text-sm text-ink-body">
        <input
          type="checkbox"
          name="roomFinderOn"
          defaultChecked={on}
          disabled={!isOwner || isPending}
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
        <button
          type="submit"
          disabled={!isOwner || isPending}
          className="min-h-[48px] rounded-md bg-rail-hover px-4 text-sm font-medium text-ink hover:bg-lift disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
        {!isOwner && <span className="text-xs text-ink-muted">Only the account owner can change this.</span>}
        {saved && <span className="text-xs text-ink-muted">Saved.</span>}
        {error && (
          <span role="alert" className="text-xs text-danger">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
