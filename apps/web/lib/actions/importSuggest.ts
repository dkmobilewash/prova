"use server";

import { suggestImportColumns } from "@prova/integrations";
import { requireCompanyContext } from "@/lib/auth";
import { aiGate } from "@/lib/ai/settings";
import { claimAskAllowance, markAskAllowanceFailure } from "@/lib/ask/allowance";
import { recordAskUsage } from "@/lib/ask/usage";
import { KIND_FIELD_OPTIONS, KIND_WORDS, MAX_SAMPLE_ROWS, sampleForModel } from "@/lib/import-smart-map";
import type { ImportKind } from "@/lib/spreadsheet-import";
import { ownerRefusal, type ActionResultWith } from "./shared";

/**
 * "Suggest the rest" on /settings/import — the model layer of the column
 * mapper, for the columns the synonym dictionary could not place.
 *
 * It WRITES NOTHING but a usage row. It returns `{ column: field }` proposals
 * the review screen shows as "AI guess"; the import itself is still the
 * person pressing Import, through lib/actions/spreadsheetImport.ts.
 *
 * Guards, in order, all RETURNED:
 *   1. Owner only — the same as the imports these columns feed.
 *   2. `aiGate(…, "ASK")` — the company's AI switch. Off means no model call
 *      and no allowance claimed (`importSuggest.test.ts` pins both).
 *   3. One assistant question claimed from the paid monthly allowance BEFORE
 *      the call, marked (never released) if the call fails — the rule
 *      lib/ask/allowance.ts sets for every metered caller.
 *
 * What reaches the model is rebuilt here, not trusted from the browser: at
 * most five sample rows, cells cut short, every digit masked, and only for
 * the columns the browser said were unplaced.
 */

const KINDS = Object.keys(KIND_FIELD_OPTIONS) as ImportKind[];

export async function suggestImportColumnFields(input: {
  kind: string;
  columns: { index: number; header: string; values: string[] }[];
}): Promise<ActionResultWith<{ matches: Record<number, string> }>> {
  const context = await requireCompanyContext();
  const refusal = ownerRefusal(context, "Only the account owner can import records.");
  if (refusal) return refusal;

  const kind = KINDS.find((one) => one === input.kind);
  if (!kind) return { ok: false, error: "Pick what this file holds first." };
  const columns = (Array.isArray(input.columns) ? input.columns : [])
    .filter((column) => Number.isInteger(column?.index) && typeof column.header === "string")
    .slice(0, 60)
    .map((column) => ({
      index: column.index,
      ...sampleForModel(column.header, (Array.isArray(column.values) ? column.values : []).slice(0, MAX_SAMPLE_ROWS).map(String)),
    }));
  if (columns.length === 0) return { ok: true, value: { matches: {} } };

  const gate = await aiGate(context.company.id, "ASK");
  if (!gate.ok) return { ok: false, error: gate.error };

  const spend = await claimAskAllowance(context.company.id, { questions: 1, pages: 0 });
  if (!spend.ok) return { ok: false, error: spend.error };

  try {
    const matches = await suggestImportColumns({
      kindLabel: KIND_WORDS[kind],
      fields: KIND_FIELD_OPTIONS[kind].map((option) => ({ field: option.field, label: option.label })),
      columns,
      model: gate.model,
      onUsage: (usage) =>
        recordAskUsage({
          companyId: context.company.id,
          userId: context.id,
          model: gate.model,
          usage,
          outcome: "answered",
          feature: "ask",
        }),
    });
    return { ok: true, value: { matches } };
  } catch (err) {
    await markAskAllowanceFailure(spend.claim);
    console.error("[import] column suggestion failed", { companyId: context.company.id, kind }, err);
    return {
      ok: false,
      error: "The suggestion didn't come back. Pick those columns from the dropdowns — nothing was imported.",
    };
  }
}
