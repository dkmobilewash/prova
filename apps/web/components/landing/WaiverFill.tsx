"use client";

import type { CSSProperties } from "react";
import { motionPlayState, useMotionCue } from "./useMotionCue";
import "./waiverFill.css";

/**
 * A California conditional progress waiver filling itself in, then marked
 * ready to sign — the hero of the public /lien-waiver page.
 *
 * Same motion contract as SubmittalStamp.tsx: at rest the document is
 * FINISHED (every value present, mark landed); `useMotionCue` only replays
 * the arrival when the figure is on screen and motion is allowed. The stage
 * is fixed-height and clipped and only transform/opacity animate, so
 * nothing changes height. The stage is aria-hidden; the line under it says
 * what it is in words.
 */
const FIELDS = [
  { label: "Claimant", value: "Ridgeline Drywall Inc." },
  { label: "Customer", value: "Apex Builders" },
  { label: "Job location", value: "1200 Harbor Blvd" },
  { label: "Amount", value: "$48,250.00" },
] as const;

export function WaiverFill({ className = "" }: { className?: string }) {
  const { ref, playing } = useMotionCue<HTMLElement>();

  return (
    <figure
      ref={ref}
      data-landing-waiver="figure"
      data-motion-play={motionPlayState(playing)}
      className={`landing-waiver w-full min-w-0 max-w-[34rem] overflow-hidden rounded-xl border border-line-card bg-surface text-left ${className}`}
    >
      <div className="flex items-center gap-2 border-b border-line-row px-4 py-2">
        <span className="rounded bg-brand px-1.5 py-0.5 font-mono text-xs font-bold text-neutral-900">CA</span>
        <span className="text-sm text-ink">Conditional waiver · progress payment</span>
      </div>

      <div
        aria-hidden="true"
        data-landing-waiver="stage"
        className="relative h-[300px] overflow-hidden bg-canvas px-6 py-5"
      >
        <span className="mx-auto mb-1 block h-2 w-2/3 rounded-full bg-line-card" />
        <span className="mx-auto mb-4 block h-1.5 w-1/3 rounded-full bg-line-row" />

        <div className="mb-4 rounded border border-line-card px-3 py-2">
          <span className="mb-1.5 block font-mono text-[9px] tracking-[0.12em] text-ink-muted">NOTICE</span>
          <span className="mb-1.5 block h-1.5 w-full rounded-full bg-line-card" />
          <span className="mb-1.5 block h-1.5 w-11/12 rounded-full bg-line-card" />
          <span className="block h-1.5 w-3/5 rounded-full bg-line-card" />
        </div>

        <div className="flex flex-col gap-2.5">
          {FIELDS.map((field, i) => (
            <div key={field.label} className="flex items-end gap-3">
              <span className="w-[5.5rem] shrink-0 font-mono text-[10px] text-ink-muted">{field.label}</span>
              <span className="min-w-0 flex-1 truncate border-b border-line-card pb-0.5 text-sm leading-tight">
                <span
                  className="landing-waiver__value inline-block text-ink"
                  style={{ "--landing-waiver-i": i } as CSSProperties}
                >
                  {field.value}
                </span>
              </span>
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-end gap-3">
          <span className="w-[5.5rem] shrink-0 font-mono text-[10px] text-ink-muted">Signature</span>
          <span className="block h-4 flex-1 border-b border-line-card" />
        </div>

        <span
          data-landing-waiver="mark"
          className="landing-waiver__mark absolute bottom-6 right-6 rounded border-[3px] border-tag-green-ink bg-tag-green px-2 py-1 font-mono text-xs font-bold tracking-[0.08em] text-tag-green-ink"
        >
          READY TO SIGN
        </span>
      </div>

      <figcaption className="border-t border-line-row px-4 py-2">
        <span className="block text-sm text-ink">
          Conditional progress waiver for California, filled from four answers.
        </span>
        <span className="block text-[11px] text-ink-body">Illustrative.</span>
      </figcaption>
    </figure>
  );
}
