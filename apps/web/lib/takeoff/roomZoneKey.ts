import { parseFeetInches } from "@/lib/feet-inches";

/**
 * ── THE ZONE KEYS: WHICH ROOM SITS IN WHICH HEIGHT ZONE (training, coordination/*-room-parts-key.md) ──
 *
 * A zoned set's walls do not all go to one height: Joplin's run to the structure of the roof over
 * them (LOWER 12'-0", ADMIN 12'-4", CENTRAL 16'-8"), Bunkie's to its building's (MAIN 10'-0",
 * WAREHOUSE 14'-4"), SW's to its area's ceiling (8'-0", 9'-6", 12'-0", 13'-6"). Chrome keyed each
 * set room by room, one row per room: `room | name | zone[ height] | evidence`.
 *
 * This reads all three the same way: room number → its zone and, where the row prints one, its
 * height. A zone with no height in the row (Joplin's parts) takes the heights key's figure for that
 * zone, matched by name (`zoneFeet`). A row whose zone is "can't tell" is left out, so a wall in that
 * room is not scored rather than scored against a guess.
 */
export type RoomZone = { zone: string; feet: number | null };

/** "MAIN 10'-0"" → { zone: "MAIN", feet: 10 }; "12'-0"" → { zone: "12'-0"", feet: 12 }; "CENTRAL" → { zone: "CENTRAL", feet: null }. */
export function zoneCell(cell: string): RoomZone | null {
  const text = cell.trim();
  if (text === "" || /can'?t tell/i.test(text)) return null;
  const printed = /(\d+'\s*-?\s*\d*(?:\s+\d+\/\d+)?"?)/.exec(text);
  const feet = printed === null ? null : parseFeetInches(printed[1]!.replace(/\s+/g, ""));
  const name = printed === null ? text : text.replace(printed[1]!, "").trim();
  return { zone: name === "" ? text : name.toUpperCase(), feet: feet !== null && feet.ok ? feet.n : null };
}

/** Every keyed room in one zone key's text. Room numbers are kept as printed ("E105", "138.2"). */
export function parseRoomZoneKey(markdown: string): Map<string, RoomZone> {
  const out = new Map<string, RoomZone>();
  for (const line of markdown.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 3 || !/^[A-Z]?\d+(?:\.\d+)?[A-Z]?$/i.test(cells[0]!)) continue;
    const zone = zoneCell(cells[2]!);
    if (zone !== null) out.set(cells[0]!.toUpperCase(), zone);
  }
  return out;
}

/** A zone's height from the heights key's zones for the wall's type, matched by the zone's name ("LOWER" → "lower roofs"). */
export function zoneFeet(zone: RoomZone, keyZones: readonly { zone: string; feet: unknown }[]): number | null {
  if (zone.feet !== null) return zone.feet;
  const name = zone.zone.toLowerCase();
  const hit = keyZones.find((z) => z.zone.toLowerCase().startsWith(name) && typeof z.feet === "number");
  return hit === undefined ? null : (hit.feet as number);
}

/**
 * The key's height for a wall from the rooms either side of it: one figure when every keyed room
 * beside it agrees, else null (a wall between two zones, or beside no keyed room, is not scored).
 */
export function wallKeyHeight(sideRooms: readonly (string | null)[], key: ReadonlyMap<string, RoomZone>, keyZones: readonly { zone: string; feet: unknown }[] = []): { feet: number; zone: string } | null {
  const found = sideRooms
    .filter((n): n is string => n !== null)
    .map((n) => key.get(n.toUpperCase()))
    .filter((z): z is RoomZone => z !== undefined)
    .map((z) => ({ zone: z.zone, feet: zoneFeet(z, keyZones) }))
    .filter((z): z is { zone: string; feet: number } => z.feet !== null);
  const heights = [...new Set(found.map((z) => Math.round(z.feet * 12)))];
  return heights.length === 1 ? found[0]! : null;
}

/**
 * A heights-key type entry (heights-key-r16.json; r19 adds the last two flags):
 * one height, zones, or the same as another type.
 *
 * `needsAnswer` (Diego's H4, 2026-11-19): the drawing sends this type "to deck /
 * structure" with NO printed elevation, or states no rule at all — the true
 * height cannot be read from the documents, so the key must NOT price it at a
 * default. It scores on LF and type only; its board $ leaves both key and
 * posted totals and is reported on the HEIGHT NEEDS CONTRACTOR ANSWER line.
 *
 * `noBoard` (H5): the assembly carries no gypsum (bare CMU) — never board $.
 */
export type HeightsKeyType = { feet?: number; basis?: string; zones?: { zone: string; kind: string; feet: unknown; sheets?: string[] }[]; excluded?: boolean; sameAs?: string; needsAnswer?: boolean; noBoard?: boolean };

/** "C6" → the key's "C" when the key has no "C6" (the letter's entry, as the round-14 scorer did). */
export function keyTypeFor<T extends HeightsKeyType>(types: Record<string, T>, code: string): [string, T] | null {
  const letter = /^([A-Z]+)\d+$/i.exec(code)?.[1];
  const found = types[code] ? code : letter && types[letter] ? letter : null;
  if (found === null) return null;
  // "IW-4": { sameAs: "IW-1" } is IW-1's height.
  const t = types[found]!;
  return t.sameAs && types[t.sameAs] ? [found, { ...types[t.sameAs]!, excluded: t.excluded ?? types[t.sameAs]!.excluded }] : [found, t];
}

/**
 * ── THE KEY'S PRICE FOR ONE KEY WALL (zero-touch's key side, Diego 2026-11-17) ──
 *
 * The heights key stopped being one scalar per type: a type can be priced by the SHEET it is on
 * (Hutto's levels, kind "sheet" naming its sheets), by the ROOM ZONE beside the wall (Joplin,
 * kind "room", through the set's zone key), or by a plain figure. In that order — a zone is more
 * specific than the type's own scalar (Joplin K prices 9 ft except in the rooms its zone names).
 * A wall whose zones cannot resolve (no zone key, rooms disagree, no keyed room beside it) prices
 * at the default and says so, so the ZTBOARD worklist keeps naming it instead of hiding it.
 */
export type KeyWallFrom = "scalar" | "sheet-zone" | "room-zone" | "default" | "zone-unresolved" | "needs-answer" | "no-board";
export function keyWallFeet(input: {
  code: string;
  types: Record<string, HeightsKeyType>;
  sheet: string;
  sideRoomNumbers: readonly (string | null)[];
  zoneKey: ReadonlyMap<string, RoomZone> | null;
  defaultFeet: number;
}): { feet: number; from: KeyWallFrom } {
  const hit = keyTypeFor(input.types, input.code.toUpperCase());
  if (hit === null || hit[1].excluded) return { feet: input.defaultFeet, from: "default" };
  const t = hit[1];
  // Feet 0 so no board SF accrues; the caller reads `from` to route the LF to
  // its own line instead of the default-height bucket. Checked before zones
  // and scalars: a type Diego ruled unknowable stays unknowable even if an
  // older revision carried a number for it.
  if (t.noBoard) return { feet: 0, from: "no-board" };
  if (t.needsAnswer) return { feet: 0, from: "needs-answer" };
  const zones = t.zones ?? [];
  const sheetZone = zones.find((z) => z.kind === "sheet" && (z.sheets ?? []).includes(input.sheet) && typeof z.feet === "number");
  if (sheetZone !== undefined) return { feet: sheetZone.feet as number, from: "sheet-zone" };
  const roomZones = zones.filter((z) => z.kind !== "sheet");
  if (roomZones.length > 0 && input.zoneKey !== null) {
    const h = wallKeyHeight(input.sideRoomNumbers, input.zoneKey, roomZones);
    if (h !== null) return { feet: h.feet, from: "room-zone" };
  }
  if (typeof t.feet === "number") return { feet: t.feet, from: "scalar" };
  return { feet: input.defaultFeet, from: zones.length > 0 ? "zone-unresolved" : "default" };
}

/**
 * A heights-key set's types, LOADED for pricing: keys uppercased (plan codes compare uppercase) and
 * `sameAs` chains materialized to 5 hops, so `keyTypeFor`'s single hop sees a finished entry — the
 * r16 flat loader did both and 35 entries depended on it.
 */
export function loadKeyTypes(raw: Record<string, HeightsKeyType>): Record<string, HeightsKeyType> {
  const up: Record<string, HeightsKeyType> = {};
  for (const [k, v] of Object.entries(raw)) up[k.toUpperCase()] = { ...v, ...(v.sameAs === undefined ? {} : { sameAs: v.sameAs.toUpperCase() }) };
  const out: Record<string, HeightsKeyType> = {};
  for (const [k, v] of Object.entries(up)) {
    let t = v;
    for (let hop = 0; hop < 5 && t.sameAs !== undefined; hop += 1) {
      const ref = up[t.sameAs];
      if (ref === undefined) break;
      t = { ...ref, excluded: t.excluded ?? ref.excluded };
    }
    out[k] = { ...t, sameAs: undefined } as HeightsKeyType;
  }
  return out;
}
