"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { savePlanCompareSwitch } from "@/lib/actions";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";

export function PlanCompareSwitch({ on, isOwner }: { on: boolean; isOwner: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  return (
    <div id="plan-compare" data-settings="plan-compare" className="scroll-mt-20 rounded-lg border border-line-card bg-surface p-4">
      <ActionForm
        action={savePlanCompareSwitch}
        resetOnSuccess={false}
        onSuccess={() => {
          setSaved(true);
          router.refresh();
        }}
      >
        <label className="flex items-start gap-3 text-sm text-ink-body">
          <input
            type="checkbox"
            name="planCompareOn"
            defaultChecked={on}
            disabled={!isOwner}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-line-card bg-canvas text-link focus:ring-link disabled:opacity-50"
          />
          <span>
            <span className="font-medium text-ink">Compare renovation sheets with their demolition plan</span>
            <span className="ml-2 text-xs text-ink-muted">off until you turn it on here</span>
            <span className="mt-1 block text-xs text-ink-muted">
              Each new floor plan is paired with its level&apos;s demolition plan by sheet number and title (AD1.0 with
              A3.1, D100 with A100), and checked to line up. A wall the demolition plan also draws, and does not
              remove, is set aside as existing to remain. The pairing shows on the sheet, where it can be changed or
              removed. No model is used.
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
