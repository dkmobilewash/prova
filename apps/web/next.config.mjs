import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * ── THE BUILD DIRECTORY IS A VARIABLE SO A SMOKE BUILD CANNOT CLOBBER A
   *    RUNNING SERVER ──
   *
   * `next build` and `next start` share `.next`, and the build wins. The
   * labelling server on :3001 serves out of it while somebody is working, so
   * building the commit that is ABOUT to be deployed — which is exactly what
   * a pre-rebuild smoke test does — would take that server down mid-sheet.
   *
   * `scripts/smoke-labeling.sh` sets this to `.next-smoke` and runs its own
   * server on another port. Unset, everything behaves as before.
   */
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  experimental: {
    /**
     * ── A SCANNED TILE DOES NOT FIT IN THE DEFAULT ──
     *
     * Server Actions cap a request body at 1 MB unless this says otherwise,
     * and nothing in the app said otherwise — so the limit was a default
     * nobody had chosen. Read this sheet sends a rendered tile of a drawing,
     * and a SCAN is the worst case for it: measured on the fixtures, a
     * speckled tile is 1.20 MB as PNG and would be refused, while a clean one
     * is 0.08 MB and sails through. That is why it worked everywhere except
     * on the sheets the feature exists for.
     *
     * The tiles are JPEG now, which halves the worst case to 0.54 MB, so this
     * is headroom rather than the fix — stated explicitly so the next person
     * sending an image knows what the ceiling is and that it was chosen.
     */
    serverActions: { bodySizeLimit: "4mb" },

    /**
     * ── A LABELLED SHEET SENDS EVERY PAIRING, NOT EVERY WALL ──
     *
     * A ROUTE HANDLER's body is capped at 10 MB by the middleware, separately
     * from the Server Action limit above, and the overflow is TRUNCATED
     * rather than refused — so `request.json()` throws on a half-written
     * body and the route reports the only thing it can see: "the request body
     * was not JSON". That message is honest and says nothing about size.
     *
     * Bunkie A100 hit it on 2026-10-20 with a reviewer's finished sheet in an
     * open tab. Measured rather than guessed, by rebuilding that sheet with
     * the finder (`zzPayload.eval.ts`):
     *
     *     runs shown to the reviewer :      56
     *     PAIRINGS sent with the save :  39,952
     *     body                        :   11.27 MB
     *
     * The gap between those first two numbers is the whole thing. A reviewer
     * judges RUNS; a model decides about PAIRINGS, and `labelRows` carries one
     * to the other — so every pairing travels with its 24-number feature
     * vector. A hatch-heavy sheet has hundreds of pairings per run, and
     * nothing on screen suggests it.
     *
     * 64 MB is about six times the worst case seen, which is the headroom a
     * sheet five times denser than Bunkie would need. It is a LOCAL labelling
     * route — `labelStore.ts` refuses to write at all without the loopback
     * opt-in — so this is not a limit a deployment is relying on.
     *
     * The better fix is to stop sending pairings the server already has, and
     * it is not this one: it changes what the CLIENT sends, and the tab that
     * needed it could not be reloaded without losing the sheet.
     */
    middlewareClientMaxBodySize: "64mb",
  },
  transpilePackages: ["@prova/ui", "@prova/db"],
  // `@napi-rs/canvas` ships a NATIVE `.node` binary. webpack follows the
  // import -- a dynamic `import()` does not stop it -- tries to PARSE the
  // binary, and the build dies with "Module parse failed: Unexpected
  // character". Nothing can bundle a compiled Skia; it has to be left to Node
  // at runtime, which is exactly what this option is for.
  //
  // READ THIS BEFORE ADDING pdfjs-dist TO THE LIST, because this repo has
  // already paid for that once: `lib/plan-ingest/planPdf.ts` records that
  // NO `serverExternalPackages` HERE, AND THAT IS A DELETION WITH A REASON.
  // `@napi-rs/canvas` was added so the SERVER could rasterise a plan sheet,
  // which needed this line (webpack cannot parse a native `.node` binary) --
  // and the line then kept Vercel from TRACING the binary into the function,
  // so pdf.js found nothing at runtime and the feature failed with every
  // check green. The whole problem is gone because the server no longer
  // renders anything: a PDF is UPLOADED now, so the browser already has the
  // bytes and does the rendering with the canvas it has natively.
  //
  // `lib/plan-ingest/planPdf.ts` still reads PDF TEXT on the server and needs
  // nothing here, which it explains at length. Do not add pdfjs-dist to a
  // list that no longer exists.
  // The floating N badge is dev-only chrome, and this branch gets filmed for
  // the demo video — nothing that says "dev server" can be in frame.
  devIndicators: false,
  // Tags every RSC/Server Action response with the build that produced it, so
  // a browser mid-navigation during a production promotion can tell it's
  // talking to a version that no longer matches what it loaded, and forces a
  // full reload instead of silently rendering a mismatched payload. This is
  // the free half of what Vercel calls Skew Protection — the OTHER half
  // (keeping the outgoing deployment's functions alive so an old client's
  // in-flight request still succeeds, instead of failing and then reloading)
  // is a Pro-plan feature this team isn't on. See NAV-IA-AUDIT.md's sibling
  // investigation, issue #118: this does not stop a request from 503ing
  // during the promotion window itself, since a platform-level 503 never
  // reaches Next's client runtime with a deployment id to compare against.
  // What it fixes is the OTHER failure class in the same family — an old
  // client getting a real, successful response from the new deployment that
  // doesn't match what it's holding.
  //
  // VERCEL_GIT_COMMIT_SHA is a Vercel-injected build-time env var, always
  // present on a Vercel build without needing the "expose to browser" toggle
  // (next.config.mjs runs in Node at build time, not in the browser). Sliced
  // to 32 chars because Next.js's deploymentId has that max length. Left
  // unset outside Vercel (local dev, CI) so nothing here changes those.
  deploymentId: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 32),
  // Which deployment this build IS, exposed to the browser.
  //
  // The error boundary needs it. A production build redacts every thrown
  // Server Action message to a digest, so the boundary can never read the
  // Prisma error code — it cannot tell a missing column from a dropped
  // connection. But it does not have to: on a PREVIEW, a data-read failure
  // is overwhelmingly a schema mismatch, because a branch whose migration
  // has not merged is the normal state of a preview and check:schema warns
  // about exactly that at build time. Nobody reads build logs when a page
  // is red, so the boundary says it instead.
  //
  // Inlined here from VERCEL_ENV rather than read as NEXT_PUBLIC_VERCEL_ENV,
  // because that one depends on a Vercel project toggle being left on. This
  // does not.
  env: {
    NEXT_PUBLIC_DEPLOY_ENV: process.env.VERCEL_ENV ?? "development",
  },
  // pnpm hoists @prisma/client (and its native query-engine binary) into the
  // monorepo root's node_modules/.pnpm store, not apps/web/node_modules.
  // Without this, Next's build-time file tracer roots itself at apps/web and
  // never discovers/copies that binary into the deployed function, so
  // Prisma fails at runtime with "could not locate the Query Engine" even
  // though `prisma generate` produced it correctly.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // Prisma resolves its query-engine binary via a dynamically-built path at
  // runtime, which Next's static file tracer can't follow — so the binary
  // has to be force-included explicitly or it's silently dropped from the
  // deployed function. See https://pris.ly/d/engine-not-found-nextjs
  // NARROWED, and the narrowing is the point. This used to read
  // `.pnpm/**/node_modules/.prisma/client/**`: that leading `**` makes the
  // tracer expand every one of the ~473 package directories in the pnpm
  // store, and `"/**"` asks it to do that for EVERY route. The cost grows
  // with routes × store size, and it is what killed the production build
  // for #56 — exit 137, the container out of memory, in NFT's trace step.
  //
  // Anchoring the first segment at @prisma+client turns 473 directory
  // walks per route into one. The engine binary is still force-included,
  // which is the whole reason this entry exists (see the note above).
  outputFileTracingIncludes: {
    "/**": ["../../node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/**"],
  },
  // The free lien waiver tool lives at cstream.ai/lien-waiver (Diego,
  // 2026-10-12) but is a SEPARATE app: apps/lien-waiver, its own Vercel
  // project, no Clerk, no access to this app's database. This app owns
  // /lien-waiver itself (the landing page) and proxies everything BELOW it
  // to the tool, which is built with basePath "/lien-waiver" so its pages,
  // assets and API all sit under the same prefix.
  //
  // LIEN_WAIVER_TOOL_ORIGIN is the tool's production origin, read at build
  // time. Unset (a laptop, CI, most previews) means no rewrite, and
  // /lien-waiver/* 404s here exactly as it did before this existed.
  async rewrites() {
    const origin = process.env.LIEN_WAIVER_TOOL_ORIGIN?.trim().replace(/\/+$/, "");
    if (!origin) return [];
    return [{ source: "/lien-waiver/:path+", destination: `${origin}/lien-waiver/:path+` }];
  },
};

export default nextConfig;
