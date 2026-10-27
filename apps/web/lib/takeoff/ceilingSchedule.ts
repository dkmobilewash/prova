import type { TableRow } from "../plan-ingest/scheduleTable";
import { familyOf, type CeilingFamily } from "./ceilingTags";

/**
 * ── A ROOM FINISH SCHEDULE'S CEILING COLUMNS ──
 *
 * Some sets say the ceiling in a TABLE rather than on the RCP: Bunkie's
 * room finish schedule has `Rm # | Name | Wall Finish | Ceiling Finish |
 * … | Ceiling Ht.`, O'Reillys has no RCP at all. The rows come from the
 * second session's `tableRowsFromPage` (`lib/plan-ingest/scheduleTable.ts`),
 * which recovers rows and cells from position and knows nothing about
 * schedules — that split is deliberate there and kept here: this file only
 * says which column is the room, which the ceiling, which the height.
 *
 * A row whose first cell is not a room number is a wrapped name or a note
 * and is skipped, so a two-line room name loses its second line and nothing
 * else.
 */
export type ScheduleCeiling = {
  number: string;
  name: string | null;
  /** The ceiling column's words as printed — `GYP.BD.`, `EXPOSED`, `C-1`. */
  finish: string | null;
  family: CeilingFamily | null;
  heightFeet: number | null;
  /** Points from the top, from the table row, for finding it on the sheet. */
  y: number;
};

const ROOM_NUMBER = /^(?=.*\d)[A-Z]{0,2}\d{1,4}[A-Z]?(?:\.\d)?$/;
const HEIGHT = /(\d{1,2})'\s*-?\s*(\d{1,2})?\s*"?/;

function columnsOf(header: readonly string[]): { number: number; name: number; finish: number; height: number } | null {
  const at = (re: RegExp) => header.findIndex((c) => re.test(c));
  const finish = at(/^CEILING(?:\s+(?:FINISH|TYPE|MAT(?:ERIAL)?|FIN\.?))?\.?$|^CLG\.?(?:\s+FIN(?:ISH)?)?\.?$/i);
  if (finish < 0) return null;
  const height = at(/CEILING\s+H(?:T|GT|EIGHT)|CLG\.?\s+H(?:T|GT|EIGHT)|^HEIGHT$|^HT\.?$/i);
  const number = at(/^(?:RM\.?\s*#?|ROOM\s*(?:NO\.?|#|NUMBER)?|NO\.?|#|MARK)$/i);
  const name = at(/^(?:NAME|ROOM\s+NAME|ROOM\s+OR\s+SPACE|SPACE)$/i);
  return { number: number < 0 ? 0 : number, name, finish, height };
}

/** The ceiling rows of a finish schedule, from the table reader's rows. */
export function ceilingsFromScheduleRows(rows: readonly TableRow[]): ScheduleCeiling[] {
  const out: ScheduleCeiling[] = [];
  let cols: ReturnType<typeof columnsOf> = null;
  for (const row of rows) {
    const header = columnsOf(row.cells);
    if (header !== null && row.cells.length >= 4) {
      cols = header;
      continue;
    }
    if (cols === null) continue;
    const number = row.cells[cols.number]?.trim() ?? "";
    if (!ROOM_NUMBER.test(number)) continue;
    const finish = row.cells[cols.finish]?.trim() || null;
    const heightCell = cols.height >= 0 ? row.cells[cols.height] : undefined;
    const hm = heightCell === undefined ? null : HEIGHT.exec(heightCell);
    const heightFeet = hm === null ? null : Number(hm[1]) + (hm[2] === undefined ? 0 : Number(hm[2])) / 12;
    const family = finish === null || /^(?:-|N\/A|VARIES)$/i.test(finish) ? null : familyOf(finish) === "OTHER" && !/EXPOSED|OPEN/i.test(finish) ? null : familyOf(finish);
    out.push({ number, name: cols.name >= 0 ? (row.cells[cols.name]?.trim() ?? null) : null, finish, family, heightFeet, y: row.y });
  }
  return out;
}
