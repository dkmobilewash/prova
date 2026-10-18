import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A DRAWING MUST NOT TRAVEL THROUGH A SERVER ACTION, AND NOTHING ELSE HERE CAN
 * NOTICE IF IT DOES.
 *
 * The first version of this feature posted the PDF to a Server Action as
 * FormData. Typecheck passed, 8,926 tests passed, lint passed, a full
 * production build passed, and it failed on the first real drawing anybody
 * tried — because a Next Server Action body defaults to **1MB** and Vercel
 * caps a serverless request body at **4.5MB** whatever Next is told. A single
 * architectural sheet is bigger than that.
 *
 * **There is no value of `bodySizeLimit` that fixes it**, which is why this
 * guards the SHAPE rather than a number: the bytes have to go straight to blob
 * storage from the browser, and the action may only carry a URL.
 *
 * The decisive mutation is "put the file back on the action" — change a
 * parameter to `FormData` and this goes red. Nothing else in the repo does,
 * which is the whole reason the defect shipped.
 */

const WEB = join(__dirname, "..");

function source(rel: string): string {
  return readFileSync(join(WEB, rel), "utf8");
}

/** Comments stripped, because both files DISCUSS FormData at length in their
 * own headers — a raw-text census would read the explanation as the defect. */
function code(rel: string): string {
  return source(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("the drawing goes to the store, never through a function", () => {
  it("has no Server Action taking a FormData, where a file could ride", () => {
    const actions = code("lib/actions/sheetPins.ts");
    // The size assertion, per this repo's own rule: a census that parses
    // nothing passes everything. If these two stop existing under these names
    // the test must fail loudly rather than quietly guard an empty set.
    const exported = actions.match(/export async function (uploadDrawingPdf|storeSheetImage)\(/g) ?? [];
    expect(
      exported.length,
      "the two upload actions are not where this census thinks they are — it is guarding nothing",
    ).toBe(2);

    // NOT "no FormData in the file" -- `createSheetPin` takes one and should:
    // a pin is two numbers and a short note, nowhere near any limit. The
    // invariant is specifically that no FILE crosses an action, so that is
    // what is asserted. A census aimed at the wrong set is this repo's most
    // repeated mistake, and the first draft of this one made it.
    for (const name of ["uploadDrawingPdf", "storeSheetImage"]) {
      const signature = actions.slice(actions.indexOf(`export async function ${name}(`));
      const params = signature.slice(0, signature.indexOf(")"));
      expect(
        params,
        `${name} takes FormData again. A file on a Server Action is capped at 1MB by Next and 4.5MB ` +
          "by Vercel, and a single architectural sheet is bigger than both — it will fail on the " +
          "first real drawing, exactly as it did on 2026-10-05.",
      ).not.toMatch(/FormData/);
    }
    expect(
      actions,
      "an upload action handles a File directly — the bytes are supposed to reach blob storage " +
        "without passing through a function at all",
    ).not.toMatch(/instanceof File/);
  });

  it("uploads from the browser with a token the server mints", () => {
    const surface = code("components/SheetPinSurface.tsx");
    expect(surface, "the surface no longer imports the client uploader").toMatch(
      /import \{ upload \} from "@vercel\/blob\/client"/,
    );
    // Both files: the PDF and the page images. A 2000px sheet PNG is commonly
    // several megabytes, so sending those through an action has the same cliff.
    const uploads = surface.match(/await upload\(/g) ?? [];
    expect(uploads.length, "both the PDF and the sheet images must upload directly").toBeGreaterThanOrEqual(2);
    // Every direct upload has to go through our token route, which is the
    // only place the caller is authorised. Counted rather than pattern-matched
    // around, so an upload added later without it fails the count.
    const routed = surface.match(/handleUploadUrl: "\/api\/drawings\/upload"/g) ?? [];
    expect(
      routed.length,
      "an upload does not name the token route — that upload is unauthorised, or going somewhere else",
    ).toBe(uploads.length);
  });

  it("authorises every token on the server, against the caller's own company", () => {
    const route = code("app/api/drawings/upload/route.ts");
    expect(route, "the token route does not check who is asking").toMatch(/requireCompanyContext\(\)/);
    expect(route, "the token route does not check the capability").toMatch(/can\(context, "MANAGE_JOBS"\)/);
    expect(
      route,
      "the token route does not check the revision belongs to this company — a token minted for " +
        "somebody else's revision is the provenance hole #195 closed on photos",
    ).toMatch(/companyId: context\.company\.id/);
  });

  it("proves a recorded URL came from OUR store, not merely a Vercel one", () => {
    const actions = code("lib/actions/sheetPins.ts");
    // `isBlobStorageUrl` proves "some Vercel store". Without the stricter
    // check the field accepts any URL and the upload is a link again, which is
    // the thing this whole feature exists to stop.
    const checks = actions.match(/isOurBlobStoreUrl\(/g) ?? [];
    expect(checks.length, "both the PDF and the sheet image must prove provenance").toBeGreaterThanOrEqual(2);
  });
});
