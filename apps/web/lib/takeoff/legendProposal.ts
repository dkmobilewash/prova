import type { WallLegendRead } from "@prova/integrations/src/wallLegend";
import type { WallLegendSightRead } from "@prova/integrations/src/wallLegendSight";
import { mergeLegendReads, sameCode } from "./legendMerge";
import type { PartitionAssembly } from "./partitionAssembly";

/**
 * ── WHAT A STORED LEGEND READ LOOKS LIKE ──
 *
 * `PlanLegendProposal.merged` holds one of these per type: the code and name
 * the legend printed, its own lines verbatim, the assembly the reads agree on
 * (the drawing winning where they do not — `mergeLegendReads`), which read
 * each came from, and every disagreement with both values. The review screen
 * shows exactly this; the Add action rebuilds the parts from the fields the
 * person may have edited rather than from these components, so an edit is
 * honoured. Nothing here is a price.
 */
export type StoredLegendType = {
  code: string;
  name: string | null;
  lines: string[];
  assembly: PartitionAssembly;
  from: "text" | "sight" | "both";
  disagreements: { field: string; text: string; sight: string }[];
};

export type StoredCrop = { code: string; x: number; y: number; width: number; height: number };

/** The merged view of a legend, from the text read and the sight read where one exists. */
export function storedLegendTypes(text: WallLegendRead, sight: WallLegendSightRead | null, where: string): StoredLegendType[] {
  return mergeLegendReads({ text, sight, where }).map((m) => {
    const t = text.types.find((one) => sameCode(one.code, m.code));
    const s = sight?.types.find((one) => sameCode(one.code, m.code)) ?? null;
    return {
      code: m.code,
      name: t?.name ?? s?.name ?? null,
      lines: t?.lines ?? [],
      assembly: m.assembly,
      from: m.from,
      disagreements: m.disagreements,
    };
  });
}

/** A stored JSON column back into types; anything malformed is dropped rather than rendered. */
export function storedLegendTypesFromJson(value: unknown): StoredLegendType[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is StoredLegendType =>
      typeof v === "object" && v !== null && typeof (v as StoredLegendType).code === "string" && typeof (v as StoredLegendType).assembly === "object",
  );
}

export function storedCropsFromJson(value: unknown): StoredCrop[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is StoredCrop =>
      typeof v === "object" && v !== null && typeof (v as StoredCrop).code === "string" && typeof (v as StoredCrop).width === "number",
  );
}

export type StudMaterial = "metal" | "wood" | "concrete" | "masonry";

/**
 * Two fields the merged view drops but the library needs, read straight off
 * the stored sight read by code: the legend's own height note, and the stud
 * material — which is what keeps an ICF or CMU type from being written with
 * metal studs. Malformed or missing reads yield nulls, never a guess.
 */
export function sightFieldsFor(sightRead: unknown, code: string): { heightNote: string | null; studMaterial: StudMaterial | null } {
  const types = (sightRead as { types?: unknown } | null)?.types;
  const own = Array.isArray(types)
    ? (types as { code?: unknown; heightNote?: unknown; studMaterial?: unknown }[]).find((t) => typeof t.code === "string" && sameCode(t.code, code))
    : undefined;
  const material = typeof own?.studMaterial === "string" ? own.studMaterial.toLowerCase() : null;
  return {
    heightNote: typeof own?.heightNote === "string" && own.heightNote.trim() !== "" ? own.heightNote : null,
    studMaterial: material === "metal" || material === "wood" || material === "concrete" || material === "masonry" ? material : material === "steel" ? "metal" : null,
  };
}
