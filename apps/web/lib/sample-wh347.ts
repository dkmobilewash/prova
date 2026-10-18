/**
 * A SAMPLE WH-347 FOR A FIRM THAT IS NOT A CUSTOMER YET.
 *
 * The calling playbook's one differentiator with no data behind it is "show,
 * don't tell": send the prospect a certified payroll report that already has
 * THEIR name on it, built the way the product builds a real one, before they
 * have given us anything. This is that artifact. It is `buildWh347` — the
 * same function the filing page uses, grouped by day, overtime on its own
 * row, cash wages derived from base × multiplier with fringe shown beside —
 * fed an ILLUSTRATIVE crew.
 *
 * ── WHAT IS REAL AND WHAT IS NOT, STATED SO THE PAGE CAN SAY IT ──
 *
 * Real: the contractor name, the project name where a public listing gave us
 * one, and the form's arithmetic. Illustrative: the three workers, their
 * hours, the identifying numbers, the deductions, and the wage and fringe
 * rates — which are the landing page's made-up Carpenters local, not a DIR
 * determination. The app holds no prevailing-wage dataset
 * (`lib/prevailing-wage.ts` says so in its header), so the honest version is
 * a sample stamped as one, not a number that looks sourced and is not.
 *
 * Every rendering of this form carries the SAMPLE stamp and `fileable` is
 * never true for it — `statementComplete` is left at its default, so page 2
 * blocks it by construction, which is the right answer for a document that
 * must never be mistaken for a filing. A prospect who sends a week of real
 * timecards gets the real thing through the real page.
 *
 * The crew lives in `components/landing/CertifiedPayrollPanel.tsx`, which
 * built it first for the marketing sheet; this module parameterises what
 * that panel hard-codes so one crew serves both.
 */

import { buildWh347, type Wh347Form } from "@/lib/wh347";
import { SAMPLE_CREW, sampleEntries, sampleWeekStart } from "@/components/landing/sampleCrew";

export type SampleWh347Input = {
  contractorName: string;
  /** The address the sample prints, as much of it as is known. */
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  /** The project the firm was listed on, when a public document gave one. */
  projectName?: string | null;
  /** The marketing sheet prints a mid-year number; a prospect's sample is payroll no. 1. */
  payrollNumber?: number;
};

export const SAMPLE_PROJECT_FALLBACK = "A California public works project";

export function buildSampleWh347(input: SampleWh347Input): Wh347Form {
  return buildWh347({
    company: {
      name: input.contractorName,
      dbaName: null,
      hqAddressLine1: input.addressLine1 ?? null,
      hqAddressLine2: null,
      hqCity: input.city ?? null,
      hqState: input.state ?? (input.city ? "CA" : null),
      hqZip: input.zip ?? null,
    },
    job: { name: input.projectName?.trim() || SAMPLE_PROJECT_FALLBACK },
    weekStart: sampleWeekStart(),
    entries: sampleEntries(),
    fringeSchedulesByCraft: new Map(Object.values(SAMPLE_CREW.crafts).map((craft) => [craft.id, craft.schedule])),
    payrollNumber: input.payrollNumber ?? 1,
    identifyingNumbers: new Map(SAMPLE_CREW.workers.map((worker) => [worker.id, `…${worker.last4}`])),
    registerMoney: new Map(SAMPLE_CREW.workers.map((worker) => [worker.id, worker.register])),
  });
}
