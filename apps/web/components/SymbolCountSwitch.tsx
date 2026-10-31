"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveSymbolCountSwitch } from "@/lib/actions";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";

export function SymbolCountSwitch({ on, isOwner }: { on: boolean; isOwner: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  return (
    <div id="symbol-count" data-settings="symbol-count" className="scroll-mt-20 rounded-lg border border-line-card bg-surface p-4">
      <ActionForm
        action={saveSymbolCountSwitch}
        resetOnSuccess={false}
        onSuccess={() => {
          setSaved(true);
          router.refresh();
        }}
      >
        <label className="flex items-start gap-3 text-sm text-ink-body">
          <input
            type="checkbox"
            name="symbolCountOn"
            defaultChecked={on}
            disabled={!isOwner}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-line-card bg-canvas text-link focus:ring-link disabled:opacity-50"
          />
          <span>
            <span className="font-medium text-ink">Count every symbol like the one you box</span>
            <span className="ml-2 text-xs text-ink-muted">on for everyone unless you turn it off here</span>
            <span className="mt-1 block text-xs text-ink-muted">
              On the takeoff, draw a box round one fixture, outlet, light, sprinkler head or tag and the sheet is
              searched for every match by its drawn shape — turned or mirrored, the lettering beside it ignored.
              Each match is marked; click one to drop it; save the count as a Count item. No model is used.
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
