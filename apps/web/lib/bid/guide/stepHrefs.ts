import type { GuideStep, GuideStepKey } from "./types";

/**
 * Where a rail step goes. Plain template literals under `/bid/estimates/…` so
 * `bidLinkCensus` can READ each target.
 *
 *   invite   → takeoff   (the drawing set arrives and is read there)
 *   walls    → takeoff
 *   price    → estimate  (the recap stays one tab away, in the secondary row)
 *   proposal → proposal
 *   send     → proposal  (a proposal is sent by printing / saving it)
 *
 * A step still TO DO has no link: a person is not sent to a screen that has
 * nothing for them yet. Only done and current steps navigate.
 */
export function guideStepHref(jobId: string, key: GuideStepKey): string {
  switch (key) {
    case "invite":
    case "walls":
      return `/bid/estimates/${jobId}/takeoff`;
    case "price":
      return `/bid/estimates/${jobId}/estimate`;
    case "proposal":
    case "send":
      return `/bid/estimates/${jobId}/proposal`;
  }
}

export function guideStepLink(jobId: string, step: GuideStep): string | null {
  return step.status === "todo" ? null : guideStepHref(jobId, step.key);
}
