// What a crew installed, per schedule-of-values line, entered on the daily field
// report. Pure. A line takes a quantity only when it has a real unit to count in:
// a lump sum has none, and a labor line's work is already measured in hours.

export interface InstallLineInput {
  unit: string | null;
  quantity: number;
  costCategory?: string | null;
}

export function isInstallable(line: InstallLineInput): boolean {
  const unit = (line.unit ?? "").trim().toUpperCase();
  return line.quantity > 0 && unit !== "" && unit !== "LS" && unit !== "LUMP SUM" && line.costCategory !== "LABOR";
}

export type InstallLine = {
  id: string;
  description: string;
  unit: string;
  quantity: number;
  /** Every report's quantity for this line, this report's included. */
  installedToDate: number;
};

export type InstalledEntry = { lineItemId: string; quantity: number };

const FIELD_PREFIX = "installed:";

export const installedFieldName = (lineItemId: string) => `${FIELD_PREFIX}${lineItemId}`;

/** A form's boxes as entries. Undefined when the form had none, which leaves a
 * report's quantities alone rather than clearing them. */
export function installedFromForm(formData: FormData): { lineItemId: string; quantity: string }[] | undefined {
  const rows = [...formData.entries()]
    .filter(([key]) => key.startsWith(FIELD_PREFIX))
    .map(([key, value]) => ({ lineItemId: key.slice(FIELD_PREFIX.length), quantity: String(value).trim() }));
  return rows.length > 0 ? rows : undefined;
}

/** Undefined means the caller did not send any, so an older phone's edit changes
 * nothing. Blank or zero is no row. Null is a figure that cannot be read. */
export function parseInstalled(raw: unknown): InstalledEntry[] | undefined | null {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return null;
  const out = new Map<string, number>();
  for (const row of raw as { lineItemId?: unknown; quantity?: unknown }[]) {
    const text = String(row?.quantity ?? "").trim().replace(",", ".");
    if (text === "") continue;
    if (!/^\d+(\.\d+)?$/.test(text) || Number(text) >= 10_000_000 || typeof row?.lineItemId !== "string") return null;
    const quantity = Math.round(Number(text) * 100) / 100;
    if (quantity > 0) out.set(row.lineItemId, quantity);
  }
  return [...out].map(([lineItemId, quantity]) => ({ lineItemId, quantity }));
}

const plain = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** "1,200 of 10,000 SF to date", said the same on every surface. */
export const installedToDateText = (line: Pick<InstallLine, "installedToDate" | "quantity" | "unit">) =>
  `${plain(line.installedToDate)} of ${plain(line.quantity)} ${line.unit} to date`;

export const installedDayText = (rows: readonly { quantity: number; unit: string | null; description: string }[]) =>
  rows.map((row) => `${plain(row.quantity)} ${row.unit ?? ""} ${row.description}`.replace(/\s+/g, " ")).join(" · ");
