import type { StandingLine } from "@/lib/determination-standing";

const TONE_CLASS: Record<StandingLine["tone"], string> = {
  ok: "text-tag-green-ink",
  warn: "text-tag-amber-ink",
  bad: "text-tag-rose-ink",
  none: "text-ink-muted",
};

const TONE_MARK: Record<StandingLine["tone"], string> = {
  ok: "✓",
  warn: "⚠",
  bad: "⚠",
  none: "–",
};

/**
 * The one sentence that says whether a prevailing-wage determination is
 * still the one in force for its job. The words come from
 * `determinationStandingLine` in lib/determination-standing.ts, so the
 * Compliance tab, /prevailing-wage and the Ask tool all say the same thing;
 * this only picks the colour. No "use client": it renders in server
 * components and carries no state.
 */
export function DeterminationStandingLine({ line, className = "" }: { line: StandingLine; className?: string }) {
  return (
    <p className={`text-xs ${TONE_CLASS[line.tone]} ${className}`.trim()} data-standing-tone={line.tone}>
      <span aria-hidden="true">{TONE_MARK[line.tone]} </span>
      {line.text}
    </p>
  );
}
