import Anthropic from "@anthropic-ai/sdk";
import { AI_CLIENT_OPTIONS, modelFor } from "./models";
import { reportUsage, type ModelUsageReporter } from "./anthropic";

/**
 * WHICH C STREAM FIELD AN UNRECOGNISED SPREADSHEET COLUMN PROBABLY IS — one
 * tool call, a proposal and nothing else.
 *
 * The second layer of the import mapper on /settings/import. The first layer
 * (apps/web/lib/import-smart-map.ts) is a synonym dictionary and runs with no
 * model at all; this only ever sees the columns that layer could not place,
 * their header text and at most five sample values each. Never the file.
 *
 * The model PROPOSES. The app shows each answer marked "AI guess" beside a
 * dropdown, and nothing is written until the person presses Import — the
 * same confirm every other import on that page goes through.
 *
 * Runs under the ASK feature (the assistant), for the reason replyClassify.ts
 * gives for AI_AGENTS: a new `AiFeature` enum member for one helper would be
 * a migration plus four censuses for no new switch anybody asked for.
 */

export const IMPORT_COLUMNS_TOOL_NAME = "map_columns";

export type ImportColumnInput = { index: number; header: string; samples: string[] };
export type ImportFieldInput = { field: string; label: string };

const SYSTEM_PROMPT = `You map spreadsheet columns from a construction subcontractor's old system (Sage 100 Contractor, Foundation, QuickBooks, Jobber, or a hand-made Excel sheet) onto the fields of the app they are moving to.

You are given the kind of records being imported, the fields the app accepts, and the columns nobody could match by name — each with its header and a few sample values (digits in samples are masked as #, so read their SHAPE).

For each column, pick the ONE field it holds, or no field if it holds none of them or you are not sure. Never give two columns the same field. A money column (contract value, amount, balance) is never a field here. Be strict: leaving a column unmatched costs the person one dropdown; a wrong match costs them a bad import.`;

/**
 * Ask the model. The caller has already passed `aiGate` and claimed the
 * allowance; `model` is what the gate resolved.
 */
export async function suggestImportColumns(params: {
  kindLabel: string;
  fields: ImportFieldInput[];
  columns: ImportColumnInput[];
  onUsage?: ModelUsageReporter;
  model?: string;
}): Promise<Record<number, string>> {
  const client = new Anthropic(AI_CLIENT_OPTIONS);
  const response = await client.messages.create({
    model: params.model ?? modelFor("ASK").model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: IMPORT_COLUMNS_TOOL_NAME,
        description: "Records which field each column holds. Leave a column out to leave it unmatched.",
        input_schema: {
          type: "object",
          properties: {
            matches: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  column: { type: "integer" },
                  field: { type: "string", enum: params.fields.map((one) => one.field) },
                },
                required: ["column", "field"],
                additionalProperties: false,
              },
            },
          },
          required: ["matches"],
          additionalProperties: false,
        },
      },
    ],
    tool_choice: { type: "tool", name: IMPORT_COLUMNS_TOOL_NAME },
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          importing: params.kindLabel,
          fields: params.fields,
          columns: params.columns,
        }),
      },
    ],
  });
  await reportUsage(params.onUsage, response.usage);
  return readImportColumnSuggestion(
    response.content,
    params.fields.map((one) => one.field),
    params.columns.map((one) => one.index),
  );
}

/**
 * Pure, so it is tested without the SDK. Keeps only answers naming a column
 * that was asked about and a field that exists, first answer per field wins —
 * a model that invents a field or reuses one cannot get it onto the screen.
 */
export function readImportColumnSuggestion(
  content: Anthropic.ContentBlock[],
  fields: string[],
  columns: number[],
): Record<number, string> {
  const block = content.find(
    (one): one is Anthropic.ToolUseBlock => one.type === "tool_use" && one.name === IMPORT_COLUMNS_TOOL_NAME,
  );
  if (!block) throw new Error("the model returned no column matches");
  const matches = (block.input as { matches?: unknown }).matches;
  const out: Record<number, string> = {};
  const taken = new Set<string>();
  for (const match of Array.isArray(matches) ? matches : []) {
    const { column, field } = (match ?? {}) as { column?: unknown; field?: unknown };
    if (typeof column !== "number" || typeof field !== "string") continue;
    if (!columns.includes(column) || !fields.includes(field)) continue;
    if (taken.has(field) || out[column] !== undefined) continue;
    taken.add(field);
    out[column] = field;
  }
  return out;
}
