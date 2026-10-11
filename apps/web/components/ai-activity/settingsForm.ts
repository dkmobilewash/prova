import type { AgentSettings } from "@/lib/agents/core";
import { isBlank, parseNumericInput } from "@/lib/numeric-input";

export type SettingsErrors = Partial<Record<"dueSoonDays" | "monthlySpendCapUsd" | "form", string>>;

/** The form into a settings patch, or the sentences that stop it. Plain module
 * so the test gets the value, not a client-reference proxy. */
export function readSettingsForm(formData: FormData): { ok: true; input: Partial<AgentSettings> } | { ok: false; errors: SettingsErrors } {
  const errors: SettingsErrors = {};
  const days = parseNumericInput(formData.get("dueSoonDays"), { label: "Days before due", min: 1, max: 30, integer: true });
  if (!days.ok) errors.dueSoonDays = days.error;
  let cap: number | null = null;
  const rawCap = formData.get("monthlySpendCapUsd");
  if (!isBlank(rawCap)) {
    const parsed = parseNumericInput(rawCap, { label: "Monthly cap", min: 0, maxDecimals: 2 });
    if (parsed.ok) cap = parsed.n;
    else errors.monthlySpendCapUsd = parsed.error;
  }
  if (Object.keys(errors).length > 0 || !days.ok) return { ok: false, errors };
  return {
    ok: true,
    input: {
      watcherEnabled: formData.get("watcherEnabled") === "on",
      researchOnNewBid: formData.get("researchOnNewBid") === "on",
      checkerBeforeSend: formData.get("checkerBeforeSend") === "on",
      recommendationsEnabled: formData.get("recommendationsEnabled") === "on",
      dueSoonDays: days.n,
      monthlySpendCapUsd: cap,
      notifyUserIds: formData.getAll("notifyUserIds").map(String),
    },
  };
}
