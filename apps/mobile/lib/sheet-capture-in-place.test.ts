import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A PHOTO AND THE PIN IT WAS TAKEN FOR TRAVEL AS ONE REQUEST.
 *
 * **Not a preference — the queue forbids the alternative.** `drain` runs its
 * ops INDEPENDENTLY and deliberately: it skips a not-yet-due op and carries
 * on, and its own comment says why — *"a day of time can sit behind a photo.
 * OFF-32: never drop time, and never let it be blocked behind something
 * else."* There is no way to say "this pin after that photo", and building one
 * would fight the scar that rule exists for.
 *
 * So two ops is not a slower design, it is a **broken** one: the pin op could
 * run first and have no photo to point at, or the photo could be refused (413,
 * 410) while the pin goes through and points at nothing. One op makes both
 * rows or neither.
 *
 * The decisive mutation is to split them, and it goes red here.
 *
 * This is a presence census and cannot prove a photo ever reaches the server.
 * What it holds is the shape, which is the part that is expensive to get wrong
 * and cheap to break.
 */

const QUEUE = join(__dirname, "sync-queue.ts");

function code(): string {
  return readFileSync(QUEUE, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("capture-in-place sends the photo and its pin together", () => {
  const text = code();

  it("carries the sheet position on the media op itself", () => {
    const media = text.slice(text.indexOf('type: "media:create"'));
    const body = media.slice(0, media.indexOf("| ("));
    for (const field of ["sheetPageId", "pinX", "pinY"]) {
      expect(body, `the media op no longer carries ${field}`).toContain(field);
    }
  });

  it("sends them with the upload, not as a separate call", () => {
    expect(text, "the upload no longer carries the sheet page").toMatch(/parameters\.sheetPageId = op\.sheetPageId/);
    expect(text, "the upload no longer carries the pin position").toMatch(/parameters\.pinX = String\(op\.pinX\)/);
  });

  it("captures in place by opening the camera, never by queuing a second op", () => {
    // THE PREMISE THIS TEST STARTED WITH WAS TOO STRONG, and the first run
    // caught it. `sheet-pin:create` is allowed to carry a `mediaId`: pinning a
    // photo that is ALREADY on the server has no ordering problem at all, and
    // that is a reasonable thing to build later.
    //
    // The invariant is narrower. It is the CAPTURE flow that must not split:
    // a photo being taken right now does not exist yet, so a pin queued beside
    // it has nothing to point at. So the sheet hands the point to the camera
    // and the camera sends both at the shutter.
    const screen = readFileSync(join(__dirname, "..", "app", "sheets", "[jobId].tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\/[^\n]*/g, "");

    expect(screen, "the sheet no longer opens the camera with the point carried into it").toMatch(
      /\/photos\/\$\{jobId\}\?sheetPageId=\$\{sheet\.id\}&pinX=\$\{draft\.x\}&pinY=\$\{draft\.y\}/,
    );

    const camera = readFileSync(join(__dirname, "..", "app", "photos", "[jobId].tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(camera, "the camera no longer passes the sheet position to the upload").toMatch(/sheetPageId:/);
  });

  it("still guards every op against a missing photo file", () => {
    // Unrelated to pins and worth not breaking: a file the system cleared out
    // is a 410, set aside like a refusal rather than retried forever.
    expect(text, "the missing-file guard went").toMatch(/queuedPhotoExists\(op\.fileUri\)/);
  });
});
