"use client";

import type { CSSProperties, ReactNode } from "react";
import { motionPlayState, useMotionCue } from "./useMotionCue";
import "./waiverFill.css";

/**
 * The hero of the public /lien-waiver page: the mess a waiver usually starts
 * from — a GC's text, a sticky note, an invoice, an old form — gets scanned,
 * and a clean waiver comes out of the top like a printer, laid out the way
 * a waiver normally is, then stamped PDF READY.
 *
 * Same motion contract as SubmittalStamp.tsx: at rest the figure is
 * FINISHED — the clean waiver on the stage, the stamp on it and the mess
 * gone — for a server render, no JS, and reduced motion. `useMotionCue` only
 * replays the whole sequence when the figure is on screen. The stage is
 * fixed-height and clipped and only transform/opacity animate, so nothing
 * changes height.
 *
 * The waiver's body text is drawn as grey bars, never words: the statutory
 * wording is not this page's to paraphrase. The stage is aria-hidden; the
 * caption under it says what it shows.
 */

/** The mess, one card each. `pos` places it; `r` is its resting tilt;
 * `dx`/`dy` is where it is pulled as it is digitised (toward the middle);
 * `t` is its top as a fraction of the stage height, so it digitises the
 * moment the scan band reaches it. */
const MESS: { pos: string; card: string; r: string; dx: string; dy: string; t: number; node: ReactNode }[] = [
  {
    pos: "left-[5%] top-[17%] w-[45%]",
    card: "rounded-2xl rounded-bl-md border border-line-card bg-tag-slate text-ink",
    r: "-3deg",
    dx: "25%",
    dy: "50%",
    t: 0.17,
    node: (
      <>
        <span className="mb-0.5 block text-[10px] font-semibold text-tag-slate-ink">Text from GC</span>
        Need your waiver for the March pay app by Friday
      </>
    ),
  },
  {
    pos: "right-[5%] top-[20%] w-[40%]",
    card: "rounded-lg bg-brand text-neutral-900",
    r: "4deg",
    dx: "-25%",
    dy: "50%",
    t: 0.2,
    node: (
      <span className="block font-headline text-[15px] font-semibold leading-tight">
        Apex · Harbor Blvd
        <br />
        Pay app thru Mar 31
      </span>
    ),
  },
  {
    pos: "left-[7%] top-[53%] w-[42%]",
    card: "rounded-lg bg-white text-neutral-900",
    r: "3deg",
    dx: "25%",
    dy: "-45%",
    t: 0.53,
    node: (
      <>
        <span className="block font-mono text-[10px] font-semibold tracking-[0.06em] text-neutral-600">
          INVOICE 1042
        </span>
        <span className="mt-1 flex items-baseline justify-between gap-2 border-t border-neutral-200 pt-1">
          <span className="text-[10px] text-neutral-600">Due</span>
          <span className="font-semibold">$48,250.00</span>
        </span>
      </>
    ),
  },
  {
    pos: "right-[6%] top-[57%] w-[42%]",
    card: "rounded-lg border border-line-card bg-surface text-ink",
    r: "-4deg",
    dx: "-25%",
    dy: "-45%",
    t: 0.57,
    node: (
      <span className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 rounded bg-tag-rose px-1 py-px font-mono text-[9px] font-bold text-tag-rose-ink">
          PDF
        </span>
        <span className="min-w-0">
          <span className="block text-[10px] text-ink-muted">Fwd: waiver form</span>
          <span className="block">old form.pdf</span>
        </span>
      </span>
    ),
  },
];

const FIELDS = [
  { label: "Name of claimant", value: "Ridgeline Drywall Inc." },
  { label: "Name of customer", value: "Apex Builders" },
  { label: "Job location", value: "1200 Harbor Blvd" },
  { label: "Payment amount", value: "$48,250.00" },
] as const;

function Bars({ widths }: { widths: string[] }) {
  return (
    <>
      {widths.map((w, i) => (
        <span key={i} className={`mb-1 block h-[3px] rounded-full bg-neutral-300 ${w}`} />
      ))}
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-end gap-2">
      <span className="w-[6.5rem] shrink-0 text-[8px] text-neutral-600">{label}:</span>
      <span className="min-w-0 flex-1 truncate border-b border-neutral-400 text-[11px] font-medium leading-tight">
        {value}
      </span>
    </div>
  );
}

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
        <span className="rounded bg-brand px-1.5 py-0.5 font-mono text-xs font-bold text-neutral-900">PDF</span>
        <span className="text-sm text-ink">Conditional waiver · progress payment</span>
      </div>

      <div aria-hidden="true" data-landing-waiver="stage" className="landing-waiver__stage relative overflow-hidden bg-canvas">
        {/* The mess. The outer box drops in; the inner card is what the scan
            digitises, and it is invisible at rest. */}
        {MESS.map((piece, i) => (
          <div
            key={i}
            className={`landing-waiver__drop absolute ${piece.pos}`}
            style={{ "--i": i, "--r": piece.r } as CSSProperties}
          >
            <div
              className={`landing-waiver__mess relative px-3 py-2 text-[12px] leading-snug shadow-[0_10px_24px_rgba(0,0,0,0.5)] ${piece.card}`}
              style={{ "--t": piece.t, "--dx": piece.dx, "--dy": piece.dy } as CSSProperties}
            >
              {piece.node}
            </div>
          </div>
        ))}

        {/* The printer slot the clean waiver comes out of. */}
        <span className="absolute inset-x-3 top-0 z-20 h-3 rounded-b-md border-b border-line-card bg-rail shadow-[0_4px_10px_rgba(0,0,0,0.6)]" />

        {/* The clean waiver — white paper, laid out the way waivers are. Its
            title breaks on purpose, so its height is the same at every width
            and the stage can be sized to it. */}
        <div className="landing-waiver__doc absolute inset-x-5 top-3 z-10 rounded-b-md bg-white px-4 pb-4 pt-4 text-neutral-900 shadow-[0_16px_40px_rgba(0,0,0,0.55)]">
          <p className="text-center text-[9px] font-bold uppercase leading-tight tracking-[0.04em]">
            Conditional waiver and release
            <br />
            on progress payment
          </p>
          <div className="mt-2 border-2 border-neutral-900 px-2 py-1.5">
            <span className="block text-[8px] font-bold tracking-[0.1em]">NOTICE:</span>
            <Bars widths={["w-full", "w-full", "w-2/3"]} />
          </div>
          <p className="mt-2.5 text-[8px] font-bold uppercase tracking-[0.06em]">Identifying information</p>
          <div className="mt-1 flex flex-col gap-1">
            {FIELDS.map((field) => (
              <Field key={field.label} {...field} />
            ))}
          </div>
          <p className="mt-2.5 text-[8px] font-bold uppercase tracking-[0.06em]">Conditional waiver and release</p>
          <div className="mt-1">
            <Bars widths={["w-full", "w-full", "w-11/12", "w-1/2"]} />
          </div>
          <div className="mt-2">
            <Field label="Through date" value="March 31" />
          </div>
          <div className="mt-4 flex items-end gap-2">
            <span className="text-[8px] text-neutral-600">Signature:</span>
            <span className="block h-3 flex-1 border-b border-neutral-400" />
          </div>

          {/* Stamped on the paper, over the signature line. */}
          <span
            data-landing-waiver="mark"
            className="landing-waiver__mark absolute bottom-2 right-4 rounded border-[3px] border-tag-green-ink bg-tag-green px-2 py-1 font-mono text-xs font-bold tracking-[0.08em] text-tag-green-ink shadow-[0_4px_12px_rgba(0,0,0,0.25)]"
          >
            PDF READY
          </span>
        </div>

        {/* The scanner: a soft band, brightest along its centre line. */}
        <span className="landing-waiver__scan pointer-events-none absolute inset-x-0 top-0 z-30 h-28 bg-[linear-gradient(to_bottom,transparent,rgba(250,204,21,0.07)_35%,rgba(250,204,21,0.2)_50%,rgba(250,204,21,0.07)_65%,transparent)]">
          <span className="absolute inset-x-0 top-1/2 h-px bg-[rgba(250,204,21,0.85)] shadow-[0_0_12px_2px_rgba(250,204,21,0.45)]" />
        </span>
      </div>

      <figcaption className="border-t border-line-row px-4 py-2">
        <span className="block text-sm text-ink">
          The details from texts, notes and invoices, filled into one clean form.
        </span>
        <span className="block text-[11px] text-ink-body">Illustrative.</span>
      </figcaption>
    </figure>
  );
}
