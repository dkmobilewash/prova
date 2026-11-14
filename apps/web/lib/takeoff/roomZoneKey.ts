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

/** A heights-key type entry (heights-key-r16.json): one height, zones, or the same as another type. */
export type HeightsKeyType = { feet?: number; basis?: string; zones?: { zone: string; kind: string; feet: unknown }[]; excluded?: boolean; sameAs?: string };

/** "C6" → the key's "C" when the key has no "C6" (the letter's entry, as the round-14 scorer did). */
export function keyTypeFor<T extends HeightsKeyType>(types: Record<string, T>, code: string): [string, T] | null {
  const letter = /^([A-Z]+)\d+$/i.exec(code)?.[1];
  const found = types[code] ? code : letter && types[letter] ? letter : null;
  if (found === null) return null;
  // "IW-4": { sameAs: "IW-1" } is IW-1's height.
  const t = types[found]!;
  return t.sameAs && types[t.sameAs] ? [found, { ...types[t.sameAs]!, excluded: t.excluded ?? types[t.sameAs]!.excluded }] : [found, t];
}
