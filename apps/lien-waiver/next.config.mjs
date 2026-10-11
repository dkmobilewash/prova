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
  devIndicators: false,
  poweredByHeader: false,
};

export default nextConfig;
