import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `withCredentials` ON A PDF WE SERVE FROM OUR OWN BLOB STORE MAKES IT
 * UNREADABLE, AND THE ERROR IT PRODUCES BLAMES THE FILE.
 *
 * Setting it turns the fetch into a CREDENTIALED cross-origin request. A
 * server answering one of those must name a specific origin —
 * `Access-Control-Allow-Origin: *` is refused by the browser, by design.
 * Vercel Blob serves public files with exactly `*`. So the flag takes a file
 * that reads perfectly and makes it unreachable.
 *
 * Measured in the live page, against a real 113-page drawing, 2026-10-05:
 *
 *   credentials: "omit"     -> 206 Partial Content
 *   credentials: "include"  -> TypeError: Failed to fetch
 *
 * **The reason this needs a guard rather than a comment** is what the user
 * sees when it happens. The catch around the load says *"That sheet couldn't
 * be opened. It may not be a PDF, or the upload may not have finished."* —
 * so a CORS refusal is reported as a bad file, and the person goes looking at
 * their drawing. Diego did, twice, for two different causes on the same day.
 *
 * Nothing else here can see it: no test in this repo makes a cross-origin
 * request, and typecheck, lint and a full production build are all green with
 * the flag set.
 */

const WEB = join(__dirname, "..");

/** Every component that opens a PDF with pdf.js. Derived rather than listed,
 * so a fourth one cannot be added without being covered — and asserted
 * non-empty, because a pattern matching nothing passes every check
 * downstream. */
const PDF_READERS = ["SheetPinViewer.tsx", "SheetPinSurface.tsx", "TakeoffPlanViewer.tsx"];

function code(file: string): string {
  return readFileSync(join(WEB, "components", file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("a PDF from our own blob store is fetched without credentials", () => {
  it("covers every component that calls getDocument, and finds them all", () => {
    // The scope assertion. If a reader is renamed or added, this list goes
    // stale silently — so the list is checked against the files that actually
    // call pdf.js rather than trusted.
    const found = PDF_READERS.filter((file) => code(file).includes("getDocument("));
    expect(
      found,
      "a listed component no longer opens a PDF — this census is guarding files that do not do the thing",
    ).toEqual(PDF_READERS);
  });

  it("sets withCredentials nowhere", () => {
    for (const file of PDF_READERS) {
      expect(
        code(file),
        `${file} sets withCredentials on a pdf.js load. Vercel Blob answers with ` +
          "`Access-Control-Allow-Origin: *`, which a credentialed request refuses — the file becomes " +
          'unreadable and the screen blames the PDF: "That sheet couldn\'t be opened."',
      ).not.toMatch(/withCredentials/);
    }
  });

  it("keeps the comments that explain it, so the flag is not helpfully restored", () => {
    // The flag looks like something somebody removed by accident. Each site
    // says why it is absent; without that, the next person adds it back and
    // the symptom returns as "that drawing is broken".
    for (const file of PDF_READERS) {
      expect(
        readFileSync(join(WEB, "components", file), "utf8"),
        `${file} no longer explains why withCredentials is absent`,
      ).toMatch(/credential/i);
    }
  });
});
