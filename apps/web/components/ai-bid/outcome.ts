import type { RecordBidOutcomeInput } from "@/lib/actions/bidOutcomes";
import { isBlank, parseNumericInput } from "@/lib/numeric-input";

/** Plain words for the stored reason. Exported so a recorded outcome reads
 * the same wherever it is shown. */
export const OUTCOME_REASONS = [
  { value: "PRICE", label: "Price" },
  { value: "RELATIONSHIP", label: "Relationship with the GC" },
  { value: "SCOPE", label: "Scope" },
  { value: "SCHEDULE", label: "Schedule" },
  { value: "QUALIFICATIONS", label: "Qualifications" },
  { value: "OTHER", label: "Something else" },
] as const;

export function outcomeReasonLabel(value: string): string {
  return OUTCOME_REASONS.find((r) => r.value === value)?.label ?? value;
}

type Result = "WON" | "LOST";
export type OutcomeErrors = Partial<Record<"result" | "reason" | "winningPrice" | "form", string>>;

/** Turns the form into the action's input, or the sentences that stop it.
 * A plain module, not the "use client" form, so server pages and tests get
 * the value rather than a client-reference proxy (client-boundary.test.ts). */
export function readOutcomeForm(formData: FormData):
  | { ok: true; input: RecordBidOutcomeInput }
  | { ok: false; errors: OutcomeErrors } {
  const errors: OutcomeErrors = {};
  const result = formData.get("result");
  const reason = formData.get("reason");
  if (result !== "WON" && result !== "LOST") errors.result = "Pick won or lost.";
  if (!OUTCOME_REASONS.some((r) => r.value === reason)) errors.reason = "Pick the main reason.";
  let winningPrice: number | undefined;
  const rawPrice = formData.get("winningPrice");
  if (!isBlank(rawPrice)) {
    const parsed = parseNumericInput(rawPrice, { label: "Winning price", min: 0, maxDecimals: 2 });
    if (parsed.ok) winningPrice = parsed.n;
    else errors.winningPrice = parsed.error;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const text = (key: string) => {
    const value = String(formData.get(key) ?? "").trim();
    return value === "" ? undefined : value;
  };
  return {
    ok: true,
    input: {
      bidInvitationId: String(formData.get("bidInvitationId")),
      result: result as Result,
      reason: reason as (typeof OUTCOME_REASONS)[number]["value"],
      winningPrice,
      winnerName: text("winnerName"),
      note: text("note"),
      decidedOn: text("decidedOn"),
    },
  };
}
