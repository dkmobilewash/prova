/**
 * MESA RIDGE MEDICAL OFFICE BUILDING — the single geometric source of truth for
 * the takeoff accuracy bench.
 *
 * FICTIONAL. Every wall, door and room here is invented, and nothing in this
 * directory was read off a real drawing — "never use real customer files in
 * tests or fixtures". Every sheet, every export variant and every answer key is
 * derived from the data in this file, so the answer key never comes from reading
 * a PDF back.
 *
 * Units: FEET of building, x to the right, y UP, origin at grid A/1.
 *
 * ── ONE DELIBERATE DEPARTURE FROM THE BRIEF ──
 *
 * The brief asked for grids A–H and 1–9 at 30'-0" bays AND ~38,000 SF over two
 * storeys. Those disagree: A–H × 1–9 at 30' is 50,400 SF a floor. The floor
 * plate here is A–H (seven bays, two of them odd: 27'-4" and 30'-0"… see
 * `GRID_X`) by 1–4 (30, 30, 32), 208' × 93' ≈ 19,400 SF a floor, 38,800 SF
 * total — so the area is right and the grid is shorter in one direction.
 */

export type Pt = { x: number; y: number };

export type TypeCode = "A1" | "A2" | "B1" | "C1" | "D1" | "F1" | "EXT-1" | "EXT-2" | "CMU" | "SF";

/**
 * A partition type as the partition-type legend (A-501) states it.
 *
 * `planLines` is where a plan draws lines for this type, in inches from the
 * centreline: two faces for a plain partition, more for a layered assembly.
 * That list is what a plan EXPORT looks like, and it is the thing the wall
 * finder's series test reacts to.
 */
export type PartitionType = {
  code: TypeCode;
  description: string;
  thicknessIn: number;
  /** Metal stud + board scope a drywall sub bids. CMU and storefront are not. */
  inScope: boolean;
  studSpacingIn: number;
  /** Rows of studs (2 for a chase wall). 0 for no studs (CMU, storefront). */
  studRows: number;
  /** Board layers on each face, [side+ , side-]. */
  layers: [number, number];
  insulation: boolean;
  /** Track rows top and bottom: 2 per stud row. */
  planLines: number[];
};

const faces = (t: number) => [t / 2, -t / 2];

export const PARTITION_TYPES: Record<TypeCode, PartitionType> = {
  A1: {
    code: "A1",
    description: '3-5/8" 20ga stud @ 16" OC, 1 layer 5/8" Type X each side (4-7/8")',
    thicknessIn: 4.875,
    inScope: true,
    studSpacingIn: 16,
    studRows: 1,
    layers: [1, 1],
    insulation: false,
    planLines: faces(4.875),
  },
  A2: {
    code: "A2",
    description: 'A1 with 3-1/2" acoustic batt, to deck (4-7/8")',
    thicknessIn: 4.875,
    inScope: true,
    studSpacingIn: 16,
    studRows: 1,
    layers: [1, 1],
    insulation: true,
    planLines: faces(4.875),
  },
  B1: {
    code: "B1",
    description: '6" 18ga stud @ 16" OC, 1 layer 5/8" Type X each side (7-1/4")',
    thicknessIn: 7.25,
    inScope: true,
    studSpacingIn: 16,
    studRows: 1,
    layers: [1, 1],
    insulation: false,
    planLines: faces(7.25),
  },
  C1: {
    code: "C1",
    description: '2-hr shaft wall: 2-1/2" CH stud @ 24" OC, 1" liner shaft side, 2 layers 5/8" Type X room side (4-3/4")',
    thicknessIn: 4.75,
    inScope: true,
    studSpacingIn: 24,
    studRows: 1,
    // Liner panel counted as one "layer" on the shaft side.
    layers: [2, 1],
    insulation: false,
    planLines: faces(4.75),
  },
  D1: {
    code: "D1",
    description: 'Chase wall: double 3-5/8" stud @ 16" OC with 6" gap, 1 layer 5/8" each outer side (14-1/2")',
    thicknessIn: 14.5,
    inScope: true,
    studSpacingIn: 16,
    studRows: 2,
    layers: [1, 1],
    insulation: false,
    // Outer board faces and the two inner stud faces either side of the cavity.
    planLines: [7.25, 3, -3, -7.25],
  },
  F1: {
    code: "F1",
    description: 'Furring: 7/8" hat channel @ 16" OC + 1 layer 5/8" one side, on CMU (1-1/2")',
    thicknessIn: 1.5,
    inScope: true,
    studSpacingIn: 16,
    studRows: 1,
    layers: [1, 0],
    insulation: false,
    planLines: faces(1.5),
  },
  "EXT-1": {
    code: "EXT-1",
    description: 'Exterior: 6" 18ga stud @ 16" OC, 5/8" gyp inside, 5/8" sheathing, 1-1/2" EPS + EIFS (8-7/8")',
    thicknessIn: 8.875,
    inScope: true,
    studSpacingIn: 16,
    studRows: 1,
    // Interior gyp and exterior sheathing are both board scope.
    layers: [1, 1],
    insulation: true,
    // gyp face, stud in, stud out, sheathing out, EIFS face — five lines.
    planLines: [4.4375, 3.8125, -2.1875, -2.8125, -4.4375],
  },
  "EXT-2": {
    code: "EXT-2",
    description: 'Exterior: 6" 18ga stud @ 16" OC, 5/8" gyp inside, 5/8" sheathing, 3-coat stucco (8-1/8")',
    thicknessIn: 8.125,
    inScope: true,
    studSpacingIn: 16,
    studRows: 1,
    layers: [1, 1],
    insulation: true,
    planLines: [4.0625, 3.4375, -2.5625, -4.0625],
  },
  CMU: {
    code: "CMU",
    description: "8\" CMU (by others — not drywall scope)",
    thicknessIn: 7.625,
    inScope: false,
    studSpacingIn: 0,
    studRows: 0,
    layers: [0, 0],
    insulation: false,
    planLines: faces(7.625),
  },
  SF: {
    code: "SF",
    description: 'Aluminium storefront, 4-1/2" frame (by others — not drywall scope)',
    thicknessIn: 4.5,
    inScope: false,
    studSpacingIn: 0,
    studRows: 0,
    layers: [0, 0],
    insulation: false,
    planLines: faces(4.5),
  },
};

export type Wall = {
  id: string;
  type: TypeCode;
  a: Pt;
  b: Pt;
  /** A curved wall. `a`/`b` are its end points; the arc runs CCW a0→a1. */
  arc?: { c: Pt; r: number; a0: number; a1: number };
  heightFt: number;
  /** Existing to be demolished — drawn dashed, NOT new scope. */
  demo?: boolean;
  /** On a hidden optional-content layer in the OCG variant — NOT counted. */
  hiddenLayer?: boolean;
  /** Free text the answer key carries (why this wall exists in the bench). */
  note?: string;
};

export type OpeningKind = "door" | "pair" | "sidelite" | "cased" | "window" | "storefront" | "relite";

export type Opening = {
  mark: string;
  kind: OpeningKind;
  /** A point on the host wall's centreline — the opening's centre. */
  at: Pt;
  widthFt: number;
  heightFt: number;
};

export type Room = { number: string; name: string; at: Pt; ceilingFt: number; ceiling: "ACT" | "GYP" | "OPEN" };

export type Grid = { x: { name: string; at: number }[]; y: { name: string; at: number }[] };

export type Level = {
  name: "L1" | "L2";
  toDeckFt: number;
  walls: Wall[];
  openings: Opening[];
  columns: Pt[];
  rooms: Room[];
  /** Soffits/bulkheads: outline rectangles in feet (for the RCP). */
  soffits: { x0: number; y0: number; x1: number; y1: number }[];
  /** Dimension strings for a generated plan (the holdout); Mesa Ridge's are in `planDims`. */
  dims?: [Pt, Pt][];
};

export const COLUMN_SIZE_FT = 1;

/** 27'-4" is the odd bay the brief asked for. */
export const GRID: Grid = {
  x: [
    { name: "A", at: 0 },
    { name: "B", at: 30 },
    { name: "C", at: 60 },
    { name: "D", at: 87 + 4 / 12 },
    { name: "E", at: 117 + 4 / 12 },
    { name: "F", at: 147 + 4 / 12 },
    { name: "G", at: 177 + 4 / 12 },
    { name: "H", at: 207 + 4 / 12 },
  ],
  y: [
    { name: "1", at: 0 },
    { name: "2", at: 30 },
    { name: "3", at: 60 },
    { name: "4", at: 92 },
  ],
};

const D = GRID.x[3].at; // 87.333
const E = GRID.x[4].at; // 117.333
const F = GRID.x[5].at; // 147.333

/** Exterior wall centrelines sit 8" outside the grid. */
const XW = -8 / 12;
const XE = 208;
const YS = -8 / 12;
const YN = 92 + 8 / 12;

const p = (x: number, y: number): Pt => ({ x, y });

/** L1: 14'-6" to deck; ceilings at 10'-0", so "6 inches above ceiling" walls are 10'-6". */
const L1_DECK = 14.5;
const ABOVE_CEILING = 10.5;

function level1(): Level {
  const walls: Wall[] = [
    // ── EXTERIOR ──
    { id: "X-S", type: "EXT-1", a: p(XW, YS), b: p(XE, YS), heightFt: L1_DECK },
    { id: "X-E", type: "EXT-1", a: p(XE, YS), b: p(XE, YN), heightFt: L1_DECK },
    { id: "X-N", type: "EXT-2", a: p(XE, YN), b: p(XW, YN), heightFt: L1_DECK },
    { id: "X-W", type: "EXT-1", a: p(XW, YN), b: p(XW, YS), heightFt: L1_DECK },
    // Storefront sits in the south wall's 20' opening. Out of scope.
    { id: "SF-1", type: "SF", a: p(5, YS), b: p(25, YS), heightFt: 10, note: "storefront in the entry opening" },

    // ── CORRIDOR (6' clear), lobby to the east exterior wall ──
    { id: "C-S", type: "A1", a: p(30, 43), b: p(XE, 43), heightFt: ABOVE_CEILING, note: "corridor south: L at B, T into exterior" },
    { id: "C-N", type: "A1", a: p(30, 49), b: p(XE, 49), heightFt: ABOVE_CEILING, note: "corridor north" },
    { id: "B-S", type: "A1", a: p(30, YS), b: p(30, 43), heightFt: ABOVE_CEILING, note: "passes column B2" },
    { id: "B-N", type: "A1", a: p(30, 49), b: p(30, YN), heightFt: ABOVE_CEILING, note: "passes column B3" },

    // ── LOBBY ──
    { id: "LB-1", type: "A1", a: p(XW, 60), b: p(30, 60), heightFt: 9, note: "stops at the soffit: 9'-0\"; dies into column A3" },
    { id: "LB-2", type: "A1", a: p(12, 60), b: p(12, YN), heightFt: ABOVE_CEILING },
    {
      id: "RCP-ARC",
      type: "A1",
      a: p(6 + 22 * Math.cos((20 * Math.PI) / 180), 14 + 22 * Math.sin((20 * Math.PI) / 180)),
      b: p(6 + 22 * Math.cos((80 * Math.PI) / 180), 14 + 22 * Math.sin((80 * Math.PI) / 180)),
      arc: { c: p(6, 14), r: 22, a0: 20, a1: 80 },
      heightFt: ABOVE_CEILING,
      note: "curved reception wall, R=22'-0\"",
    },
    {
      id: "LB-30",
      type: "A1",
      a: p(2, 40),
      b: p(2 + 10 * Math.cos(Math.PI / 6), 40 + 10 * Math.sin(Math.PI / 6)),
      heightFt: ABOVE_CEILING,
      note: "30 degree wing wall, free ends",
    },

    // ── NORTH SIDE: exam rooms, offices, nurse station, conference, imaging ──
    { id: "N-BK", type: "A1", a: p(30, 66), b: p(E, 66), heightFt: ABOVE_CEILING, note: "X with B1 at grid D" },
    ...[40, 50, 60, 70, 80].map((x) => ({
      id: `N-EX${x}`,
      type: "A2" as TypeCode,
      a: p(x, 49),
      b: p(x, 66),
      heightFt: L1_DECK,
      note: "exam room demising, acoustic, to deck",
    })),
    { id: "N-D", type: "B1", a: p(D, 49), b: p(D, YN), heightFt: L1_DECK, note: "B1 through the N-BK X junction" },
    { id: "N-OF50", type: "A1", a: p(50, 66), b: p(50, YN), heightFt: ABOVE_CEILING },
    { id: "N-OF70", type: "A1", a: p(70, 66), b: p(70, YN), heightFt: ABOVE_CEILING },
    // Nurse station: a 45 degree wall off the corridor, an L at 135 degrees, then back.
    { id: "NS-45", type: "A1", a: p(92, 49), b: p(98, 55), heightFt: ABOVE_CEILING, note: "45 degree, T into corridor" },
    { id: "NS-H", type: "A1", a: p(98, 55), b: p(110, 55), heightFt: ABOVE_CEILING, note: "135 degree L" },
    { id: "NS-V", type: "A1", a: p(110, 55), b: p(110, 49), heightFt: ABOVE_CEILING },
    { id: "N-E", type: "A1", a: p(E, 49), b: p(E, YN), heightFt: ABOVE_CEILING, note: "passes column E3" },
    {
      id: "CF-17",
      type: "A1",
      a: p(E, 72),
      b: p(E + 18 * Math.cos((17.5 * Math.PI) / 180), 72 + 18 * Math.sin((17.5 * Math.PI) / 180)),
      heightFt: ABOVE_CEILING,
      note: "17.5 degree conference room wall",
    },
    { id: "N-F", type: "A1", a: p(F, 49), b: p(F, YN), heightFt: ABOVE_CEILING, note: "cased opening" },
    { id: "IM-V", type: "B1", a: p(165, 49), b: p(165, YN), heightFt: L1_DECK },
    { id: "IM-H", type: "B1", a: p(F, 70), b: p(165, 70), heightFt: L1_DECK },
    // Stair: CMU by others, furred out with F1.
    { id: "ST-V", type: "CMU", a: p(190, 62), b: p(190, YN), heightFt: L1_DECK },
    { id: "ST-H", type: "CMU", a: p(190, 62), b: p(XE, 62), heightFt: L1_DECK },
    {
      id: "FR-V",
      type: "F1",
      a: p(190 - 7.625 / 24 - 1.5 / 24, 62 - 7.625 / 24 - 1.5 / 24),
      b: p(190 - 7.625 / 24 - 1.5 / 24, YN),
      heightFt: L1_DECK,
      note: "furring on CMU, dies into exterior",
    },
    {
      id: "FR-H",
      type: "F1",
      a: p(190 - 7.625 / 24 - 1.5 / 24, 62 - 7.625 / 24 - 1.5 / 24),
      b: p(XE, 62 - 7.625 / 24 - 1.5 / 24),
      heightFt: L1_DECK,
    },
    // Elevator shaft.
    { id: "EL-V", type: "C1", a: p(178, 78), b: p(178, YN), heightFt: L1_DECK, note: "shaft wall" },
    { id: "EL-H", type: "C1", a: p(178, 78), b: p(190, 78), heightFt: L1_DECK, note: "dies into CMU" },

    // ── SOUTH SIDE ──
    { id: "S-BK", type: "A1", a: p(30, 28), b: p(D, 28), heightFt: ABOVE_CEILING },
    ...[40, 50, 60, 70, 80].map((x) => ({
      id: `S-EX${x}`,
      type: "A2" as TypeCode,
      a: p(x, 28),
      b: p(x, 43),
      heightFt: L1_DECK,
      note: x === 60 ? "passes column C2" : "exam room demising",
    })),
    { id: "S-OF", type: "A1", a: p(58.5, YS), b: p(58.5, 28), heightFt: ABOVE_CEILING },
    { id: "S-D", type: "B1", a: p(D, YS), b: p(D, 43), heightFt: L1_DECK, note: "passes columns D1, D2" },
    { id: "S-E", type: "A1", a: p(E, YS), b: p(E, 43), heightFt: ABOVE_CEILING, note: "X with S-20" },
    { id: "S-20", type: "A1", a: p(D, 20), b: p(F, 20), heightFt: ABOVE_CEILING, note: "A1 x A1 X junction at grid E" },
    { id: "S-F", type: "A1", a: p(F, YS), b: p(F, 43), heightFt: ABOVE_CEILING },
    { id: "S-165", type: "A1", a: p(165, YS), b: p(165, 43), heightFt: ABOVE_CEILING },
    { id: "RR-10", type: "A2", a: p(165, 10), b: p(XE, 10), heightFt: L1_DECK },
    { id: "RR-CH", type: "D1", a: p(186, 10), b: p(186, 43), heightFt: L1_DECK, note: "plumbing chase between restrooms" },
    { id: "EL-RM", type: "A1", a: p(186, YS), b: p(186, 10), heightFt: ABOVE_CEILING, note: "collinear with the chase, opposite side of RR-10" },
  ];

  const openings: Opening[] = [
    // Exterior.
    { mark: "SF1", kind: "storefront", at: p(15, YS), widthFt: 20, heightFt: 10 },
    ...[70, 100, 130, 157].map((x, i) => ({ mark: `W1-${i + 1}`, kind: "window" as OpeningKind, at: p(x, YS), widthFt: 4, heightFt: 5 })),
    ...[20, 52].map((y, i) => ({ mark: `W1-E${i + 1}`, kind: "window" as OpeningKind, at: p(XE, y), widthFt: 4, heightFt: 5 })),
    ...[20, 40, 80, 100, 130, 158].map((x, i) => ({ mark: `W2-${i + 1}`, kind: "window" as OpeningKind, at: p(x, YN), widthFt: 5, heightFt: 5 })),
    ...[30, 75].map((y, i) => ({ mark: `W1-W${i + 1}`, kind: "window" as OpeningKind, at: p(XW, y), widthFt: 4, heightFt: 5 })),
    { mark: "100A", kind: "door", at: p(XE, 46), widthFt: 3, heightFt: 7 },
    { mark: "150A", kind: "door", at: p(200, YN), widthFt: 3, heightFt: 7 },
    // Corridor doors.
    ...[35, 45, 55, 65, 75].map((x, i) => ({ mark: `1${10 + i}`, kind: "door" as OpeningKind, at: p(x, 49), widthFt: 3, heightFt: 7 })),
    ...[35, 45, 55, 65, 75].map((x, i) => ({ mark: `1${30 + i}`, kind: "door" as OpeningKind, at: p(x, 43), widthFt: 3, heightFt: 7 })),
    { mark: "120", kind: "pair", at: p(156, 49), widthFt: 6, heightFt: 7 },
    { mark: "118", kind: "sidelite", at: p(132, 49), widthFt: 4.5, heightFt: 7 },
    { mark: "116", kind: "door", at: p(104, 55), widthFt: 3, heightFt: 7 },
    { mark: "140", kind: "door", at: p(100, 43), widthFt: 3, heightFt: 7 },
    { mark: "141", kind: "door", at: p(132, 43), widthFt: 3, heightFt: 7 },
    { mark: "142", kind: "pair", at: p(156, 43), widthFt: 6, heightFt: 7 },
    { mark: "143", kind: "door", at: p(171, 43), widthFt: 3, heightFt: 7 },
    { mark: "144", kind: "door", at: p(200, 43), widthFt: 3, heightFt: 7 },
    { mark: "145", kind: "door", at: p(175, 10), widthFt: 3, heightFt: 7 },
    { mark: "146", kind: "door", at: p(196, 10), widthFt: 3, heightFt: 7 },
    { mark: "121", kind: "door", at: p(171, 49), widthFt: 3, heightFt: 7 },
    { mark: "122", kind: "door", at: p(186 + 7.625 / 24 + 2, 49), widthFt: 3, heightFt: 7 },
    // Office doors.
    { mark: "125", kind: "door", at: p(40, 66), widthFt: 3, heightFt: 7 },
    { mark: "126", kind: "door", at: p(60, 66), widthFt: 3, heightFt: 7 },
    { mark: "127", kind: "door", at: p(78, 66), widthFt: 3, heightFt: 7 },
    { mark: "128", kind: "door", at: p(D, 80), widthFt: 3, heightFt: 7 },
    { mark: "135", kind: "door", at: p(40, 28), widthFt: 3, heightFt: 7 },
    { mark: "136", kind: "door", at: p(70, 28), widthFt: 3, heightFt: 7 },
    { mark: "137", kind: "door", at: p(D, 10), widthFt: 3, heightFt: 7 },
    { mark: "102", kind: "door", at: p(12, 76), widthFt: 3, heightFt: 7 },
    { mark: "103", kind: "door", at: p(20, 60), widthFt: 3, heightFt: 7 },
    // Cased opening, relite.
    { mark: "CO1", kind: "cased", at: p(F, 80), widthFt: 6, heightFt: 8 },
    { mark: "RL1", kind: "relite", at: p(E, 58), widthFt: 4, heightFt: 4 },
  ];

  const columns: Pt[] = [];
  for (const gx of GRID.x) for (const gy of GRID.y) columns.push(p(gx.at, gy.at));

  const rooms: Room[] = [
    { number: "101", name: "LOBBY", at: p(15, 25), ceilingFt: 12, ceiling: "GYP" },
    { number: "102", name: "OFFICE", at: p(20, 76), ceilingFt: 9, ceiling: "ACT" },
    { number: "105", name: "WAITING", at: p(15, 50), ceilingFt: 10, ceiling: "ACT" },
    ...[35, 45, 55, 65, 75].map((x, i) => ({ number: `${110 + i}`, name: "EXAM", at: p(x, 58), ceilingFt: 10, ceiling: "ACT" as const })),
    { number: "116", name: "NURSE", at: p(104, 51.5), ceilingFt: 10, ceiling: "ACT" },
    { number: "118", name: "CONFERENCE", at: p(132, 82), ceilingFt: 10, ceiling: "ACT" },
    { number: "120", name: "IMAGING", at: p(156, 60), ceilingFt: 10, ceiling: "GYP" },
    { number: "121", name: "STORAGE", at: p(171, 60), ceilingFt: 10, ceiling: "ACT" },
    { number: "123", name: "ELEV", at: p(184, 85), ceilingFt: 0, ceiling: "OPEN" },
    { number: "124", name: "STAIR 1", at: p(199, 77), ceilingFt: 0, ceiling: "OPEN" },
    ...[35, 45, 55, 65, 75].map((x, i) => ({ number: `${130 + i}`, name: "EXAM", at: p(x, 35), ceilingFt: 10, ceiling: "ACT" as const })),
    { number: "140", name: "RECORDS", at: p(100, 30), ceilingFt: 10, ceiling: "ACT" },
    { number: "143", name: "MEN", at: p(175, 30), ceilingFt: 9, ceiling: "GYP" },
    { number: "144", name: "WOMEN", at: p(197, 30), ceilingFt: 9, ceiling: "GYP" },
    { number: "145", name: "ELEC", at: p(175, 4), ceilingFt: 0, ceiling: "OPEN" },
    { number: "146", name: "JAN", at: p(197, 4), ceilingFt: 9, ceiling: "ACT" },
    { number: "100", name: "CORRIDOR", at: p(120, 46), ceilingFt: 9, ceiling: "ACT" },
  ];

  const soffits = [
    { x0: XW, y0: 56, x1: 30, y1: 64 },
    { x0: 30, y0: 43, x1: 186, y1: 49 },
  ];

  return { name: "L1", toDeckFt: L1_DECK, walls, openings, columns, rooms, soffits };
}

/** L2: different layout, 13'-0" to deck. */
const L2_DECK = 13;

function level2(): Level {
  const ab = 9.5;
  const walls: Wall[] = [
    { id: "2X-S", type: "EXT-1", a: p(XW, YS), b: p(XE, YS), heightFt: L2_DECK },
    { id: "2X-E", type: "EXT-1", a: p(XE, YS), b: p(XE, YN), heightFt: L2_DECK },
    { id: "2X-N", type: "EXT-2", a: p(XE, YN), b: p(XW, YN), heightFt: L2_DECK },
    { id: "2X-W", type: "EXT-1", a: p(XW, YN), b: p(XW, YS), heightFt: L2_DECK },
    // An L-shaped corridor: east-west then north-south.
    { id: "2C-S", type: "A1", a: p(XW, 40), b: p(150, 40), heightFt: ab },
    { id: "2C-N", type: "A1", a: p(XW, 46), b: p(144, 46), heightFt: ab },
    { id: "2C-W", type: "A1", a: p(144, 46), b: p(144, YN), heightFt: ab, note: "inside corner of the L corridor" },
    { id: "2C-E", type: "A1", a: p(150, 40), b: p(150, YN), heightFt: ab },
    // A 120' run of offices along the south — the long wall.
    { id: "2S-BK", type: "A1", a: p(12, 22), b: p(132, 22), heightFt: ab, note: "120' long, eleven T junctions" },
    ...[12, 24, 36, 48, 60, 72, 84, 96, 108, 120, 132].map((x) => ({
      id: `2S-${x}`,
      type: "A1" as TypeCode,
      a: p(x, 22),
      b: p(x, 40),
      heightFt: ab,
    })),
    { id: "2S-SH", type: "A1", a: p(132, YS), b: p(132, 22), heightFt: ab },
    // Open office north: a few partitions only.
    { id: "2N-1", type: "A2", a: p(XW, 70), b: p(40, 70), heightFt: L2_DECK },
    { id: "2N-2", type: "A2", a: p(40, 46), b: p(40, 70), heightFt: L2_DECK },
    { id: "2N-3", type: "B1", a: p(100, 60), b: p(144, 60), heightFt: L2_DECK },
    { id: "2N-45", type: "A1", a: p(60, 46), b: p(60 + 12 / Math.SQRT2, 46 + 12 / Math.SQRT2), heightFt: ab, note: "45 degree branch" },
    // Core repeats L1's.
    { id: "2ST-V", type: "CMU", a: p(190, 62), b: p(190, YN), heightFt: L2_DECK },
    { id: "2ST-H", type: "CMU", a: p(190, 62), b: p(XE, 62), heightFt: L2_DECK },
    { id: "2EL-V", type: "C1", a: p(178, 78), b: p(178, YN), heightFt: L2_DECK },
    { id: "2EL-H", type: "C1", a: p(178, 78), b: p(190, 78), heightFt: L2_DECK },
    { id: "2RR-10", type: "A2", a: p(165, 10), b: p(XE, 10), heightFt: L2_DECK },
    { id: "2RR-CH", type: "D1", a: p(186, 10), b: p(186, 40), heightFt: L2_DECK },
    { id: "2RR-W", type: "A1", a: p(165, YS), b: p(165, 40), heightFt: ab },
    { id: "2RR-C", type: "A1", a: p(150, 40), b: p(XE, 40), heightFt: ab, note: "continues the corridor wall east of the L" },
  ];
  const openings: Opening[] = [
    ...[18, 30, 42, 54, 66, 78, 90, 102, 114, 126].map((x, i) => ({
      mark: `2${10 + i}`,
      kind: "door" as OpeningKind,
      at: p(x, 40),
      widthFt: 3,
      heightFt: 7,
    })),
    ...[20, 60, 100, 140].map((x, i) => ({ mark: `W1-2${i}`, kind: "window" as OpeningKind, at: p(x, YS), widthFt: 4, heightFt: 5 })),
    ...[20, 60, 100, 140].map((x, i) => ({ mark: `W2-2${i}`, kind: "window" as OpeningKind, at: p(x, YN), widthFt: 5, heightFt: 5 })),
    { mark: "250", kind: "pair", at: p(144, 55), widthFt: 6, heightFt: 7 },
    { mark: "251", kind: "door", at: p(175, 40), widthFt: 3, heightFt: 7 },
    { mark: "252", kind: "door", at: p(200, 40), widthFt: 3, heightFt: 7 },
  ];
  const columns: Pt[] = [];
  for (const gx of GRID.x) for (const gy of GRID.y) columns.push(p(gx.at, gy.at));
  const rooms: Room[] = [
    { number: "200", name: "CORRIDOR", at: p(70, 43), ceilingFt: 9, ceiling: "ACT" },
    { number: "230", name: "OPEN OFFICE", at: p(90, 75), ceilingFt: 9, ceiling: "ACT" },
    ...[18, 30, 42, 54, 66, 78, 90, 102, 114, 126].map((x, i) => ({ number: `${210 + i}`, name: "OFFICE", at: p(x, 31), ceilingFt: 9, ceiling: "ACT" as const })),
  ];
  return { name: "L2", toDeckFt: L2_DECK, walls, openings, columns, rooms, soffits: [] };
}

/** Existing walls to be demolished — drawn dashed on A-101's demo variant. */
export function demoWalls(): Wall[] {
  return [
    { id: "DEMO-1", type: "A1", a: p(120, 75), b: p(140, 75), heightFt: ABOVE_CEILING, demo: true, note: "existing, to be removed" },
    { id: "DEMO-2", type: "A1", a: p(140, 75), b: p(140, 88), heightFt: ABOVE_CEILING, demo: true },
    { id: "DEMO-3", type: "A1", a: p(95, 5), b: p(95, 18), heightFt: ABOVE_CEILING, demo: true },
  ];
}

/** Walls on a hidden optional-content layer (existing-to-remain, turned off). */
export function hiddenLayerWalls(): Wall[] {
  return [
    { id: "HID-1", type: "A1", a: p(100, 70), b: p(100, 90), heightFt: ABOVE_CEILING, hiddenLayer: true, note: "on a layer that is OFF" },
    { id: "HID-2", type: "A1", a: p(100, 90), b: p(115, 90), heightFt: ABOVE_CEILING, hiddenLayer: true },
    { id: "HID-3", type: "B1", a: p(150, 80), b: p(162, 80), heightFt: ABOVE_CEILING, hiddenLayer: true },
  ];
}

/**
 * ADDENDUM 2 (A-101 REV 1): the corridor moves 4'-0" north, exam rooms 120 and
 * 121's demising wall goes (two rooms combined), and S-165 changes A1 → B1.
 */
export function level1Rev1(): Level {
  const base = level1();
  const shift = (pt: Pt): Pt => (pt.y === 43 || pt.y === 49 ? { x: pt.x, y: pt.y + 4 } : pt);
  const walls = base.walls
    .filter((w) => w.id !== "N-EX50")
    .map((w) => {
      if (w.id === "S-165") return { ...w, type: "B1" as TypeCode, note: "Addendum 2: A1 -> B1" };
      if (w.arc) return w;
      return { ...w, a: shift(w.a), b: shift(w.b) };
    });
  const openings = base.openings.map((o) => (o.at.y === 43 || o.at.y === 49 ? { ...o, at: shift(o.at) } : o));
  return { ...base, walls, openings };
}

export const L1 = level1();
export const L2 = level2();

// ── GEOMETRY ──────────────────────────────────────────────────────────────────

export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
export const len = (a: Pt) => Math.hypot(a.x, a.y);
export const unit = (a: Pt): Pt => mul(a, 1 / len(a));
export const normal = (u: Pt): Pt => ({ x: -u.y, y: u.x });

export const thicknessFt = (w: Wall) => PARTITION_TYPES[w.type].thicknessIn / 12;

/** Centreline length — what an estimator traces. */
export function centrelineLength(w: Wall): number {
  if (w.arc) return (w.arc.r * Math.abs(w.arc.a1 - w.arc.a0) * Math.PI) / 180;
  return len(sub(w.b, w.a));
}

/** Where along `w` (feet from `a`) the infinite line `o0 + s*od` crosses `w`'s
 *  line offset by `off`, or null if parallel. */
function crossParam(w0: Pt, wu: Pt, o0: Pt, ou: Pt): number | null {
  const den = wu.x * ou.y - wu.y * ou.x;
  if (Math.abs(den) < 1e-9) return null;
  const d = sub(o0, w0);
  return (d.x * ou.y - d.y * ou.x) / den;
}

/** A drawn line of a wall: offset from the centreline, and the stretches of the
 *  axis it is drawn over (feet from `a`). */
export type FaceRun = { offsetFt: number; spans: [number, number][] };

/** Everything a plan draws for one straight wall, junction cleanup applied. */
export type WallDrawing = {
  wall: Wall;
  lines: FaceRun[];
  /** End-cap and jamb lines: pairs of axis params at which a cap crosses the wall. */
  caps: number[];
  /** The two outer faces' spans, for the answer key's "what a pair-finder can see". */
  faceSpans: [[number, number][], [number, number][]];
};

type Jn = { kind: "L" | "T-branch" | "T-through" | "X"; other: Wall; at: number };

const EPS = 0.02;

function junctions(w: Wall, all: readonly Wall[]): Jn[] {
  if (w.arc) return [];
  const L = len(sub(w.b, w.a));
  const u = unit(sub(w.b, w.a));
  const out: Jn[] = [];
  for (const o of all) {
    if (o === w || o.arc) continue;
    const Lo = len(sub(o.b, o.a));
    const uo = unit(sub(o.b, o.a));
    const t = crossParam(w.a, u, o.a, uo);
    const to = crossParam(o.a, uo, w.a, u);
    if (t === null || to === null) continue;
    const wEnd = Math.abs(t) < EPS || Math.abs(t - L) < EPS;
    const wIn = t > EPS && t < L - EPS;
    const oEnd = Math.abs(to) < EPS || Math.abs(to - Lo) < EPS;
    const oIn = to > EPS && to < Lo - EPS;
    if (wEnd && oEnd) out.push({ kind: "L", other: o, at: t });
    else if (wEnd && oIn) out.push({ kind: "T-branch", other: o, at: t });
    else if (wIn && oEnd) out.push({ kind: "T-through", other: o, at: t });
    else if (wIn && oIn) out.push({ kind: "X", other: o, at: t });
  }
  return out;
}

/** Subtract gap intervals from a span list. */
function cut(spans: [number, number][], gap: [number, number]): [number, number][] {
  const out: [number, number][] = [];
  for (const [s, e] of spans) {
    if (gap[1] <= s || gap[0] >= e) {
      out.push([s, e]);
      continue;
    }
    if (gap[0] > s) out.push([s, gap[0]]);
    if (gap[1] < e) out.push([gap[1], e]);
  }
  return out.filter(([s, e]) => e - s > 1e-6);
}

/** The side of `o` that `w`'s body is on: +1 or -1 along `o`'s normal. */
function sideOf(o: Wall, w: Wall, wEndAt: number): number {
  const no = normal(unit(sub(o.b, o.a)));
  const far = wEndAt < EPS ? w.b : w.a;
  return Math.sign(dot(sub(far, o.a), no)) || 1;
}

/**
 * The plan drawing of one straight wall, with the cleanup a CAD program does at
 * junctions: an L's outer faces meet and inner faces meet; a T's branch stops at
 * the through-wall's face and that face is broken across the branch's mouth; an
 * X breaks every face; a column breaks or stops a wall; an opening breaks every
 * line and gets jamb caps.
 */
export function drawWall(w: Wall, level: Level, extraWalls: readonly Wall[] = []): WallDrawing {
  const all = [...level.walls, ...extraWalls].filter((x) => x.demo === w.demo && x.hiddenLayer === w.hiddenLayer);
  const L = len(sub(w.b, w.a));
  const u = unit(sub(w.b, w.a));
  const n = normal(u);
  const type = PARTITION_TYPES[w.type];
  const offsets = type.planLines.map((inches) => inches / 12);

  // Per-offset start/end params, defaulting to the centreline ends.
  const start = offsets.map(() => 0);
  const end = offsets.map(() => L);
  const gaps: [number, number][][] = offsets.map(() => []);
  const capped = { start: true, end: true };

  const faceLine = (wall: Wall, off: number) => {
    const uu = unit(sub(wall.b, wall.a));
    return { o: add(wall.a, mul(normal(uu), off)), u: uu };
  };

  for (const j of junctions(w, all)) {
    const o = j.other;
    const to = thicknessFt(o);
    const oLine = (off: number) => faceLine(o, off);
    const atStart = j.at < L / 2;
    if (j.kind === "T-branch") {
      const side = sideOf(o, w, j.at);
      const target = oLine((side * to) / 2);
      offsets.forEach((off, i) => {
        const tt = crossParam(add(w.a, mul(n, off)), u, target.o, target.u);
        if (tt === null) return;
        if (atStart) start[i] = tt;
        else end[i] = tt;
      });
      capped[atStart ? "start" : "end"] = false;
    } else if (j.kind === "L") {
      const uo = unit(sub(o.b, o.a));
      const oStartsHere = len(sub(o.a, add(w.a, mul(u, j.at)))) < 0.05;
      const dO = oStartsHere ? uo : mul(uo, -1);
      const dW = atStart ? u : mul(u, -1);
      const sigma = Math.sign(dot(normal(uo), dW)) || 1;
      offsets.forEach((off, i) => {
        const inner = dot(mul(n, Math.sign(off) || 1), dO) > 0;
        const oOff = inner ? (sigma * to) / 2 : (-sigma * to) / 2;
        const target = oLine(oOff);
        const tt = crossParam(add(w.a, mul(n, off)), u, target.o, target.u);
        if (tt === null) return;
        if (atStart) start[i] = tt;
        else end[i] = tt;
      });
      capped[atStart ? "start" : "end"] = false;
    } else {
      // T-through (only the face on the branch's side breaks) or X (both).
      const hit = add(w.a, mul(u, j.at));
      const far = len(sub(o.a, hit)) < len(sub(o.b, hit)) ? o.b : o.a;
      const branchSide = Math.sign(dot(sub(far, hit), n)) || 1;
      offsets.forEach((off, i) => {
        if (j.kind !== "X" && Math.sign(off) !== branchSide) return;
        const a1 = oLine(to / 2);
        const a2 = oLine(-to / 2);
        const t1 = crossParam(add(w.a, mul(n, off)), u, a1.o, a1.u);
        const t2 = crossParam(add(w.a, mul(n, off)), u, a2.o, a2.u);
        if (t1 === null || t2 === null) return;
        gaps[i].push([Math.min(t1, t2), Math.max(t1, t2)]);
      });
    }
  }

  // Columns: a wall whose centreline passes through one is broken there, and a
  // wall that ends inside one stops at its face.
  const h = COLUMN_SIZE_FT / 2;
  for (const c of level.columns) {
    const rel = sub(c, w.a);
    const along = dot(rel, u);
    const across = Math.abs(dot(rel, n));
    if (across > h + 1e-6) continue;
    const axisAligned = Math.abs(u.x) < 1e-6 || Math.abs(u.y) < 1e-6;
    if (!axisAligned) continue;
    const g: [number, number] = [along - h, along + h];
    if (g[1] < 0 || g[0] > L) continue;
    if (g[0] <= 0) {
      offsets.forEach((_, i) => (start[i] = Math.max(start[i], g[1])));
      capped.start = false;
    } else if (g[1] >= L) {
      offsets.forEach((_, i) => (end[i] = Math.min(end[i], g[0])));
      capped.end = false;
    } else {
      offsets.forEach((_, i) => gaps[i].push(g));
    }
  }

  // Openings in this wall.
  const caps: number[] = [];
  for (const op of openingsIn(w, level)) {
    const along = dot(sub(op.at, w.a), u);
    const g: [number, number] = [along - op.widthFt / 2, along + op.widthFt / 2];
    offsets.forEach((_, i) => gaps[i].push(g));
    caps.push(g[0], g[1]);
  }
  if (capped.start) caps.push(Math.min(...start));
  if (capped.end) caps.push(Math.max(...end));

  const lines: FaceRun[] = offsets.map((off, i) => {
    let spans: [number, number][] = [[start[i], end[i]]];
    for (const g of gaps[i]) spans = cut(spans, g);
    return { offsetFt: off, spans };
  });

  const outerPlus = offsets.indexOf(Math.max(...offsets));
  const outerMinus = offsets.indexOf(Math.min(...offsets));
  return { wall: w, lines, caps, faceSpans: [lines[outerPlus].spans, lines[outerMinus].spans] };
}

/** Openings whose centre lies on this wall's centreline. */
export function openingsIn(w: Wall, level: Level): Opening[] {
  if (w.arc) return [];
  const L = len(sub(w.b, w.a));
  const u = unit(sub(w.b, w.a));
  const n = normal(u);
  return level.openings.filter((op) => {
    const rel = sub(op.at, w.a);
    const along = dot(rel, u);
    return Math.abs(dot(rel, n)) < 0.05 && along > 0 && along < L;
  });
}

/** Total length of a span list. */
export const spanLength = (spans: [number, number][]) => spans.reduce((s, [a, b]) => s + (b - a), 0);

/** Overlap of two span lists: what a perfect two-face pair-finder can claim. */
export function spanOverlap(a: [number, number][], b: [number, number][]): number {
  let total = 0;
  for (const [s1, e1] of a) for (const [s2, e2] of b) total += Math.max(0, Math.min(e1, e2) - Math.max(s1, s2));
  return total;
}
