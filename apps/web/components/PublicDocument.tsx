import type { ReactNode } from "react";
import Link from "next/link";
import { readSupportAddress } from "@/lib/help-config";

/**
 * The shell for the public pages a person can read without an account —
 * /privacy, /terms and /quickbooks/disconnected. Intuit asks for the first
 * two as URLs before it issues production QuickBooks keys, and for the third
 * as the page someone lands on after disconnecting C Stream inside
 * QuickBooks.
 *
 * Outside the (app) route group on purpose, and absent from middleware's
 * protected list: a policy you must sign in to read is not published.
 *
 * The contact line is whatever SUPPORT_EMAIL holds on this install, and says
 * so plainly when it holds nothing — no invented address.
 */
export function PublicDocument({ title, updated, children }: { title: string; updated?: string; children: ReactNode }) {
  const support = readSupportAddress(process.env);
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 text-sm leading-relaxed text-ink-body sm:px-6">
      <p className="mb-6">
        <Link href="/" className="font-semibold text-ink hover:underline">
          C Stream
        </Link>
      </p>
      <h1 className="mb-1 text-2xl font-semibold text-ink">{title}</h1>
      {updated && <p className="mb-6 text-xs text-ink-muted">Last updated {updated}</p>}
      <div className="flex flex-col gap-4 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc">
        {children}
      </div>
      <p className="mt-10 border-t border-line-card pt-4 text-xs text-ink-muted">
        {support ? (
          <>
            Questions: <a href={`mailto:${support}`} className="text-link hover:text-link-hover">{support}</a>, or Help →
            Ask a person inside the app.
          </>
        ) : (
          <>Questions: use Help → Ask a person inside the app.</>
        )}{" "}
        <Link href="/privacy" className="text-link hover:text-link-hover">
          Privacy
        </Link>{" "}
        ·{" "}
        <Link href="/terms" className="text-link hover:text-link-hover">
          Terms
        </Link>
      </p>
    </main>
  );
}
