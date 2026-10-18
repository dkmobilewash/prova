import type { FringeRateScheduleInput, TimeEntryPayType } from "@/lib/labor-cost";
import type { Wh347RegisterMoney, Wh347TimeEntryInput } from "@/lib/wh347";
import { utcDay } from "./panelChrome";

/**
 * THE ILLUSTRATIVE CREW — three invented workers, one invented Carpenters
 * local, one week in August — shared by the landing page's WH-347 panel and
 * the sales team's sample report (`lib/sample-wh347.ts`). It lived inside
 * `CertifiedPayrollPanel.tsx` first; it moved here the day a second caller
 * needed the same crew with a different contractor name, so that the crew is
 * one object rather than two that drift. Nothing in it is a real person, a
 * real rate or a real determination, and every consumer stamps it as such.
 */

const WEEK_START_ISO = "2026-08-23"; // a Sunday; the form runs Sunday through Saturday
const EFFECTIVE_FROM = utcDay("2026-07-01");

function schedule(baseWage: number, pension: number, vacation: number, hw: number, training: number): FringeRateScheduleInput[] {
  return [
    {
      baseWage,
      pensionRate: pension,
      vacationRate: vacation,
      healthWelfareRate: hw,
      trainingRate: training,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
    },
  ];
}

/** Craft classifications, labelled the way the filing page labels them:
 * `${parentInternational} ${localNumber} — ${name}`. The local is made up. */
const CRAFTS = {
  journeyman: { id: "jm", label: "Carpenters 1180 — Journeyman Carpenter", schedule: schedule(46.1, 9.85, 3.9, 11.2, 0.8) },
  foreman: { id: "fm", label: "Carpenters 1180 — Carpenter Foreman", schedule: schedule(49.1, 9.85, 3.9, 11.2, 0.8) },
  apprentice3: {
    id: "ap3",
    label: "Carpenters 1180 — Carpenter Apprentice, 3rd period",
    schedule: schedule(27.66, 5.91, 2.34, 11.2, 0.8),
  },
} as const;

type Craft = (typeof CRAFTS)[keyof typeof CRAFTS];

/** [day index Sunday=0, hours, pay type] */
type Shift = [number, number, TimeEntryPayType];

export type SampleWorker = {
  id: string;
  name: string;
  /** Column 1 prints "…" plus the recorded last four, per `printedIdentifyingNumber`. */
  last4: string;
  craft: Craft;
  shifts: Shift[];
  register: Wh347RegisterMoney;
};

const WEEKDAYS: Shift[] = [1, 2, 3, 4, 5].map((day) => [day, 8, "STRAIGHT"]);

const WORKERS: SampleWorker[] = [
  {
    id: "alvarez",
    name: "Ramón Alvarez",
    last4: "4417",
    craft: CRAFTS.journeyman,
    shifts: [...WEEKDAYS, [3, 2, "OVERTIME"], [5, 3, "OVERTIME"]],
    register: { deductions: { fica: 167.52, withholdingTax: 444.88, other: null, total: 612.4 }, netWages: 1577.35 },
  },
  {
    id: "okafor",
    name: "Dana Okafor",
    last4: "8130",
    craft: CRAFTS.apprentice3,
    shifts: WEEKDAYS,
    register: { deductions: { fica: 84.64, withholdingTax: 174.26, other: null, total: 258.9 }, netWages: 847.5 },
  },
  {
    id: "mendoza",
    name: "Luis Mendoza",
    last4: "2291",
    craft: CRAFTS.foreman,
    shifts: [...WEEKDAYS, [4, 2, "OVERTIME"]],
    register: { deductions: { fica: 161.51, withholdingTax: 428.59, other: null, total: 590.1 }, netWages: 1521.2 },
  },
];

export const SAMPLE_CREW = { crafts: CRAFTS, workers: WORKERS } as const;

export function sampleWeekStart(): Date {
  return utcDay(WEEK_START_ISO);
}

/** One time entry per shift, dated into the sample week. */
export function sampleEntries(): Wh347TimeEntryInput[] {
  const weekStart = sampleWeekStart();
  return WORKERS.flatMap((worker) =>
    worker.shifts.map(([day, hours, payType]) => {
      const date = new Date(weekStart);
      date.setUTCDate(date.getUTCDate() + day);
      return {
        employeeUserId: worker.id,
        employee: { name: worker.name, email: "" },
        craftClassificationId: worker.craft.id,
        craftLabel: worker.craft.label,
        date,
        hours,
        payType,
      };
    }),
  );
}
