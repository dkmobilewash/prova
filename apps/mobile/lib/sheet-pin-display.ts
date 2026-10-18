import type { SheetPinRow, SheetRow } from "./types";

/**
 * WHAT A SHEET SHOWS WHILE THE PHONE IS STILL HOLDING SOME OF IT.
 *
 * Pure, and extracted from the screen for one reason: the screen test harness
 * can read text but cannot tap, so none of this is reachable from there. The
 * rules below are the ones that decide whether a foreman standing in a
 * basement believes the app saved anything, and "it looked right when I tried
 * it" is not a check — so they live here where they can be asserted.
 */

/** A pin this phone has queued but not sent. It carries the page it belongs
 * to, because the screen can be moved between sheets while the queue is full. */
export type HeldPin = SheetPinRow & { pageId: string };

/**
 * The pins to draw on one sheet: what the office has, then what this phone is
 * still holding.
 *
 * ONE LIST, so the overlay and the words beneath it cannot disagree about how
 * many marks are on the drawing — a dot with no row, or a row with no dot, is
 * a foreman counting something twice on a GC call.
 */
export function pinsOn(sheet: SheetRow, held: HeldPin[]): SheetPinRow[] {
  return [...sheet.pins, ...held.filter((pin) => pin.pageId === sheet.id)];
}

/**
 * How many marks a sheet tab should claim.
 *
 * HELD PINS COUNT. Without them, placing a pin with no signal leaves the
 * number unchanged — and a number that does not move is how somebody decides
 * the tap did not register and taps again.
 */
export function pinCount(sheet: SheetRow, held: HeldPin[]): number {
  return sheet.pins.length + held.filter((pin) => pin.pageId === sheet.id).length;
}

/**
 * Which held pins the office now has, so the phone can stop holding them.
 *
 * MATCHED ON PAGE AND WORDS, NOT ON ID, and that is forced rather than chosen:
 * a queued pin has no server id until it lands, so there is nothing else to
 * match on.
 *
 * **IT COUNTS RATHER THAN MATCHING A SET, AND THAT IS THE WHOLE CARE IN THIS
 * FUNCTION.** The first version used a `Set` of `page:words`, so two notes
 * with the SAME words on the SAME sheet were both released the moment ONE of
 * them came back from the server — silently dropping a pin the office had
 * never seen, which is the exact defect this queue exists to prevent. Found by
 * writing the test for it rather than by reading the code.
 *
 * So each landed pin releases exactly ONE held pin. The leftover stays held
 * until its own copy comes back. The failure left is cosmetic — a pin drawn
 * twice until the next refresh — and that is the direction to fail in.
 */
export function stillHeld(sheets: SheetRow[], held: HeldPin[]): HeldPin[] {
  const remaining = new Map<string, number>();
  for (const row of sheets) {
    for (const pin of row.pins) {
      const key = `${row.id}:${pin.note ?? ""}`;
      remaining.set(key, (remaining.get(key) ?? 0) + 1);
    }
  }
  return held.filter((pin) => {
    const key = `${pin.pageId}:${pin.note ?? ""}`;
    const left = remaining.get(key) ?? 0;
    if (left > 0) {
      remaining.set(key, left - 1);
      return false; // this one landed
    }
    return true;
  });
}

/** Is this one of the pins the phone has not sent yet? */
export function isHeld(id: string, held: HeldPin[]): boolean {
  return held.some((pin) => pin.id === id);
}
