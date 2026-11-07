import { Buffer } from "node:buffer";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractWallLegend, WALL_LEGEND_PROMPT_VERSION, type WallLegendRead } from "@prova/integrations/src/wallLegend";
import { modelFor } from "@prova/integrations/src/models";
import { requireEvalApiKey } from "../../ai/evalApiKey";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { wallLegendWork, type WallLegendProposalRow } from "../../plan-ingest/wallLegend";
import { heldOutReason } from "../heldOutSets";
import { legendProposalFrom } from "../legendProposalBuild";
import { nameSheet } from "./nameSheet";

/**
 * ── THE LEGEND READ ON ONE SET, BY THE STAGE'S OWN FUNCTION ──
 *
 * `wallLegendWork` — the WALL_LEGEND stage the app runs — over every page of
 * one set (`LR_PDF`), with its dependencies pointed at files: the title from
 * the keyless reader the inventory uses, the AI gate passing with the app's
 * default plan-reading model, nothing metered or claimed, and each proposal
 * written to `LR_DIR` as the app would store it (`legendProposalFrom`). The
 * model call is the app's (`extractWallLegend`), cached in `LEGEND_CACHE` by
 * set, page and prompt version, so a re-run spends nothing. One summary line
 * per set to `LR_OUT`.
 */
const PDF = process.env.LR_PDF ?? "";
const DIR = process.env.LR_DIR ?? "";
const OUT = process.env.LR_OUT ?? "";
const CACHE = process.env.LEGEND_CACHE ?? "";

describe.skipIf(PDF === "" || DIR === "" || OUT === "" || CACHE === "")("the legend read on one set", () => {
  requireEvalApiKey("legend-read-all eval");
  it("runs the stage over every page", { timeout: 7_200_000 }, async () => {
    const set = basename(PDF);
    const bytes = readFileSync(PDF);
    const doc = await openPlanPdf(Buffer.from(bytes));
    const titles = new Map<number, string | null>();
    for (let page = 1; page <= doc.pageCount; page += 1) {
      try {
        const text = await doc.pageText(page);
        const named = nameSheet(text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, height: i.height })), { widthPt: text.widthPt, heightPt: text.heightPt });
        titles.set(page, named.title === "" ? null : named.title);
      } catch {
        titles.set(page, null);
      }
    }
    const pageCount = doc.pageCount;
    await doc.close();
    const model = modelFor("PLAN_TEXT_READ").model;
    const saved: WallLegendProposalRow[] = [];
    let calls = 0, cached = 0, inputTokens = 0, outputTokens = 0;
    const errors: string[] = [];
    const work = wallLegendWork(
      { planId: "p", companyId: "c", ingestJobId: "i", jobId: "j", startedByUserId: null },
      {
        loadPageTitle: async (_plan, page) => titles.get(page) ?? null,
        openPdf: async () => openPlanPdf(Buffer.from(bytes)),
        gate: async () => ({ ok: true, settings: { aiEnabled: true, disabledFeatures: [], optedInFeatures: ["PLAN_TEXT_READ"], planSheetsPerMonth: 100_000, modelOverride: null }, model, modelSource: "default" }) as never,
        claim: (async () => ({ ok: true, claim: null })) as never,
        markFailure: (async () => {}) as never,
        recordUsage: (async () => {}) as never,
        extract: async (input) => {
          const key = `${set.replace(/\W+/g, "_")}-p${input.pageNumber}-${WALL_LEGEND_PROMPT_VERSION}.json`;
          const at = join(CACHE, key);
          if (existsSync(at)) {
            cached += 1;
            return JSON.parse(readFileSync(at, "utf8")) as WallLegendRead;
          }
          calls += 1;
          const read = await extractWallLegend({ ...input, onUsage: (u) => { inputTokens += u.inputTokens; outputTokens += u.outputTokens; } });
          mkdirSync(CACHE, { recursive: true });
          writeFileSync(at, JSON.stringify(read, null, 1));
          return read;
        },
        saveProposal: async (row) => void saved.push(row),
      },
    );
    for (let page = 1; page <= pageCount; page += 1) {
      const r = await work({ id: `t${page}`, pageNumber: page, stage: "WALL_LEGEND", attempts: 0 } as never);
      if (!r.ok) errors.push(`p${page}: ${r.error.slice(0, 80)}`);
    }
    mkdirSync(DIR, { recursive: true });
    const proposals = saved.map((row) => ({ pageNumber: row.pageNumber, ...legendProposalFrom(row) }));
    writeFileSync(join(DIR, `${set.replace(/\W+/g, "_")}.json`), JSON.stringify({ set, prompt: WALL_LEGEND_PROMPT_VERSION, model, proposals }, null, 1));
    const codes = [...new Set(saved.flatMap((row) => row.read.types.map((t) => t.code.toUpperCase())))];
    const uno = saved.flatMap((row) => row.read.uno ?? []);
    appendFileSync(
      OUT,
      JSON.stringify({ set, heldOut: heldOutReason(set) !== null, pages: pageCount, legendPages: saved.map((r) => r.pageNumber), codes, uno: uno.length, calls, cached, inputTokens, outputTokens, errors }) + "\n",
    );
    expect(titles.size, "no page of the set was read").toBeGreaterThan(0);
  });
});
