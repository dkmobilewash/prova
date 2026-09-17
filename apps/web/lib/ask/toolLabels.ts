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
  cash_flow_forecast: "what is coming in",
  retainage_held: "retainage",
  change_order_status: "change orders",
  job_labor_cost: "labor cost",
  safety_record: "your safety log",
  open_submittals: "open submittals",
  certification_expiry: "certifications",
  apprentice_ratio: "the apprentice ratio",
  closeout_status: "closeout",
  fringe_remittance: "what you owe the funds",
  backcharge_exposure: "backcharges",
  apprenticeship_standing: "your apprentices",
  daily_field_reports: "the field reports",
  wage_determinations: "wage determinations",
  job_photos: "site photos",
  vendor_pricing: "vendor prices",
  gc_relationship: "your GCs",
  pay_application_status: "your pay applications",
  warranty_obligations: "warranty",
  outbound_messages: "what you have sent",
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
