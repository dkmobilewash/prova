import { Buffer } from "node:buffer";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";

/**
 * Which pages of the training sets are reflected ceiling plans, and what
 * they print: a ceiling legend, A.F.F. height tags, ceiling-type tokens.
 * Keyless; the output names pages for the crops and the answer keys.
 *
 *   REAL_PLAN_DIR=… CEILING_INVENTORY_OUT=… pnpm exec vitest run --config vitest.eval.config.mts realplan/zzCeilingInventory
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const OUT = process.env.CEILING_INVENTORY_OUT ?? "";
const HELD_OUT = [
  "central-bank", "gen-bbq", "sln-terminal", "stem-bid",
  "lodi-memorial", "missouri-new", "nall-wealth",
  "ksu-fairchild", "albany-readiness", "oreillys", "jefferson-city",
];
const RCP_TITLE = /REFLECTED\s+CEILING|CEILING\s+PLAN|\bRCP\b/i;
const LEGEND = /CEILING\s+(?:LEGEND|TYPES?|SCHEDULE|MATERIAL)|LEGEND.*CEILING/i;
const AFF = /^\s*\d{1,2}'\s*-?\s*\d{0,2}"?\s*(?:A\.?F\.?F\.?)?\s*$/i;
const AFF_STRICT = /A\.?F\.?F/i;
const TYPE_TOKEN = /\b(?:ACT|ACP|GWB|GYP(?:SUM)?\.?\s*(?:BD|BOARD)?|GB|LAY-?IN|OPEN\s+TO\s+(?:STRUCTURE|DECK|ABOVE)|EXPOSED\s+STRUCTURE|SUSPENDED|2\s*[xX×]\s*[24]|24\s*[xX×]\s*(?:24|48))\b/i;

describe.skipIf(DIR === "")("ceiling-plan inventory of the training sets", () => {
  it("names the RCP pages and what they print", { timeout: 3_600_000 }, async () => {
    const only = (process.env.CEILING_INVENTORY_SETS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const files = readdirSync(DIR)
      .filter((f) => f.toLowerCase().endsWith(".pdf"))
      // The held-out sets are listed only when asked for by name, for the ONE
      // held-out test; the page inventory is the only look allowed before it.
      .filter((f) => process.env.CEILING_INVENTORY_INCLUDE_HELDOUT === "1" || !HELD_OUT.some((h) => f.toLowerCase().includes(h)))
      .filter((f) => only.length === 0 || only.some((o) => f.toLowerCase().includes(o)))
      .sort();
    const lines: string[] = [];
    const say = (s: string) => {
      lines.push(s);
      console.log(s);
    };
    say(`\n${files.length} sets scanned (held-out excluded by name)`);
    for (const file of files) {
      const doc = await openPlanPdf(Buffer.from(readFileSync(join(DIR, file))));
      const hits: string[] = [];
      for (let p = 1; p <= doc.pageCount; p += 1) {
        const text = await doc.pageText(p);
        const strs = text.items.map((i) => i.str.trim()).filter(Boolean);
        const title = strs.filter((s) => RCP_TITLE.test(s));
        const legend = strs.filter((s) => LEGEND.test(s));
        const aff = strs.filter((s) => AFF_STRICT.test(s) && AFF.test(s));
        const tokens = strs.filter((s) => TYPE_TOKEN.test(s));
        if (title.length > 0 || legend.length > 0 || aff.length >= 3) {
          const t = title.filter((s) => s.length < 60).slice(0, 2).join(" | ");
          hits.push(
            `  p${p}: ${title.length} RCP title(s)${t ? ` [${t}]` : ""}, ${legend.length} legend title(s), ${aff.length} A.F.F. tags, ${tokens.length} type tokens (${[...new Set(tokens.map((s) => s.toUpperCase()))].slice(0, 6).join(", ")}), ${strs.length} items`,
          );
        }
      }
      await doc.close();
      say(`\n${file}: ${doc.pageCount} pages, ${hits.length} ceiling-ish pages`);
      for (const h of hits.slice(0, 20)) say(h);
    }
    if (OUT) writeFileSync(OUT, lines.join("\n"));
    expect(files.length).toBeGreaterThan(0);
  });
});
