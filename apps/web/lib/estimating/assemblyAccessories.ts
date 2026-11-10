import type { ProposedComponent } from "@/lib/takeoff/partitionAssembly";
import type { SpecSay } from "@/lib/specs/specTradeFacts";
import type { AssemblyStandards, MaterialKind } from "./assemblyStandards";

/**
 * ── A LEGEND'S ASSEMBLY, MADE COMPLETE ENOUGH TO ESTIMATE WITHOUT TYPING ──
 *
 * `readPartitionAssembly` reads what the legend PRINTS: studs, track, board, insulation. A bid
 * also buys what no legend prints — screws, tape, joint compound, and deflection track where the
 * wall runs to the deck. This adds those, by code and from the company's own standards, and fills
 * the gaps the legend leaves from what the job's spec says ("spec says": a stud gauge, Type X, Level
 * 5, deflection track). Every filled value says where it came from in its words.
 *
 * A legend and a spec that DISAGREE keep the legend's value and come back as a conflict for a
 * person — the drawing is the contract document a bid is checked against, and a quiet override in
 * either direction prices a wall nobody drew.
 *
 * Quantities, never prices. Corner bead is NOT added: it follows outside corners, which a takeoff
 * of wall runs does not measure, so it is named under `needsPerson` rather than guessed from LF.
 */
export type CompletedAssembly = {
  components: ProposedComponent[];
  /** Legend vs spec, one sentence each — written into the type's notes. */
  conflicts: string[];
  /** What this could not compute and a person still has to. */
  needsPerson: string[];
};

const STUD = /\bstuds?\b/i;
const TRACK = /\btrack\b|\bplates?\b/i;
const BOARD = /\bgypsum board\b/i;
const INSULATION = /\binsulation\b/i;
const SHEET_SQFT = 32; // 4x8

/** A wall the legend runs to the deck or structure above — its top track has to slip. */
export const RUNS_TO_DECK = /\b(?:to|at)\s+(?:the\s+)?(?:u\/?s|underside|bottom|btm\.?)\s+(?:of\s+)?(?:the\s+)?(?:roof\s+)?(?:deck|structure|slab)|\b(?:cont\.?|continuous|extend(?:s|ed)?)\s+to\s+(?:the\s+)?(?:roof\s+)?deck/i;

export function completeAssembly(input: {
  components: readonly ProposedComponent[];
  /** The type's own legend words. */
  lines: readonly string[];
  /** `specSays` for this type's lines. */
  says: readonly SpecSay[];
  standards: AssemblyStandards;
  /** True when the stud spacing on the type is the company's standard, not the drawing's or spec's. */
  spacingFromStandard: boolean;
}): CompletedAssembly {
  const { standards: s, says } = input;
  const joined = input.lines.join(" ");
  const conflicts: string[] = [];
  const needsPerson: string[] = [];
  const waste = (kind: MaterialKind) => s.wastePercent[kind];
  const source = (text: RegExp) => says.find((x) => text.test(x.text));

  const specGauge = says
    .map((x) => x.text.match(/^(\d{2}) ga studs/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b)[0];
  const specGaugeFrom = specGauge === undefined ? undefined : source(new RegExp(`^${specGauge} ga studs`))!.source;
  const typeX = source(/^Type X board$/);
  const level5 = source(/^Level 5 finish/);
  const deflectionSpec = source(/^deflection track$/);
  const deflection = RUNS_TO_DECK.test(joined) || deflectionSpec !== undefined;

  const out: ProposedComponent[] = [];
  let boardLayers = 0;
  let boarded = false;
  let gauge: number | null = null;

  for (const c of input.components) {
    if (STUD.test(c.description) && c.basis === "STUDS") {
      let description = c.description;
      const legendGauge = description.match(/(\d{2}) ga/)?.[1];
      if (legendGauge === undefined && specGauge !== undefined) {
        description = description.replace(/(stud(?:, size NOT stated on the drawing)?)/, `$1, ${specGauge} ga (spec ${specGaugeFrom})`);
        gauge = specGauge;
      } else if (legendGauge !== undefined) {
        gauge = Number(legendGauge);
        if (specGauge !== undefined && Number(legendGauge) > specGauge) {
          conflicts.push(`The legend says ${legendGauge} ga studs and the spec (${specGaugeFrom}) says ${specGauge} ga. The estimate uses the legend's ${legendGauge} ga — check which governs.`);
        }
      }
      if (input.spacingFromStandard && !/o\.c\./.test(description)) description += ` at ${s.studSpacingIn}in o.c. (your standard; not on the drawing)`;
      out.push({ ...c, description, wastePercent: waste("studs") });
      continue;
    }
    if (TRACK.test(c.description) && c.basis === "LINEAR_FT") {
      const g = gauge === null ? "" : `, ${gauge} ga`;
      if (deflection && /\btrack, top and bottom\b/.test(c.description)) {
        const width = c.description.match(/^(\S+in)/)?.[1] ?? "";
        const why = RUNS_TO_DECK.test(joined) ? "the wall runs to the deck" : `spec ${deflectionSpec!.source}`;
        out.push({ ...c, description: `${width} track, bottom${g}`.trim(), factor: 1, wastePercent: waste("track") });
        out.push({ ...c, description: `${width} deflection track, top${g} (${why})`.trim(), factor: 1, wastePercent: waste("track") });
      } else {
        out.push({ ...c, description: c.description.replace(/(track, top and bottom)/, `$1${g}`), wastePercent: waste("track") });
      }
      continue;
    }
    if (BOARD.test(c.description) && c.basis === "BOARDED_SQFT") {
      boardLayers = c.factor;
      boarded = true;
      let description = c.description;
      if (!/type X/i.test(description) && typeX !== undefined) {
        description = description.replace(/gypsum board/, `type X gypsum board (spec ${typeX.source})`);
      }
      out.push({ ...c, description: `${description}, 4x8 sheets`, unit: "SHT", factor: c.factor / SHEET_SQFT, wastePercent: waste("board"), roundUp: true });
      continue;
    }
    if (INSULATION.test(c.description)) {
      out.push({ ...c, wastePercent: waste("insulation") });
      continue;
    }
    out.push({ ...c });
  }

  if (boarded) {
    const from = out.find((c) => BOARD.test(c.description))!.from;
    const compound = s.compoundLbPerSqFt + (level5 === undefined ? 0 : s.level5SkimLbPerSqFt);
    out.push(
      // Per THOUSAND, the unit screws are bought in: a price column of cents cannot hold one screw's markup ($0.022 stores as $0.02).
      { description: "drywall screws, Type S, per 1,000", unit: "M", basis: "BOARDED_SQFT", factor: (boardLayers * s.screwsPerSqFt) / 1000, wastePercent: waste("screws"), roundUp: false, from },
      // In ROLLS: tape is about a cent and a half a foot, which a price column of cents cannot hold.
      { description: `joint tape, ${s.tapeRollLf} ft rolls`, unit: "RL", basis: "BOARDED_SQFT", factor: s.tapeLfPerSqFt / s.tapeRollLf, wastePercent: waste("tape"), roundUp: true, from },
      {
        description: `joint compound${level5 === undefined ? "" : `, Level 5 skim (spec ${level5.source})`}`,
        unit: "LB",
        basis: "BOARDED_SQFT",
        factor: compound,
        wastePercent: waste("compound"),
        roundUp: true,
        from,
      },
    );
    needsPerson.push("Corner bead: outside corners are not measured by the takeoff, so none is on the estimate.");
  }
  return { components: out, conflicts, needsPerson };
}
