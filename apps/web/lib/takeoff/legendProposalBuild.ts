import { WALL_LEGEND_PROMPT_VERSION, type WallLegendRead } from "@prova/integrations/src/wallLegend";
import type { CropRect } from "./legendSight";
import { storedLegendTypes } from "./legendProposal";

/**
 * The columns of a `PlanLegendProposal` from a text read: the read itself, the
 * merged view with no sight read yet, and the crops. Pure, so the stage's
 * save can be tested without a database and the JSON written is the JSON the
 * screen reads back.
 */
export function legendProposalFrom(row: {
  pageNumber: number;
  sheetTitle: string | null;
  model: string;
  read: WallLegendRead;
  crops: CropRect[];
}) {
  const where = row.sheetTitle ? `${row.sheetTitle} (page ${row.pageNumber})` : `page ${row.pageNumber}`;
  return {
    sheetTitle: row.sheetTitle,
    textRead: JSON.parse(JSON.stringify(row.read)),
    merged: JSON.parse(JSON.stringify(storedLegendTypes(row.read, null, where))),
    crops: JSON.parse(JSON.stringify(row.crops)),
    reason: row.read.reason,
    confidence: row.read.confidence,
    model: row.model,
    promptVersion: WALL_LEGEND_PROMPT_VERSION,
  };
}
