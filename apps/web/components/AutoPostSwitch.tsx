"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveAutoPostSwitch } from "@/lib/actions";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";

export function AutoPostSwitch({ on, walls, isOwner }: { on: boolean; walls: boolean; isOwner: boolean }) {
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
        {([
          ["autoPostOn", on, "Auto-post marked doors", "A door with a printed mark beside it posts to the estimate as a count, with Undo per sheet."],
          ["autoPostWalls", walls, "Auto-post walls", "Walls our wall model is sure of post to the estimate without review, with Undo per sheet — off until you turn it on, while the evidence is small (417 ft on plans we never tuned on, none wrong)."],
        ] as const).map(([name, checked, title, line]) => (
          <label key={name} className="mt-3 flex items-start gap-3 text-sm text-ink-body first:mt-0">
            <input
              type="checkbox"
              name={name}
              defaultChecked={checked}
              disabled={!isOwner}
              className="mt-0.5 h-5 w-5 shrink-0 rounded border-line-card bg-canvas text-link focus:ring-link disabled:opacity-50"
            />
            <span>
              <span className="font-medium text-ink">{title}</span>
              <span className="mt-1 block text-xs text-ink-muted">{line}</span>
            </span>
          </label>
        ))}
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
