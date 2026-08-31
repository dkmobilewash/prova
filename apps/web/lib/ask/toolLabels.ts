import type { ToolName } from "./tools";

/** What to say while a tool is running.
 *
 * A person waiting eight seconds wants to know it is working, not which
 * function it called. "Checking your invoices" is the honest short form of
 * `receivables`; the tool name itself means nothing to a drywall
 * contractor.
 */
const LABELS: Record<ToolName, string> = {
  crew_assignments: "your crews",
  open_punch_list: "the punch list",
  compliance_status: "certificates and licences",
  drawing_currency: "your drawings",
  job_margin: "job costs",
  bid_status: "your bids",
  open_rfis: "open RFIs",
  material_deliveries: "material orders",
  equipment_location: "equipment",
  receivables: "your invoices",
};

export function toolLabel(name: ToolName): string {
  return LABELS[name] ?? "your records";
}

/** "Checking your invoices and the punch list" — an Oxford-less list,
 * because it is read at a glance and not parsed. */
export function readingLabel(names: ToolName[]): string {
  const labels = [...new Set(names.map(toolLabel))];
  if (labels.length === 0) return "Reading your records…";
  if (labels.length === 1) return `Checking ${labels[0]}…`;
  const last = labels[labels.length - 1];
  return `Checking ${labels.slice(0, -1).join(", ")} and ${last}…`;
}
