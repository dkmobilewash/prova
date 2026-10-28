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
            {/* ── NAMED FOR THE PERSON LOOKING FOR IT ──
                This read "Keep doubtful runs on the sheet", which describes
                what the switch DOES and uses none of the words anybody says
                about it. Asked to find the demote switch on production,
                a tester searched Company, Estimating defaults and Assistant
                and reported it missing — while it was rendering, unconditional,
                one block under "Find the rooms". Nothing was broken and an
                hour went into proving it.

                So the heading carries the phrase the drawing itself shows
                ("probably aren't walls"), and the small print leads with what
                a person is actually deciding: the lines stay visible, and one
                click puts one back. */}
            <span className="font-medium text-ink">Grey out lines that probably aren&rsquo;t walls</span>
            <span className="ml-2 text-xs text-ink-muted">new — off until you turn it on</span>
            <span className="mt-1 block text-xs text-ink-muted">
              They stay visible on the drawing, greyed and marked &ldquo;probably not a wall&rdquo; with the
              reason, left out of the total — and one click puts a line back. A line is greyed when the wall
              model doubts it as the walls are found, or when &ldquo;Check these are walls&rdquo; decides it is
              a countertop, a fixture or a reference line. Off, the model is not consulted and the check takes
              such lines off the sheet instead; only Find the walls brings them back.
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
