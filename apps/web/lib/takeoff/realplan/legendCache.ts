import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** The product's legend reader output for this PDF, cached per page (legend-cache: <stem>-p<N>-wall-legend.<v>.json). */
export function cachedLegendTypes(pdf: string, LEGEND_CACHE: string): { code: string; heightNote: string | null; lines: string[] }[] {
  if (LEGEND_CACHE === "" || !existsSync(LEGEND_CACHE)) return [];
  const stem = pdf.split("/").at(-1)!.replace(/[^A-Za-z0-9]+/g, "_");
  const byPage = new Map<string, string>();
  for (const n of readdirSync(LEGEND_CACHE)) {
    const m = new RegExp(`^${stem}-p(\\d+)-wall-legend\\.(\\d+)\\.json$`).exec(n);
    if (m === null) continue;
    const had = byPage.get(m[1]!);
    if (had === undefined || Number(/\.(\d+)\.json$/.exec(had)![1]) < Number(m[2])) byPage.set(m[1]!, n);
  }
  const out = new Map<string, { code: string; heightNote: string | null; lines: string[] }>();
  for (const n of byPage.values()) {
    const d = JSON.parse(readFileSync(join(LEGEND_CACHE, n), "utf8")) as { types?: { code: string; heightNote?: string; lines?: string[] }[] };
    for (const t of d.types ?? []) if (!out.has(t.code.toUpperCase())) out.set(t.code.toUpperCase(), { code: t.code, heightNote: t.heightNote ?? null, lines: t.lines ?? [] });
  }
  return [...out.values()];
}
