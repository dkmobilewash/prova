// ── WHERE THE SCANNED-SHEET WORKER FINDS ITS PACKAGES, IN THE FUNCTION AS SHIPPED ──
//
// The worker is a file copied into the function by `outputFileTracingIncludes`, so nothing traces what it
// imports (#1252's proof: ERR_MODULE_NOT_FOUND pdfjs-dist from /var/task/…/rasterWorker.mjs). Its packages are
// included by next.config.mjs THROUGH pnpm's flat store, `node_modules/.pnpm/node_modules/<package>`: Next's
// include globs copy files at the path they were matched by, not pnpm's symlinks, so there they arrive as one flat
// directory where every package's own `require` finds its siblings (pdf.js → @napi-rs/canvas → its platform
// binary; tesseract.js → its core and its dependencies). Resolving from the app's directory instead would look in
// apps/web/node_modules, where only symlinks exist, and those are not shipped.
//
// On a laptop the same directory holds pnpm's symlinks, so this resolves to the same files there.
// `scripts/raster-worker-trace-check.mjs` runs the worker in the traced function after every build.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

/** `require` rooted in pnpm's flat store at the repo root (this file is apps/web/lib/takeoff/raster/). */
export const storeRequire = createRequire(new URL("../../../../../node_modules/.pnpm/node_modules/__store__.js", import.meta.url));

/** `import()` of a package (or a file in one) from that store. */
export function storeImport(specifier) {
  return import(pathToFileURL(storeRequire.resolve(specifier)).href);
}
