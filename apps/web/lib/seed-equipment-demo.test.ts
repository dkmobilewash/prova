import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type AssignmentData,
  contradictions,
  currentAssignment,
  utilisation,
} from "@/components/equipmentDeployment";

/** Does the demo seed's equipment actually demo anything?
 *
 * It did not. `seed-demo.mjs` wrote the deprecated `Equipment.assignedJobId`
 * and created zero `EquipmentAssignment` rows, while every reader had moved
 * to the assignment history. So a fresh seed produced "8 items, 8 in the
 * yard", a blank utilisation on every row, and "Equipment: none on site" on
 * every job — and the one row the dataset exists to show, the texture rig
 * still on Cedar after closeout, demoed as sitting in the yard. Issue #147.
 *
 * Nothing typechecked or built any differently while that was true, because
 * the seed is a script and the column still exists. What settles it is
 * running the seed's own plan through the SAME functions the two pages use
 * and asserting what a person would see. That is what this does: it lifts
 * the `equipment` literal out of the script, replays it against
 * `currentAssignment`, `utilisation` and `contradictions`, and checks the
 * numbers on screen.
 *
 * It reads the source rather than importing it because the script has
 * top-level side effects — it loads .env and calls process.exit on a host
 * mismatch — and importing it here would either connect to a database or
 * kill the test run. The literal is anchored on `const equipment = [`; if
 * that moves, the extraction throws with a message saying so rather than
 * silently testing nothing.
 */

const seedPath = fileURLToPath(
  new URL("../../../packages/db/scripts/seed-demo.mjs", import.meta.url),
);
const source = readFileSync(seedPath, "utf8");

type Stay = [{ id: string }, number, number | null, string | null];
type Item = {
  name: string;
  type: string | null;
  assetTag: string | null;
  notes: string | null;
  known: number;
  stays: Stay[];
};

/** The seed's `equipment` array, evaluated with stub jobs in place of the
 * three job rows it closes over. */
function seedEquipment(): Item[] {
  const start = source.indexOf("const equipment = [");
  if (start === -1) throw new Error("seed-demo.mjs no longer has `const equipment = [`");
  const open = source.indexOf("[", start);
  const end = source.indexOf("\n  ];", open);
  if (end === -1) throw new Error("could not find the end of the equipment literal");
  const literal = source.slice(open, end + "\n  ]".length);
  const build = new Function(
    "riverside",
    "northgate",
    "cedar",
    `return ${literal};`,
  ) as (r: unknown, n: unknown, c: unknown) => Item[];
  return build({ id: "riverside" }, { id: "northgate" }, { id: "cedar" });
}

/** `day(offset)` from the seed: UTC midnight, offset in whole days. */
const DAY_MS = 86_400_000;
const day = (offset: number) => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);

const today = day(0);
const WINDOW_DAYS = 90; // must match apps/web/app/(app)/equipment/page.tsx
const windowStart = day(-WINDOW_DAYS);

const items = seedEquipment();

/** What `/equipment` would render for one seeded piece. */
function asRow(item: Item, index: number) {
  const history: AssignmentData[] = item.stays.map((stay, i) => ({
    id: `${index}-${i}`,
    equipmentId: String(index),
    equipmentName: item.name,
    jobId: stay[0].id,
    jobName: stay[0].id,
    sentOutOn: day(stay[1]),
    returnedOn: stay[2] === null ? null : day(stay[2]),
    notes: stay[3],
  }));
  return {
    name: item.name,
    history,
    open: currentAssignment(history),
    use: utilisation(history, windowStart, today, day(item.known)),
  };
}

const rows = items.map(asRow);
const find = (fragment: string) => {
  const row = rows.find((r) => r.name.includes(fragment));
  if (!row) throw new Error(`no seeded equipment matching "${fragment}"`);
  return row;
};

describe("the seed writes assignments, not the dead column", () => {
  it("creates EquipmentAssignment rows", () => {
    expect(source).toContain("prisma.equipmentAssignment.create");
  });

  it("never writes Equipment.assignedJobId", () => {
    // The column is DEPRECATED and read by nothing. Writing it is how the
    // seed looked correct while producing an empty yard. Matched as a
    // FIELD (`assignedJobId:`) rather than as a word, so the undo path can
    // still explain in prose why the column's SET NULL matters there.
    expect(source).not.toMatch(/assignedJobId\s*:/);
  });

  it("backdates createdAt, or no row can report a utilisation at all", () => {
    // `utilisation` clamps its window to the day the record was created, so
    // a row created at now() has a zero-day window and reads "too new to say
    // how used it is" however many stays it has. This is not a nicety: it
    // is the difference between the figure existing and not.
    expect(source).toContain("createdAt: day(item.known)");
  });
});

describe("what /equipment shows after a fresh seed", () => {
  it("has eight pieces, and does not report them all in the yard", () => {
    expect(rows).toHaveLength(8);
    const inYard = rows.filter((r) => r.open === null);
    expect(inYard).toHaveLength(3);
    expect(inYard.map((r) => r.name)).toEqual([
      "Mud mixer, 1/2in drill",
      "Laser level, Hilti PM 30-MG",
      "Wheelbarrow (x3)",
    ]);
  });

  it("still has the texture rig out on the FINISHED job", () => {
    // The row the dataset exists for. /deployment's "out on a job that
    // isn't running" section has nothing else to put in it.
    const rig = find("Graco Mark V");
    expect(rig.open).not.toBeNull();
    expect(rig.open?.jobId).toBe("cedar");
    expect(rig.open?.returnedOn).toBeNull();
  });

  it("reports a real utilisation percentage on most pieces", () => {
    const measured = rows.filter((r) => r.use.percent !== null && r.use.percent > 0);
    expect(measured.length).toBeGreaterThanOrEqual(6);
    // The rig has been out the whole window, which is the tell that nobody
    // collected it.
    expect(find("Graco Mark V").use.percent).toBe(100);
    // And a piece that has never left the yard honestly reports zero rather
    // than being hidden.
    expect(find("Laser level").use.percent).toBe(0);
  });

  it("says 'too new to say' for the piece created today", () => {
    // percent === null is a different claim from 0%, and the only row that
    // exercises it is one whose window is zero days long.
    const barrow = find("Wheelbarrow");
    expect(barrow.use.percent).toBeNull();
    expect(barrow.use.daysTracked).toBe(0);
  });

  it("has a stay dated in the future, which is a plan and not a deployment", () => {
    const crimper = find("Stud crimper");
    expect(crimper.open).not.toBeNull();
    expect(String(crimper.open?.sentOutOn) > today).toBe(true);
    // A future stay must not be counted as time out; the piece has not left.
    expect(crimper.use.daysOut).toBeLessThan(WINDOW_DAYS);
    expect(crimper.use.percent).toBeGreaterThan(0);
  });
});

describe("what /deployment shows after a fresh seed", () => {
  const allStays = rows.flatMap((r) => r.history);

  it("puts equipment on the running job", () => {
    const out = allStays.filter((s) => s.returnedOn === null);
    expect(out.filter((s) => s.jobId === "riverside").length).toBeGreaterThanOrEqual(3);
    expect(out.some((s) => s.jobId === "northgate")).toBe(true);
    expect(out.some((s) => s.jobId === "cedar")).toBe(true);
  });

  it("opens on no contradiction banner", () => {
    // Two records putting one machine in two places is an ERROR state the
    // page reports in red. Seeding one would ship a demo that opens on an
    // error, so every range per piece is disjoint. If a contradiction is
    // ever wanted in the demo it should be added deliberately, and this
    // assertion changed on purpose rather than discovered failing.
    expect(contradictions(allStays)).toEqual([]);
  });
});
