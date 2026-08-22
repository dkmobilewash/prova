import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@prova/ui", "@prova/db"],
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
  outputFileTracingIncludes: {
    "/**": ["../../node_modules/.pnpm/**/node_modules/.prisma/client/**"],
  },
};

export default nextConfig;
