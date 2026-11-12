import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { CEILING_PAGE_TITLE } from "../../plan-ingest/rooms";
import { tableRowsFromPage } from "../../plan-ingest/scheduleTable";
import { ceilingsForRooms, type CeilingPageText } from "../roomCeilings";
import { setHeightFacts } from "../setHeightFacts";
import { sheetRooms } from "../sheetRooms";
import { pointInRing } from "../drawTools";
import { setHeightRule, wallHeightByCode } from "../heightsByCode";
import { roofPartsFor } from "../roofPartsRead";
import { roomPitched } from "../roofParts";

/**
 * ── D. WALL HEIGHTS FROM THE DRAWING, BY CODE: WHAT EACH LABELLED WALL HAS TO GO ON ──
 *
 * One row per labelled wall run of a keyed type (heights-key-v1, rounds 14/15/16b): its footage, the
 * key's height for its type (feet, basis, zones), the ceiling height of the room on each side of it
 * (rooms closed from the LABELLED walls, so wall finding is not what is measured; ceilings by the app's
 * own `ceilingsForRooms` over the set's ceiling plans), and the set's height facts (`setHeightFacts`:
 * general notes, structure and bearing elevations, ceiling notes, levels). No model is called and no
 * cached model read is used. The rule that turns these into a height is fitted on TRAINING rows only;
 * held-out (`HB_HELD=1`) is dumped once per change and never looked at while fitting.
 *
 *     REAL_PLAN_DIR=… TAKEOFF_LABEL_DIR=… HEIGHTS_KEY=…/heights-key-r16.json HB_OUT=rows.json [HB_HELD=1] \
 *       npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/zzHeightsByCode.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const KEY = process.env.HEIGHTS_KEY ?? "";
const OUT = process.env.HB_OUT ?? "";
const HELD = process.env.HB_HELD === "1";
/** coordination/joplin-room-parts-key.md: "room# | name | PART | evidence" lines, the key for Joplin's three roof heights. */
const ROOM_PARTS = process.env.HB_ROOM_PARTS ?? "";
const TOLERANCE_FT = 0.5;
/** HB_SETS=Hutto,STEM: only these sets (finishing one measurement a harness gap skipped, never re-measuring). */
const ONLY = (process.env.HB_SETS ?? "").split(",").filter(Boolean);

type KeyType = { feet?: number; basis?: string; zones?: { zone: string; kind: string; feet: number }[]; excluded?: boolean; sameAs?: string };
type KeySet = { heldOut: boolean; labelSet: string; types: Record<string, KeyType> };
type Label = { page: number; sheet: string; feetPerUnit: number; verdicts: { x1: number; y1: number; x2: number; y2: number; lengthFeet: number; thicknessFeet: number; verdict: string; wallType?: string }[]; traced?: { x1: number; y1: number; x2: number; y2: number; lengthFeet: number; wallType?: string }[] };

/** "C6" → the key's "C" when the key has no "C6" (the letter's entry, as the round-14 scorer did). */
export function keyTypeFor(types: Record<string, KeyType>, code: string): [string, KeyType] | null {
  const letter = /^([A-Z]+)\d+$/i.exec(code)?.[1];
  const found = types[code] ? code : letter && types[letter] ? letter : null;
  if (found === null) return null;
  // "IW-4": { sameAs: "IW-1" } is IW-1's height.
  const t = types[found]!;
  return t.sameAs && types[t.sameAs] ? [found, { ...types[t.sameAs]!, excluded: t.excluded ?? types[t.sameAs]!.excluded }] : [found, t];
}

/** The key's height for one wall: a single figure, or the zone its rooms settle, else every zone's figure (lenient only). */
function keyHeights(setName: string, k: KeyType, sideRooms: readonly (string | null)[], parts: Map<string, string>): { strict: number | null; any: number[] } {
  if (k.feet !== undefined) return { strict: k.feet, any: [k.feet] };
  const zones = k.zones ?? [];
  const any = zones.map((z) => z.feet);
  const numbers = sideRooms.filter((n): n is string => n !== null);
  const zoneOf = (n: string) => {
    if (setName === "Joplin") {
      const part = parts.get(n)?.toLowerCase();
      return part ? zones.find((z) => z.zone.toLowerCase().startsWith(part === "lower" ? "lower" : part)) : undefined;
    }
    if (setName === "Bunkie") return zones.find((z) => (/^E/i.test(n) && /\(E rooms\)/.test(z.zone)) || (/^K/i.test(n) && /\(K rooms\)/.test(z.zone)));
    return undefined;
  };
  const settled = [...new Set(numbers.map(zoneOf).filter((z) => z !== undefined).map((z) => z!.feet))];
  return { strict: settled.length === 1 ? settled[0]! : null, any };
}

describe.skipIf(DIR === "" || LABELS === "" || KEY === "" || OUT === "")("D: heights by code, the rows", () => {
  it("dumps one row per keyed labelled wall", async () => {
    const key = JSON.parse(readFileSync(KEY, "utf8")) as { sets: Record<string, KeySet> };
    const rows: unknown[] = [];
    const parts = new Map<string, string>();
    if (ROOM_PARTS !== "" && existsSync(ROOM_PARTS)) {
      for (const line of readFileSync(ROOM_PARTS, "utf8").split("\n")) {
        const cells = line.split("|").map((c) => c.trim());
        if (cells.length >= 3 && /^\d+[A-Z]?$/i.test(cells[0]!) && /^(CENTRAL|ADMIN|LOWER)$/i.test(cells[2]!)) parts.set(cells[0]!, cells[2]!);
      }
    }
    const score = new Map<string, { ft: number; withHeight: number; right: number; lenient: number; wrong: number }>();
    /** Per rule class: footage scored strictly (the key settles one figure), and how much of it is right — the posting bar's precision. */
    const byClass = new Map<string, { scored: number; right: number }>();
    for (const [setName, set] of Object.entries(key.sets)) {
      if (set.heldOut !== HELD) continue;
      if (ONLY.length > 0 && !ONLY.includes(setName)) continue;
      // The key names files as the label snapshot does ("…_2_.pdf"); the plan folder spaces them ("… (2).pdf").
      const flat = (n: string) => n.replace(/\.pdf$/i, "").replace(/[^a-z0-9]+/gi, "").toUpperCase();
      const pdf = join(DIR, readdirSync(DIR).find((n) => n.toLowerCase().endsWith(".pdf") && flat(n) === flat(set.labelSet)) ?? set.labelSet);
      const labelDir = join(LABELS, set.labelSet);
      if (!existsSync(pdf) || !existsSync(labelDir)) {
        console.log(`[hb] ${setName}: ${existsSync(pdf) ? "no labels" : "no pdf"}, skipped`);
        continue;
      }
      const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
      try {
        const facts = await setHeightFacts(doc, { legendPage: 0, maxPages: 120 });
        const rule = setHeightRule(facts.generalNote, facts.facts);
        // The roof plan over each floor plan, only where the rule needs it (several structure levels).
        const roofs = rule?.kind === "to-structure-by-roof" ? await roofPartsFor(doc, facts) : new Map();
        console.log(`[hb] ${setName}: rule ${rule === null ? "none" : `${rule.kind}${"feet" in rule ? ` ${rule.feet} ft` : ""}${"inches" in rule ? ` +${rule.inches}"` : ""}`}`);
        const ceilingPages: CeilingPageText[] = [];
        for (let n = 1; n <= Math.min(doc.pageCount, 160) && ceilingPages.length < 40; n += 1) {
          const page = await doc.pageText(n).catch(() => null);
          if (!page || !CEILING_PAGE_TITLE.test(page.items.map((i) => i.str).join(" "))) continue;
          const strokes = await doc.pageStrokes(n).catch(() => null);
          ceilingPages.push({ pageNumber: n, items: page.items, widthPt: page.widthPt, tableRows: tableRowsFromPage(page), strokes: strokes?.segments.map((s) => ({ x1: s.x1 / strokes.widthPt, y1: s.y1 / strokes.widthPt, x2: s.x2 / strokes.widthPt, y2: s.y2 / strokes.widthPt })) });
        }
        for (const file of readdirSync(labelDir).filter((f) => f.endsWith(".json"))) {
          const label = JSON.parse(readFileSync(join(labelDir, file), "utf8")) as Label;
          const walls = [
            ...label.verdicts.filter((v) => v.verdict === "wall" && v.wallType),
            ...(label.traced ?? []).filter((t) => t.wallType).map((t) => ({ ...t, thicknessFeet: 0.5, verdict: "wall" })),
          ];
          const keyed = walls.flatMap((w) => {
            const k = keyTypeFor(set.types, w.wallType!);
            return k && !k[1].excluded ? [{ w, code: k[0], k: k[1] }] : [];
          });
          if (keyed.length === 0) continue;
          const text = await doc.pageText(label.page);
          const strokes = await doc.pageStrokes(label.page);
          const W = text.widthPt;
          const segments = strokes.segments.map((s) => ({ ...s, x1: s.x1 / W, y1: s.y1 / W, x2: s.x2 / W, y2: s.y2 / W }));
          const found = sheetRooms({ pairings: [], runs: walls.map((w) => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, thicknessFeet: w.thicknessFeet })) as never, drawn: [], segments, doorLeaves: [], feetPerUnit: label.feetPerUnit, text: text.items, widthPt: W });
          const current: CeilingPageText = { pageNumber: label.page, items: text.items, widthPt: W, tableRows: tableRowsFromPage(text) };
          const ceilings = ceilingsForRooms({ rooms: found.rooms, current, feetPerUnit: label.feetPerUnit, others: ceilingPages.filter((p) => p.pageNumber !== label.page) });
          for (const { w, code, k } of keyed) {
            const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
            const sides: (number | null)[] = [];
            const sideRooms: (string | null)[] = [];
            const sidePitched: (boolean | null)[] = [];
            const roof = roofs.get(label.page);
            // Either side of the run's middle, past half its drawn thickness.
            const off = Math.max(0.004, (w.thicknessFeet / label.feetPerUnit) * 0.75);
            for (const s of [1, -1]) {
              const px = (w.x1 + w.x2) / 2 + (s * -(w.y2 - w.y1) / len) * off;
              const py = (w.y1 + w.y2) / 2 + (s * (w.x2 - w.x1) / len) * off;
              const room = found.rooms.find((r) => pointInRing(px, py, r.xs, r.ys));
              sides.push(room ? (ceilings.get(room.id)?.heightFeet ?? -1) : null);
              sideRooms.push(room?.tag?.number ?? null);
              sidePitched.push(room && roof ? roomPitched(roof.mask, { xs: room.xs, ys: room.ys, named: room.tag !== null }) : null);
            }
            const mine = wallHeightByCode(rule, sides, sidePitched);
            const want = keyHeights(setName, k, sideRooms, parts);
            const at = score.get(setName) ?? { ft: 0, withHeight: 0, right: 0, lenient: 0, wrong: 0 };
            at.ft += w.lengthFeet;
            if (mine !== null) {
              at.withHeight += w.lengthFeet;
              const near = (h: number) => Math.abs(h - mine.feet) <= TOLERANCE_FT;
              // WRONG: the key settles a figure and this is not it, or it matches none of the type's figures.
              // Lenient is only for walls whose zone the key cannot settle (no room part, no room number).
              const right = want.strict !== null && near(want.strict);
              const wrong = want.strict !== null ? !right : !want.any.some(near);
              if (right) at.right += w.lengthFeet;
              if (wrong) at.wrong += w.lengthFeet;
              else at.lenient += w.lengthFeet;
              if (want.strict !== null && rule !== null) {
                const c = byClass.get(rule.kind) ?? { scored: 0, right: 0 };
                c.scored += w.lengthFeet;
                if (right) c.right += w.lengthFeet;
                byClass.set(rule.kind, c);
              }
            }
            score.set(setName, at);
            rows.push({ set: setName, held: set.heldOut, sheet: label.sheet, page: label.page, type: w.wallType, keyCode: code, lf: Math.round(w.lengthFeet * 10) / 10, key: k, sides, sideRooms, mine, want });
          }
          console.log(`[hb] ${setName} ${label.sheet}: ${keyed.length} keyed walls, ${found.rooms.length} rooms, ${[...ceilings.values()].filter((c) => c.heightFeet !== null).length} with a ceiling height`);
        }
        rows.push({ set: setName, held: set.heldOut, facts: { general: facts.generalNote, facts: facts.facts.map((f) => ({ kind: f.kind, feet: f.feet, sheet: f.sheet, text: (f.text ?? f.phrase).slice(0, 160) })), levels: facts.levels?.length ?? 0 } });
      } finally {
        await doc.close().catch(() => {});
      }
    }
    writeFileSync(OUT, JSON.stringify(rows));
    // % of keyed wall footage: with a height, right (the key's figure for it, within 6 in), right
    // against any of the type's zones (lenient), and WRONG (matches none of them).
    const pct = (n: number, d: number) => (d === 0 ? "-" : `${((n / d) * 100).toFixed(1)}%`);
    const total = { ft: 0, withHeight: 0, right: 0, lenient: 0, wrong: 0 };
    for (const [setName, at] of score) {
      console.log(`HB ${setName.padEnd(18)} ft=${at.ft.toFixed(0).padStart(5)} with=${pct(at.withHeight, at.ft)} right=${pct(at.right, at.ft)} lenient=${pct(at.lenient, at.ft)} wrong=${pct(at.wrong, at.ft)}`);
      for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += at[key];
    }
    for (const [kind, c] of byClass) console.log(`HB class ${kind.padEnd(22)} scored=${c.scored.toFixed(0).padStart(5)} ft precision=${pct(c.right, c.scored)}`);
    console.log(`HB ${HELD ? "HELD-OUT" : "TRAINING"} ft=${total.ft.toFixed(0)} with=${pct(total.withHeight, total.ft)} right=${pct(total.right, total.ft)} lenient=${pct(total.lenient, total.ft)} wrong=${pct(total.wrong, total.ft)}`);
    expect(rows.length).toBeGreaterThan(0);
  }, 3_600_000);
});
