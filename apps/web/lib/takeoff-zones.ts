import { readScale, type ScaleReading, type StoredCalibration } from "@/lib/takeoff-plan";

/**
 * ONE SHEET, TWO SCALES — which the schema has always allowed and nothing ever
 * said out loud.
 *
 * `TakeoffPlanPage.calibrations` is plural, and `saveScaleCalibration`
 * (`lib/actions/takeoff.ts`) ends in `takeoffScaleCalibration.create` rather
 * than an upsert — so setting the scale twice on one page leaves TWO rows, not
 * one replaced row. Every `TakeoffMeasurement` already carries the
 * `calibrationId` it was measured against, so the data has been correct the
 * whole time. The estimator was simply never told.
 *
 * THIS IS THE CASE THAT MATTERS, and it is the audit's own words — "identify
 * multi-scale sheets and flag zones with varying scales":
 *
 *   A-301 carries the building section at 1/8" and a head-of-wall detail at
 *   1-1/2". Calibrate once on the section, trace the partitions, then
 *   calibrate on the detail to measure the deflection track. Both
 *   calibrations are right. Every quantity is right. But the page now means
 *   two different things, and a measurement traced after the second
 *   calibration against the FIRST one's geometry is off by a factor of twelve
 *   with nothing on screen to say so.
 *
 * ── WHY IT IS A SIBLING OF `calibrationNotices` AND NOT A BRANCH INSIDE IT ──
 *
 * That function judges ONE calibration as it is being drawn — its arguments
 * are a single line, a page width and a printed scale, and `calibrationRefusal`
 * reads its output to decide whether a save is allowed. This reasons over the
 * SET of calibrations a page has already accumulated, which is a different
 * question asked at a different time, and it must never refuse: two scales on
 * one sheet is ordinary draughting, not a mistake. Folding it in would have
 * meant either giving `calibrationNotices` a fourth argument it does not need
 * for its own job, or risking a `warn` becoming a refusal the day somebody
 * widens what `calibrationRefusal` matches.
 *
 * Nothing here is stored. Derived state is never stored (CLAUDE.md), and this
 * is two stored numbers divided, twice, then compared.
 */

/** A calibration with its identity, which the set-level question needs and the
 *  single-calibration one does not. */
export type IdentifiedCalibration = StoredCalibration & { id: string };

export type ZoneScale = {
  calibrationId: string;
  /** What this calibration says the sheet is. Null when the page width is
   *  unknown, which is the one case that cannot be compared. */
  reading: ScaleReading | null;
};

/**
 * HOW FAR APART TWO SCALES MUST BE TO COUNT AS DIFFERENT.
 *
 * Deliberately NOT `SCALE_TOLERANCE` (2%), which answers a different question:
 * that one asks whether a reading is close enough to a STANDARD scale to carry
 * its name. This asks whether two readings are the same scale drawn twice.
 *
 * Two hand-drawn calibration lines along the same dimension never divide to
 * exactly the same number — the estimator clicks within a pixel or two of the
 * same endpoints — so a strict comparison would call every re-calibration a
 * multi-scale sheet, which is the cry-wolf failure. 10% is wide enough to
 * absorb that and far narrower than the gap between adjacent standard scales:
 * 1/8" and 3/16" differ by 33%, and the two scales this feature exists for —
 * 1/8" and 1-1/2" — differ by a factor of twelve.
 */
export const SAME_SCALE_TOLERANCE = 0.1;

/** Both readings present and within tolerance of each other. */
function sameScale(a: ScaleReading, b: ScaleReading): boolean {
  const larger = Math.max(a.feetPerInch, b.feetPerInch);
  if (!(larger > 0)) return false;
  return Math.abs(a.feetPerInch - b.feetPerInch) / larger <= SAME_SCALE_TOLERANCE;
}

/** How a scale is named to a person: its standard name when it has one, else
 *  the reading, which is what `calibrationNotices` already says on screen. */
export function scaleLabel(reading: ScaleReading | null): string {
  if (reading === null) return "an unknown scale";
  if (reading.name !== null) return reading.name;
  return `1 in = ${Math.round(reading.feetPerInch * 100) / 100} ft`;
}

export function zoneScales(
  calibrations: readonly IdentifiedCalibration[],
  pageWidthPt: number | null,
): ZoneScale[] {
  return calibrations.map((calibration) => ({
    calibrationId: calibration.id,
    reading: readScale(calibration, pageWidthPt),
  }));
}

export type ZoneNotice = {
  /** Always "warn". There is no refusal here and there must not be one: a
   *  detail at its own scale beside a plan is how drawings are drawn. */
  level: "warn";
  message: string;
};

/**
 * What to say about a page that carries more than one scale.
 *
 * Returns an EMPTY ARRAY for the ordinary page — one calibration, or several
 * that agree — and that silence is the feature as much as the sentence is.
 * `bid-responsiveness.ts`'s rule: a panel that speaks when nothing is wrong
 * teaches people to stop reading it.
 */
export function zoneNotices(zones: readonly ZoneScale[]): ZoneNotice[] {
  if (zones.length < 2) return [];

  const readable = zones.filter((zone): zone is ZoneScale & { reading: ScaleReading } => zone.reading !== null);
  // Fewer than two readable scales cannot disagree. A page whose width is
  // unknown reads null for EVERY calibration, so this is the whole-page case
  // rather than a partial one.
  if (readable.length < 2) return [];

  // DISTINCT SCALES, not pairwise comparisons: three calibrations at the same
  // scale are one scale drawn three times, and reporting three disagreements
  // would be arithmetic rather than information.
  const distinct: (ZoneScale & { reading: ScaleReading })[] = [];
  for (const zone of readable) {
    if (!distinct.some((seen) => sameScale(seen.reading, zone.reading))) distinct.push(zone);
  }
  if (distinct.length < 2) return [];

  const names = distinct.map((zone) => scaleLabel(zone.reading));
  return [
    {
      level: "warn",
      message:
        `This sheet is calibrated at ${distinct.length} different scales — ${names.join(" and ")}. ` +
        `That is normal where a detail sits beside a plan. Each measurement is priced at the scale it ` +
        `was traced against, so check that every one was traced against the right zone.`,
    },
  ];
}

/**
 * Which scale a single measurement was traced against, for the row that shows
 * it.
 *
 * ONLY WORTH SHOWING WHEN THE PAGE IS MULTI-SCALE, which is why this takes the
 * notices rather than deciding for itself: on an ordinary page the scale is a
 * property of the sheet and repeating it on every row is noise. The caller
 * passes what `zoneNotices` returned, so one decision governs both.
 */
export function measurementScaleLabel(
  calibrationId: string,
  zones: readonly ZoneScale[],
  notices: readonly ZoneNotice[],
): string | null {
  if (notices.length === 0) return null;
  const zone = zones.find((candidate) => candidate.calibrationId === calibrationId);
  if (zone === undefined) return null;
  return scaleLabel(zone.reading);
}
