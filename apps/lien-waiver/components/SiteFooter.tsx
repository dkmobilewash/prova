import Link from "next/link";
import { CSTREAM_URL } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line/40 bg-paper">
      <div className="mx-auto max-w-2xl px-4 py-8 text-sm text-quiet">
        <p>
          Made by{" "}
          <a className="font-semibold text-ink underline" href={CSTREAM_URL}>
            C-Stream
          </a>
          , job costing for commercial framing, drywall and EIFS/stucco subcontractors.
        </p>
        <p className="mt-3">
          C-Stream is not a law firm. Nothing on this site is legal advice. Read every form before you sign it, and
          talk to a construction attorney about anything you are unsure of.
        </p>
        <nav className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
          <Link className="inline-flex min-h-touch items-center underline" href="/">
            All states
          </Link>
          <Link className="inline-flex min-h-touch items-center underline" href="/privacy">
            Privacy
          </Link>
          <Link className="inline-flex min-h-touch items-center underline" href="/terms">
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}
