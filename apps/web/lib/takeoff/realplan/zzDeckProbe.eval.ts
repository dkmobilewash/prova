import { Buffer } from "node:buffer";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { deckZonesFor } from "../deckZonesRead";
import { setHeightFacts } from "../setHeightFacts";

// Reader-only probe (THIRD): what deckZonesFor finds on the corpus sets. No key.
const DIRS = (process.env.PDF_DIRS ?? "").split("|").filter(Boolean);
const SETS = (process.env.SCAN_SETS ?? "").split("|").filter(Boolean);
const flat = (t: string) => t.replace(/[^a-z0-9]+/gi, "").toUpperCase();
it.skipIf(SETS.length === 0)("deck zones on the corpus sets", { timeout: 3_600_000 }, async () => {
  const pdfs = DIRS.flatMap((d) => readdirSync(d).filter((n) => n.toLowerCase().endsWith(".pdf")).map((n) => join(d, n)));
  for (const set of SETS) {
    const pdf = pdfs.find((p) => flat(p.split("/").at(-1)!).startsWith(flat(set)));
    if (pdf === undefined) { console.log(`DECK ${set}: no pdf`); continue; }
    const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
    const facts = await setHeightFacts(doc, { legendPage: 0, maxPages: 160 });
    const datums = facts.facts.filter((f) => f.kind === "floor-datum").map((f) => f.feet!);
    const floor = datums.length > 0 ? datums.sort((a, b) => datums.filter((x) => x === a).length - datums.filter((x) => x === b).length).at(-1)! : null;
    // The labelled pages of this set (the sheets the key prices), at their key scale.
    const L = process.env.TAKEOFF_LABEL_DIR ?? "";
    const dir = L === "" ? null : readdirSync(L).find((d) => flat(d).startsWith(flat(set)));
    const forPages = dir == null ? undefined : readdirSync(join(L, dir)).filter((n) => n.endsWith(".json")).map((n) => JSON.parse(readFileSync(join(L, dir, n), "utf8")) as { page: number; feetPerUnit: number }).map((d) => ({ page: d.page, feetPerUnit: d.feetPerUnit }));
    const zones = await deckZonesFor(doc, floor, forPages);
    console.log(`DECK ${set}: floor ${floor} · floor pages with zones ${zones.size}`);
    for (const [page, z] of zones) console.log(`  p${page} default ${z.zones.defaultFeet} · points ${z.zones.points.map((p) => `${p.feet.toFixed(2)}@(${p.x.toFixed(2)},${p.y.toFixed(2)}) "${p.phrase.slice(0, 40)}"`).join("; ")} · eaves ${z.zones.eaves.length} ridges ${z.zones.ridges.length}`);
    await doc.close();
  }
});
