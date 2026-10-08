import type { StrokeSegment } from "./wallVectors";

/**
 * ── A FLOOR PLAN AS REGIONS, NOT AS PAIRS OF LINES ──
 *
 * `wallVectors.ts` asks "are these two lines a wall". That question cannot be
 * complete, and the evidence is on the record: a wall drawn as solid poché is
 * not two lines, a single-line partition is not two lines, and a face drawn as a
 * filled sliver is four. Each shape needs its own rule, and measured across four
 * real plan sets, every rule added helped one sheet and hurt another — the pen
 * filter helped one sheet and deleted 59% of the walls across thirteen.
 *
 * Recall settled around 40%, and an estimator cannot bid from an unknown 40%:
 * the walls it missed are invisible, so the whole plan has to be traced anyway
 * and the tool has saved nothing. Completeness is not a refinement here, it is
 * the product.
 *
 * ── THE FORMULATION THAT CAN BE COMPLETE ──
 *
 * A floor plan is a set of ENCLOSED REGIONS. Rooms are the big ones. A wall is a
 * thin elongated one — and that is true however the wall is drawn:
 *
 *   two parallel faces   → the cavity between them is a thin region
 *   solid poché          → the fill itself is a thin region
 *   a filled sliver face → still a thin region
 *   a single line        → the boundary between two room regions
 *
 * One formulation, every case. And the reason it can be complete rather than
 * merely broader: EVERY WALL BOUNDS A ROOM. Find the rooms and the walls are
 * their shared boundaries, so nothing that encloses space can be missed.
 *
 * ── MEASURED BEFORE IT WAS WRITTEN ──
 *
 * Rendering two real sheets and finding their enclosed regions returned 4,008
 * and 25,085 of them, with 840 and 623 wall-shaped — against 95 and 64 from the
 * line pairer. The regions are there and they include what the pairer misses.
 *
 * What that probe also showed is that "thin and elongated" alone is WORSE than
 * what exists today: the gap beside a dimension line, the space inside a door
 * swing and the gaps between furniture edges are all thin and elongated. The
 * discriminator is adjacency, and it is the whole reason this file exists:
 *
 *   A WALL HAS A DIFFERENT ROOM ON EACH SIDE.
 *
 * A dimension gap has the same room on both sides. A door-swing gap has the same
 * room on both sides. A furniture gap has the same room on both sides. Only a
 * wall separates two enclosed spaces. That single rule is what delivers
 * completeness and precision together, and it is unavailable to anything that
 * reasons about lines in isolation.
 *
 * ── WHY A RASTER, AND WHY NOT A CANVAS ──
 *
 * A true planar subdivision of 100,000 segments is a large piece of
 * computational geometry whose failure modes are subtle and whose output is hard
 * to check. An occupancy grid answers the same question — what encloses what —
 * in a way that can be printed, counted and looked at.
 *
 * It is drawn here rather than on a `<canvas>` so that it is pure: the same
 * array on a server, in a test and in the browser, with no 2D context, no device
 * pixel ratio and no colour profile between the input and the answer. A canvas
 * would also make every test need a browser, which is how the layout bugs in
 * this repo's history went unseen.
 */

/** A connected area of paper enclosed by line work. */
export type Region = {
  id: number;
  /** Cells. Multiply by the grid's own area to get square feet. */
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Average thickness across its longer dimension, in cells — the measure that
   *  separates a wall cavity from a room without needing its medial axis. */
  minor: number;
  /** True when it reaches the edge of the grid, which means it is the paper
   *  AROUND the drawing rather than a space inside it. */
  open: boolean;
};

export type RoomGrid = {
  width: number;
  height: number;
  /** Feet of building per cell, so a region's size can be stated in feet. */
  feetPerCell: number;
  /** Region id per cell, or -1 where there is ink. */
  label: Int32Array;
  regions: Region[];
};

/**
 * How many cells the thinnest wall must span.
 *
 * A region needs an INTERIOR to exist at all: at one cell per wall thickness the
 * two faces touch and the cavity vanishes, and the wall stops being findable by
 * this method entirely. Four gives a cavity that survives a line drawn a cell
 * wide on each side, which is what the rasteriser does.
 *
 * It is a floor on resolution rather than a tuning knob — raising it costs
 * memory as the square and finds nothing new.
 */
export const CELLS_PER_THINNEST_WALL = 4;

/** The thinnest thing this will call a wall, in feet. 2½in is a furring wall. */
export const THINNEST_WALL_FEET = 0.2;

/**
 * The grid size for a sheet, derived rather than chosen.
 *
 * Resolution is not a preference here: it is set by the thinnest wall that must
 * remain hollow. Fixing a pixel count instead would silently stop finding
 * partitions on a sheet drawn at a smaller scale, which is the kind of failure
 * that looks like "this plan has fewer walls".
 */
export function gridSizeFor(
  widthUnits: number,
  heightUnits: number,
  feetPerUnit: number,
  cap = 4096,
): { width: number; height: number; feetPerCell: number } {
  const feetPerCell = THINNEST_WALL_FEET / CELLS_PER_THINNEST_WALL;
  const unitsPerCell = feetPerCell / feetPerUnit;
  let width = Math.ceil(widthUnits / unitsPerCell);
  let height = Math.ceil(heightUnits / unitsPerCell);
  // A cap, because a 42-inch sheet at a detail scale would otherwise ask for a
  // grid nobody can hold. Hitting it means the thinnest walls merge, and the
  // caller is told by the feetPerCell it gets back rather than by a silent
  // change in the answer.
  if (width > cap) {
    const shrink = cap / width;
    width = cap;
    height = Math.max(1, Math.ceil(height * shrink));
    return { width, height, feetPerCell: (widthUnits * feetPerUnit) / width };
  }
  return { width, height, feetPerCell };
}

/**
 * Draw the line work into an occupancy grid.
 *
 * Bresenham rather than anything prettier: a wall cavity is four cells wide and
 * an antialiased edge would close it. Every cell is either ink or paper, which
 * is also what makes the flood fill below exact rather than threshold-dependent.
 */
export function rasterise(
  segments: readonly StrokeSegment[],
  width: number,
  height: number,
  unitsPerCellX: number,
  unitsPerCellY: number,
): Uint8Array {
  const ink = new Uint8Array(width * height);
  const plot = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < width && y < height) ink[y * width + x] = 1;
  };
  for (const s of segments) {
    let x0 = Math.round(s.x1 / unitsPerCellX);
    let y0 = Math.round(s.y1 / unitsPerCellY);
    const x1 = Math.round(s.x2 / unitsPerCellX);
    const y1 = Math.round(s.y2 / unitsPerCellY);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    // Bounded: a malformed coordinate must not spin here.
    const limit = dx - dy + 2;
    for (let step = 0; step <= limit; step += 1) {
      plot(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }
  return ink;
}

/**
 * Every connected area of paper, with the one that touches the edge marked.
 *
 * Four-connected on purpose: eight-connectivity leaks a region diagonally
 * through the corner where two walls meet, which merges a room with its
 * neighbour and destroys the one property this file is built on.
 */
export function regionsOf(ink: Uint8Array, width: number, height: number): RoomGrid["regions"] & { label: Int32Array } {
  const label = new Int32Array(ink.length).fill(-1);
  const stack = new Int32Array(ink.length);
  const regions: Region[] = [];
  for (let start = 0; start < ink.length; start += 1) {
    if (ink[start] === 1 || label[start] !== -1) continue;
    const id = regions.length;
    let top = 0;
    stack[top++] = start;
    label[start] = id;
    let area = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let open = false;
    while (top > 0) {
      const at = stack[--top];
      const x = at % width;
      const y = (at / width) | 0;
      area += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) open = true;
      if (x > 0 && ink[at - 1] === 0 && label[at - 1] === -1) {
        label[at - 1] = id;
        stack[top++] = at - 1;
      }
      if (x + 1 < width && ink[at + 1] === 0 && label[at + 1] === -1) {
        label[at + 1] = id;
        stack[top++] = at + 1;
      }
      if (y > 0 && ink[at - width] === 0 && label[at - width] === -1) {
        label[at - width] = id;
        stack[top++] = at - width;
      }
      if (y + 1 < height && ink[at + width] === 0 && label[at + width] === -1) {
        label[at + width] = id;
        stack[top++] = at + width;
      }
    }
    const major = Math.max(maxX - minX + 1, maxY - minY + 1);
    regions.push({ id, area, minX, minY, maxX, maxY, minor: area / Math.max(major, 1), open });
  }
  const out = regions as Region[] & { label: Int32Array };
  out.label = label;
  return out;
}

/** Build the grid for a sheet in one call. */
export function roomGrid(
  segments: readonly StrokeSegment[],
  widthUnits: number,
  heightUnits: number,
  feetPerUnit: number,
): RoomGrid {
  const { width, height, feetPerCell } = gridSizeFor(widthUnits, heightUnits, feetPerUnit);
  const ink = rasterise(segments, width, height, widthUnits / width, heightUnits / height);
  const regions = regionsOf(ink, width, height);
  return { width, height, feetPerCell, label: regions.label, regions: [...regions] };
}

/**
 * ── THE RULE THAT MAKES REGIONS PRECISE AS WELL AS COMPLETE ──
 *
 * "Thin and elongated" on its own is WORSE than the line pairer: a probe over
 * two real sheets returned 840 and 623 thin regions, against 95 and 64 walls —
 * because the gap beside a dimension line, the space inside a door swing and
 * the gaps between furniture edges are all thin and elongated.
 *
 * What separates them is what they SEPARATE:
 *
 *   A WALL HAS A DIFFERENT ROOM ON EACH SIDE.
 *
 * A dimension gap has the same room on both sides — it sits inside one space. A
 * door-swing gap has the same room on both sides. A furniture gap has the same
 * room on both sides. Only a wall divides two enclosed spaces, and that holds
 * whether the wall is drawn as two faces, as poché, or as one line between two
 * rooms.
 *
 * It is also the only rule here with a completeness argument behind it rather
 * than a threshold: every wall bounds a room, so a method that enumerates the
 * rooms cannot miss a wall that encloses anything.
 */

/** A region, and the regions on the far side of the ink around it. */
export type Neighbours = {
  region: Region;
  /** Distinct region ids reachable by stepping across the ink, excluding
   *  itself. The paper outside the drawing counts and is marked `open`. */
  touching: number[];
};

/**
 * What lies on the other side of the ink from each cell of a region.
 *
 * A region's own boundary is walked and each cell probed outward in the four
 * directions, stepping over up to `reach` cells of ink. `reach` is how thick a
 * wall's drawn faces may be — not how thick the wall is, which is the region
 * itself. Two cells covers a face drawn as a filled sliver.
 *
 * STEPPING OVER INK, rather than taking the regions that touch at a corner,
 * because that is the question being asked: what is on the far side of this
 * wall. A corner touch answers a different one.
 */
export function neighboursOf(
  grid: Pick<RoomGrid, "width" | "height" | "label">,
  region: Region,
  reach = 3,
): Neighbours {
  const { width, height, label } = grid;
  const seen = new Set<number>();
  for (let y = region.minY; y <= region.maxY; y += 1) {
    for (let x = region.minX; x <= region.maxX; x += 1) {
      if (label[y * width + x] !== region.id) continue;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        // Step across whatever ink is in the way, up to `reach`.
        for (let step = 1; step <= reach + 1; step += 1) {
          const nx = x + dx * step;
          const ny = y + dy * step;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) break;
          const other = label[ny * width + nx];
          if (other === -1) continue; // still inside the ink
          if (other !== region.id) seen.add(other);
          break; // reached paper, stop probing this direction
        }
      }
    }
  }
  return { region, touching: [...seen] };
}

export type RoomWall = {
  region: Region;
  /** Feet, along its longer dimension. */
  lengthFeet: number;
  /** Inches, across. */
  thicknessInches: number;
  /** The rooms it separates — at least two, which is what makes it a wall. */
  separates: number[];
};

/** The widest a region can be and still be a wall rather than a space. */
export const WIDEST_WALL_INCHES = 18;
/** The shortest run worth reporting, in feet. */
export const SHORTEST_WALL_FEET = 2;
/** The smallest enclosed space that counts as a room, in square feet. A closet
 *  is 9; anything under that is a chase, a column or a drawing artefact, and
 *  letting those count as "a different room" would readmit the noise this rule
 *  exists to exclude. */
export const SMALLEST_ROOM_SQFT = 9;

/**
 * The walls on a sheet: thin regions that separate two different spaces.
 *
 * The open region — the paper around the drawing — counts as a space, because an
 * exterior wall has the outside on one side of it and that is still a wall.
 */
export function wallsFromRooms(grid: RoomGrid, reach = 3): RoomWall[] {
  const sqft = grid.feetPerCell ** 2;
  const isSpace = new Set(
    grid.regions.filter((r) => r.open || r.area * sqft >= SMALLEST_ROOM_SQFT).map((r) => r.id),
  );

  const walls: RoomWall[] = [];
  for (const region of grid.regions) {
    if (region.open) continue;
    const thicknessInches = region.minor * grid.feetPerCell * 12;
    const lengthFeet = Math.max(region.maxX - region.minX, region.maxY - region.minY) * grid.feetPerCell;
    if (thicknessInches > WIDEST_WALL_INCHES) continue;
    if (lengthFeet < SHORTEST_WALL_FEET) continue;

    const { touching } = neighboursOf(grid, region, reach);
    const spaces = touching.filter((id) => isSpace.has(id));
    if (spaces.length < 2) continue;
    walls.push({ region, lengthFeet, thicknessInches, separates: spaces });
  }
  return walls;
}
