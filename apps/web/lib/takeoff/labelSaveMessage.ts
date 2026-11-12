/**
 * ── "SAVED N" IS WHAT THE FILE HOLDS ──
 *
 * The answer key said "Saved 164 decisions" on Bluetooth AI101 while the file held 163 (Chrome,
 * 2026-11-11). The number was the browser's own sum of what it sent — new verdicts plus the hidden
 * ones carried — and nothing checked it against the file. Now the route says how many verdicts it
 * WROTE and the line reports that; if the two ever differ, the line says so instead of hiding it.
 */
export function labelSaveMessage(input: { sent: number; written: number | undefined; path: string | undefined }): string {
  const n = input.written ?? input.sent;
  const where = input.path === undefined ? "" : ` to ${input.path}`;
  const differs = input.written !== undefined && input.written !== input.sent;
  return `Saved ${n} decision${n === 1 ? "" : "s"}${where}` + (differs ? ` (${input.sent} were sent: check the file)` : "");
}
