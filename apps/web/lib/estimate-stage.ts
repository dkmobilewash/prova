/**
 * Where an estimate has got to, and therefore what has to happen next.
 *
 * Every job starts as an estimate — ESTIMATE is the first value of JobStatus,
 * not a separate kind of record — so "which of my estimates is stuck, and on
 * what" is a question about jobs, answered here and rendered on the jobs list.
 *
 * Derived on every render from the line items and signature requests that
 * already exist. Storing a stage would be a second source of truth that
 * disagrees with the job the moment someone adds a line item or the client
 * signs — the same rule the rest of the app follows for overdue, recordable
 * and current-revision.
 */

export type EstimateStageKey = "NEEDS_PRICING" | "READY_TO_SEND" | "OUT_FOR_SIGNATURE" | "SIGNED";

export type EstimateStage = {
  key: EstimateStageKey;
  label: string;
  /** What the user does next. Written as an instruction, not a status. */
  detail: string;
};

const STAGES: Record<EstimateStageKey, EstimateStage> = {
  NEEDS_PRICING: {
    key: "NEEDS_PRICING",
    label: "Needs pricing",
    detail: "No line items yet — price it up, or draft them from the scope text.",
  },
  READY_TO_SEND: {
    key: "READY_TO_SEND",
    label: "Ready to send",
    detail: "Priced, but no signature request yet — send it to the client.",
  },
  OUT_FOR_SIGNATURE: {
    key: "OUT_FOR_SIGNATURE",
    label: "Out for signature",
    detail: "Waiting on the client. Nothing to do here until they sign.",
  },
  SIGNED: {
    key: "SIGNED",
    label: "Signed",
    detail: "The client has signed. Mark it contracted to lock the estimate in.",
  },
};

/**
 * Order matters. SIGNED is checked before OUT_FOR_SIGNATURE because a job can
 * hold both a signed request and an older pending one — a second request
 * generated before the first was signed, say. Once anything is signed the job
 * is ready to contract, and reporting it as still waiting would send the user
 * to chase a client who has already signed.
 */
export function estimateStage(lineItemCount: number, signatureStatuses: string[]): EstimateStage {
  if (lineItemCount === 0) return STAGES.NEEDS_PRICING;
  if (signatureStatuses.includes("SIGNED")) return STAGES.SIGNED;
  if (signatureStatuses.includes("PENDING")) return STAGES.OUT_FOR_SIGNATURE;
  return STAGES.READY_TO_SEND;
}
