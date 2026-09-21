"use client";

import { PageLoadError } from "@/components/PageLoadError";
import "./globals.css";

/**
 * The last boundary: the ROOT layout (`app/layout.tsx` — ClerkProvider,
 * the two deploy banners, <html>/<body>) failed to render.
 *
 * Next.js requires this file to render its own <html> and <body>, because
 * when it is shown there is no layout left to provide them. It is only
 * active in a production build — `next dev` shows its own overlay instead
 * — so it cannot be clicked locally; `lib/errorBoundaryCoverage.test.ts`
 * renders it directly and asserts the same copy as the other two
 * boundaries, digest included.
 *
 * `globals.css` is imported here because this replaces the layout that
 * normally imports it; without it the Tailwind classes in `PageLoadError`
 * would resolve to nothing and the screen would be unstyled text.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas text-ink">
        <PageLoadError error={error} reset={reset} />
      </body>
    </html>
  );
}
