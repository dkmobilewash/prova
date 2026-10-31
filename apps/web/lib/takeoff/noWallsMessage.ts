/**
 * ── WHAT THE FOUND-WALLS PANEL SAYS WHEN IT IS EMPTY ──
 *
 * THREE KINDS OF EMPTY, NOT TWO. Accepting a group moves its runs onto the
 * measurements and takes it off the panel, so once the last one is added the
 * panel is empty — and it used to say "No walls found… none of it paired up as
 * a wall" directly under the walls it had just found (a user walk, 2026-10-19).
 * An empty panel after a find that produced groups is the panel being DONE,
 * not the finder failing.
 *
 * A plain module rather than inline copy because the state is unreachable from
 * a DOM test — the panel only exists after pdf.js has read a real sheet — so
 * the sentence needs a caller a test can be.
 */
export function noWallsMessage({
  strokesSeen,
  groupsAdded,
}: {
  /** Line segments the last find read off the sheet. */
  strokesSeen: number;
  /** Groups from the last find on THIS sheet that were added to the measurements. */
  groupsAdded: number;
}): string {
  if (groupsAdded > 0) {
    return (
      `Every wall found here is on your measurements — ${groupsAdded} group${groupsAdded === 1 ? "" : "s"} added. ` +
      "Anything the finder missed, trace by hand as usual."
    );
  }
  if (strokesSeen === 0) {
    return "No walls found: this sheet has no line work at all, so it is an image or a scan. There is nothing here to read. Trace them by hand as usual.";
  }
  return `No walls found. This sheet does have line work — ${strokesSeen.toLocaleString()} lines — but none of it paired up as a wall. That happens when walls are drawn as a single line or as solid fill rather than two faces. Trace them by hand as usual.`;
}
