"use client";

import { saveProductionRates } from "@/lib/actions";
import type { ProductionRates } from "@/lib/estimating/productionRates";
import { ActionForm } from "./ActionForm";
import { SubmitButton } from "./SubmitButton";

const input = "w-24 rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted";

/**
 * How fast this company's crews work, and what an hour costs. Every field starts EMPTY on purpose —
 * there is no industry number here, because a rate is a fact about your crews. The estimate writes a
 * labor line only for the work whose rate is filled in, and asks for the rest.
 */
export function ProductionRatesForm({ rates }: { rates: ProductionRates }) {
  const field = (name: string, label: string, value: number | null, unit: string) => (
    <label className="flex items-center justify-between gap-2 text-sm text-ink-body">
      <span>{label}</span>
      <span className="inline-flex items-center gap-1">
        <input name={name} inputMode="decimal" autoComplete="off" defaultValue={value === null ? "" : String(value)} placeholder="not set" className={input} data-rates={name} />
        <span className="w-20 text-xs text-ink-muted">{unit}</span>
      </span>
    </label>
  );
  return (
    <ActionForm action={saveProductionRates} resetOnSuccess={false} className="flex max-w-md flex-col gap-2">
      <p className="text-sm text-ink-body">
        Your crews&apos; rates. The estimate turns confirmed walls and ceilings into labor hours and cost from these. Leave a field empty and that work gets no labor line — nothing is filled in for you.
      </p>
      <p className="mt-1 text-sm font-semibold text-ink">Framing</p>
      {field("framingLfPerHr", "Studs and track", rates.framingLfPerHr, "lin ft / hr")}
      <p className="mt-1 text-sm font-semibold text-ink">Hanging board</p>
      {field("boardRegular", "Regular", rates.boardSfPerHr.regular, "sq ft / hr")}
      {field("boardTypeX", "Type X", rates.boardSfPerHr.typeX, "sq ft / hr")}
      {field("boardSpecial", "Abuse, impact, moisture-resistant", rates.boardSfPerHr.special, "sq ft / hr")}
      <p className="mt-1 text-sm font-semibold text-ink">Taping and finishing</p>
      {field("finishLevel3", "Level 3", rates.finishSfPerHr.level3, "sq ft / hr")}
      {field("finishLevel4", "Level 4", rates.finishSfPerHr.level4, "sq ft / hr")}
      {field("finishLevel5", "Level 5", rates.finishSfPerHr.level5, "sq ft / hr")}
      <label className="flex items-center justify-between gap-2 text-sm text-ink-body">
        <span>Finish level when the spec doesn&apos;t say Level 5</span>
        <select name="defaultFinishLevel" defaultValue={String(rates.defaultFinishLevel)} className="rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink">
          <option value="3">Level 3</option>
          <option value="4">Level 4</option>
          <option value="5">Level 5</option>
        </select>
      </label>
      <p className="mt-1 text-sm font-semibold text-ink">Ceilings</p>
      {field("ceilingSfPerHr", "Ceilings", rates.ceilingSfPerHr, "sq ft / hr")}
      <p className="mt-1 text-sm font-semibold text-ink">Doors (when you install them: Settings, Doors and frames)</p>
      {field("doorFramesPerHr", "Hollow-metal frames set", rates.doorFramesPerHr, "frames / hr")}
      {field("doorsPerHr", "Doors hung, with hardware", rates.doorsPerHr, "doors / hr")}
      <p className="mt-1 text-sm font-semibold text-ink">Taller walls take longer</p>
      {field("over10Multiplier", "Hours × for walls over 10 ft", rates.over10Multiplier, "×")}
      {field("over14Multiplier", "Hours × for walls over 14 ft", rates.over14Multiplier, "×")}
      <p className="mt-1 text-sm font-semibold text-ink">Cost</p>
      {field("crewRatePerHr", "What an hour of crew costs you", rates.crewRatePerHr, "$ / hr")}
      <SubmitButton type="submit" className="mt-2 self-start rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50">
        Save rates
      </SubmitButton>
    </ActionForm>
  );
}
