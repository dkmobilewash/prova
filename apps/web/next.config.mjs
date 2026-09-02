import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@prova/ui", "@prova/db"],
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
};

export default nextConfig;
