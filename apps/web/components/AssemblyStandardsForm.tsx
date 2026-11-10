"use client";

import { saveAssemblyStandards } from "@/lib/actions";
import { MATERIAL_KINDS, type AssemblyStandards } from "@/lib/estimating/assemblyStandards";
import { ActionForm } from "./ActionForm";
import { SubmitButton } from "./SubmitButton";

const input = "w-20 rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink";

/**
 * The company's quantity standards: what a legend wall type's screws, tape and compound are worked
 * out from, the waste on each material, and the stud spacing used when neither the drawing nor the
 * spec gives one. They apply to wall types added from a legend from now on; a type already in the
 * library keeps the parts it was made with, which its own card edits.
 */
export function AssemblyStandardsForm({ standards }: { standards: AssemblyStandards }) {
  const num = (name: string, label: string, value: number, unit: string) => (
    <label className="flex items-center justify-between gap-2 text-sm text-ink-body">
      <span>{label}</span>
      <span className="inline-flex items-center gap-1">
        <input name={name} inputMode="decimal" autoComplete="off" defaultValue={String(value)} className={input} />
        <span className="w-14 text-xs text-ink-muted">{unit}</span>
      </span>
    </label>
  );
  return (
    <ActionForm action={saveAssemblyStandards} resetOnSuccess={false} className="flex max-w-md flex-col gap-2">
      <p className="text-sm text-ink-body">
        Wall types read from a legend get screws, tape and joint compound worked out from these, plus waste on every material. Quantities only — prices come from your price book.
      </p>
      {num("studSpacingIn", "Stud spacing when nothing says", standards.studSpacingIn, "in o.c.")}
      {num("screwsPerSqFt", "Screws per sq ft of board, per layer", standards.screwsPerSqFt, "ea")}
      {num("tapeLfPerSqFt", "Joint tape per sq ft of board", standards.tapeLfPerSqFt, "lin ft")}
      {num("compoundLbPerSqFt", "Joint compound per sq ft of board", standards.compoundLbPerSqFt, "lb")}
      {num("level5SkimLbPerSqFt", "Extra compound for a Level 5 finish", standards.level5SkimLbPerSqFt, "lb")}
      <p className="mt-2 text-sm font-semibold text-ink">Waste</p>
      {MATERIAL_KINDS.map((k) => num(`waste-${k}`, k[0].toUpperCase() + k.slice(1), standards.wastePercent[k], "%"))}
      <SubmitButton type="submit" className="mt-2 self-start rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50">
        Save standards
      </SubmitButton>
    </ActionForm>
  );
}
