import { itemQuantity, type ItemMeasurement, type ItemProperties } from "./itemQuantities";
import type { WallsSummaryRow } from "@/lib/plan-ingest/walls";
import { UNTYPED_ITEM } from "./untypedItem";
import { HELD_ITEM } from "./estimateHold";
import { ROOMS_ITEM } from "./roomItems";

/**
 * ── THE TAKEOFF AS ROWS, FOR SOMEBODY WHO ESTIMATES IN EXCEL ──
 *
 * One row per item, sheet and source, with the quantity in the unit the item
 * counts in. Pure: the browser builds the file from what this returns, and
 * nothing is stored. The sources say how far to trust a row: FOUND by the app,
 * TRACED by a person, a COUNT, ASSUMED (untyped walls priced as the default
 * partition), or TO CONFIRM (walls the model doubts, held off the estimate).
 */
export type ExportSource = "found" | "traced" | "count" | "assumed" | "to confirm" | "imported";
export type ExportRow = { item: string; sheet: string; quantity: number; unit: string; source: ExportSource; note: string };
export type ExportSheetRow = { sheet: string; status: string; why: string; wallFeet: number | null; rooms: number | null; existingWork: string };

export type ExportMeasurement = Omit<ItemMeasurement, "openings"> & {
  source: "MANUAL" | "DETECTED" | "IMPORTED" | "ROOM_FINDER";
  label: string | null;
  /** As stored: `[{ widthFt, heightFt, kind, mark }]`. */
  openingsJson: unknown;
};
export type ExportInput = {
  items: { name: string; properties: ItemProperties; measurements: ExportMeasurement[] }[];
  /** Sheet names by page number, as the sheet list shows them. */
  sheetOf: ReadonlyMap<number, string>;
  /** Finish takeoff lines per page, as Send to estimate reads them. */
  finish: { pageNumber: number; lines: { description: string; quantity: number; unit: string }[] }[];
  defaultPartition: string | null;
  summary: readonly WallsSummaryRow[];
};

const UNIT = { LINEAR: "lin ft", AREA: "sq ft", AREA_WITH_PERIMETER: "sq ft", COUNT: "ea", SEGMENT: "lin ft" } as const;
const round = (n: number) => Math.round(n * 100) / 100;

function sourceOf(item: string, m: ExportMeasurement, defaultPartition: string | null): ExportSource {
  if (item === HELD_ITEM) return "to confirm";
  if (item === UNTYPED_ITEM && defaultPartition !== null) return "assumed";
  if (m.kind === "COUNT") return "count";
  if (m.source === "MANUAL") return "traced";
  if (m.source === "IMPORTED") return "imported";
  return "found";
}

export function takeoffExport(input: ExportInput): { rows: ExportRow[]; sheets: ExportSheetRow[] } {
  const sheet = (page: number) => input.sheetOf.get(page) ?? `Sheet ${page}`;
  const rows: ExportRow[] = [];
  for (const item of input.items) {
    // Rooms are listed one by one, because a room is what a finish is priced against.
    if (item.name === ROOMS_ITEM) {
      for (const m of item.measurements) {
        const q = itemQuantity([m], { type: "AREA_WITH_PERIMETER", wastePercent: 0 });
        if (q.areaSqFt > 0) rows.push({ item: `Room: ${m.label ?? "unnamed"}`, sheet: sheet(m.pageNumber), quantity: round(q.areaSqFt), unit: "sq ft", source: m.source === "MANUAL" ? "traced" : "found", note: `${round(q.linearFt)} lin ft perimeter` });
      }
      continue;
    }
    const groups = new Map<string, ExportMeasurement[]>();
    for (const m of item.measurements) {
      const key = `${m.pageNumber}|${sourceOf(item.name, m, input.defaultPartition)}`;
      groups.set(key, [...(groups.get(key) ?? []), m]);
    }
    for (const [key, ms] of groups) {
      const [page, source] = key.split("|") as [string, ExportSource];
      const q = itemQuantity(ms, { ...item.properties, wastePercent: 0 });
      const unit = UNIT[item.properties.type];
      const quantity = unit === "ea" ? q.count : unit === "sq ft" ? q.areaSqFt : q.linearFt;
      if (!(quantity > 0)) continue;
      const note =
        source === "assumed" ? `priced as ${input.defaultPartition}, check the type`
        : item.name === UNTYPED_ITEM ? "no wall type, check"
        : item.properties.type === "AREA_WITH_PERIMETER" ? `${round(q.linearFt)} lin ft perimeter`
        : "";
      rows.push({ item: item.name, sheet: sheet(Number(page)), quantity: round(quantity), unit, source, note });
    }
  }
  // Doors and windows on the walls, by schedule mark where one was matched, by width where not.
  const openings = new Map<string, ExportRow>();
  for (const item of input.items) {
    for (const m of item.measurements) {
      for (const o of Array.isArray(m.openingsJson) ? (m.openingsJson as { kind?: string; mark?: string | null; widthFt?: number }[]) : []) {
        const kind = o.kind === "window" ? "Window" : "Door";
        // To the inch: the drawn leaf reads 2.98 or 3.01 ft for one 3'-0" door.
        const inches = Math.round((Number(o.widthFt) || 0) * 12);
        const name = o.mark ? `${kind} ${o.mark}` : `${kind} ${Math.floor(inches / 12)}'-${inches % 12}", no mark`;
        const key = `${m.pageNumber}|${name}`;
        const row = openings.get(key) ?? { item: name, sheet: sheet(m.pageNumber), quantity: 0, unit: "ea", source: "found" as const, note: "" };
        row.quantity += 1;
        openings.set(key, row);
      }
    }
  }
  rows.push(...[...openings.values()].sort((a, b) => a.sheet.localeCompare(b.sheet) || a.item.localeCompare(b.item)));
  for (const f of input.finish) for (const l of f.lines) rows.push({ item: l.description, sheet: sheet(f.pageNumber), quantity: round(l.quantity), unit: l.unit, source: "found", note: "finish schedule" });

  const sheets: ExportSheetRow[] = input.summary.map((r) => ({
    sheet: r.label,
    status: r.status.kind === "walls" ? (r.status.notCounted === undefined ? "counted" : "not counted") : r.status.kind === "skipped" ? "skipped" : r.status.kind === "looked" ? "looked, nothing kept" : r.status.kind,
    why: r.status.kind === "skipped" ? r.status.why : r.status.kind === "walls" ? (r.status.notCounted ?? "") : r.status.kind === "looked" ? r.status.note : r.status.kind === "failed" ? r.status.error : "",
    wallFeet: r.status.kind === "walls" ? Math.round(r.status.feet) : null,
    rooms: r.status.kind === "walls" ? (r.status.rooms ?? null) : null,
    existingWork: r.renovation?.join(", ") ?? "",
  }));
  return { rows, sheets };
}

const HEAD = ["Item", "Sheet", "Quantity", "Unit", "Source", "Note"];
const cell = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The rows as CSV, one header line, quoted where a value needs it. */
export function exportCsv(rows: readonly ExportRow[]): string {
  return [HEAD, ...rows.map((r) => [r.item, r.sheet, r.quantity, r.unit, r.source, r.note])].map((line) => line.map(cell).join(",")).join("\n") + "\n";
}

/** The two tabs as arrays of rows, for the spreadsheet. */
export function exportTabs(result: { rows: readonly ExportRow[]; sheets: readonly ExportSheetRow[] }): { name: string; rows: (string | number | null)[][] }[] {
  return [
    { name: "Quantities", rows: [HEAD, ...result.rows.map((r) => [r.item, r.sheet, r.quantity, r.unit, r.source, r.note])] },
    { name: "Sheets", rows: [["Sheet", "Status", "Why", "Wall ft", "Rooms", "Shows existing work"], ...result.sheets.map((s) => [s.sheet, s.status, s.why, s.wallFeet, s.rooms, s.existingWork])] },
  ];
}
