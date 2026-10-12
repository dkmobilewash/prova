/**
 * The lien waiver tool -- a separate app from C-Stream (apps/web) on
 * purpose: its own Vercel project, its own domain, no Clerk, no access to
 * C-Stream's database. It shares this repo only so its statute-text tests
 * run in the same CI as everything else.
 *
 * Nothing reads a statute from disk at request time: the normalized forms
 * are generated into lib/statutes/generated/forms.json and imported, so
 * the bundler ships exactly what the tests checked.
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Served at cstream.ai/lien-waiver (Diego, 2026-10-12): the C-Stream app
  // (apps/web) rewrites /lien-waiver/* to this app's production origin, and
  // owns /lien-waiver itself (Cyrus's landing page). Every route, asset and
  // API here therefore lives under this prefix. lib/site.ts BASE_PATH must
  // match; lib/site.test.ts checks that it does.
  basePath: "/lien-waiver",
  devIndicators: false,
  poweredByHeader: false,
};

export default nextConfig;
