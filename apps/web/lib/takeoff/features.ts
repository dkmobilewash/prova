import { AI_FEATURE_LABEL } from "@/lib/ai/features";

/**
 * ── EVERY TAKEOFF SWITCH IN ONE LIST, WITH WHAT IT IS AND WHERE IT STANDS ──
 *
 * The pilot's first finding (PILOT.md): the takeoff switches live in two
 * places, one of them is an AI feature that needs a second switch first, and
 * somebody looking for them all in one list concludes one is missing. This
 * is that list. It changes nothing about where each switch lives — every
 * row says where — it only reads them together and says, in a sentence, what
 * each one does and whether it is on, off, or waiting on something named.
 *
 * Pure: the page reads the rows' inputs, this turns them into rows, the
 * tests read the rows.
 */

export type TakeoffFeatureKey = "wallTypesFromDrawings" | "roomsAndCeilings" | "greyOut" | "wholeSet" | "scannedPlans" | "doorsWindows" | "symbolCount";

export type TakeoffFeatureStatus =
  /** On, and nothing else is needed. */
  | { kind: "on" }
  /** Off by the company's own switch. */
  | { kind: "off" }
  /** The switch is on but something it depends on is not, each named. */
  | { kind: "needs"; needs: string[] }
  /** The switch does not exist on this build yet. */
  | { kind: "not-yet" };

export type TakeoffFeatureRow = {
  key: TakeoffFeatureKey;
  title: string;
  /** One sentence, plain, for the person who did not build it. */
  explain: string;
  status: TakeoffFeatureStatus;
  /** Where the switch itself lives today, as a link and its label. */
  where: { href: string; label: string };
  /** The form field the row's own on/off button posts, when the switch exists here. */
  field: string | null;
};

export type TakeoffFeatureInputs = {
  roomFinderOn: boolean;
  demotedWallsOn: boolean;
  ai: { aiEnabled: boolean; planTextReadOptedIn: boolean };
  /** Whether the server has a model key at all — the Assistant page's Check connection answers the rest. */
  anthropicConfigured: boolean;
  /** Switches that arrive with their own releases; null until they exist on this build. */
  wholeSetTakeoffOn?: boolean | null;
  scannedPlansOn?: boolean | null;
  doorsWindowsOn?: boolean | null;
  symbolCountOn?: boolean | null;
};

export const NEEDS_AI_ON = "Company AI must be on (Settings → Assistant)";
export const NEEDS_MODEL_KEY = "The server has no model key — press Check connection on the Assistant page, and tell C Stream if it fails";

export function wallTypesStatus(input: Pick<TakeoffFeatureInputs, "ai" | "anthropicConfigured">): TakeoffFeatureStatus {
  const { aiEnabled, planTextReadOptedIn } = input.ai;
  // The feature's own tick is the switch; AI and the key are what it needs.
  // Unticked is Off whatever AI says — the pilot's confusion runs the other
  // way (ticked, AI off), and that is the "needs" case.
  if (!planTextReadOptedIn) return { kind: "off" };
  const needs: string[] = [];
  if (!aiEnabled) needs.push(NEEDS_AI_ON);
  if (!input.anthropicConfigured) needs.push(NEEDS_MODEL_KEY);
  return needs.length === 0 ? { kind: "on" } : { kind: "needs", needs };
}

const onOff = (on: boolean | null | undefined): TakeoffFeatureStatus => (on == null ? { kind: "not-yet" } : on ? { kind: "on" } : { kind: "off" });

export function takeoffFeatureRows(input: TakeoffFeatureInputs): TakeoffFeatureRow[] {
  return [
    {
      key: "wallTypesFromDrawings",
      title: AI_FEATURE_LABEL.PLAN_TEXT_READ,
      explain:
        "Reads the partition legend off the drawings and proposes each wall type for your library, so found walls can be named and priced. Uses the model, so company AI has to be on.",
      status: wallTypesStatus(input),
      where: { href: "/settings/assistant#ai-switch", label: "Settings → Assistant" },
      field: "wallTypesFromDrawings",
    },
    {
      key: "roomsAndCeilings",
      title: "Find the rooms and their ceilings",
      explain:
        "After the walls are found on a sheet, outlines each room they enclose, reads its name, number and ceiling off the drawing, and lists square feet and perimeter. No model.",
      status: onOff(input.roomFinderOn),
      where: { href: "/settings?tab=estimating#room-finder", label: "Settings → Estimating" },
      field: "roomFinderOn",
    },
    {
      key: "greyOut",
      title: "Grey out lines that probably aren't walls",
      explain:
        "Runs the wall check on what Find the walls offers and greys out the casework, fixtures and reference lines it names, out of the total and one click to take back. No model.",
      status: onOff(input.demotedWallsOn),
      where: { href: "/settings?tab=estimating#demoted-walls", label: "Settings → Estimating" },
      field: "demotedWallsOn",
    },
    {
      key: "wholeSet",
      title: "Find walls on every floor plan",
      explain: "One press runs Find the walls over every scaled floor-plan sheet of a set in the background and lists what each came to. No model.",
      status: onOff(input.wholeSetTakeoffOn),
      where: { href: "/settings?tab=estimating#whole-set-takeoff", label: "Settings → Estimating" },
      field: null,
    },
    {
      key: "doorsWindows",
      title: "Count the doors and windows",
      explain:
        "Reads the door swings and window frames off the plan itself, counts them, names each door from the door schedule, and uses its real width as the opening in the wall run it sits on. Windows are offered to check rather than claimed. No model.",
      status: onOff(input.doorsWindowsOn),
      where: { href: "/settings?tab=estimating#doors-windows", label: "Settings → Estimating" },
      field: null,
    },
    {
      key: "symbolCount",
      title: "Count every copy of a symbol",
      explain:
        "Draw a box round one symbol on a sheet and every copy of it is marked, turned or mirrored, so a count becomes a measurement instead of a tally on paper. Click a mark to drop a wrong one. No model.",
      status: onOff(input.symbolCountOn),
      where: { href: "/settings?tab=estimating#symbol-count", label: "Settings → Estimating" },
      field: null,
    },
    {
      key: "scannedPlans",
      title: "Read scanned sheets",
      explain:
        "A scanned sheet is a picture of a drawing; this reads the lines and the printed scale off the picture in the background so Find the walls can work on it, marked as read from an image. No model.",
      status: onOff(input.scannedPlansOn),
      where: { href: "/settings?tab=estimating#scanned-plans", label: "Settings → Estimating" },
      field: null,
    },
  ];
}

/** The status in words, for the pill and for a test. */
export function statusText(status: TakeoffFeatureStatus): string {
  switch (status.kind) {
    case "on":
      return "On";
    case "off":
      return "Off";
    case "needs":
      return `Switched on, but not working yet — ${status.needs.length === 1 ? "one thing" : `${status.needs.length} things`} needed`;
    case "not-yet":
      return "Not on this build yet";
  }
}
