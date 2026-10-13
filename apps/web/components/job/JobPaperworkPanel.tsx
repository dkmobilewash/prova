import Link from "next/link";
import type { JobPaperworkLink } from "@/lib/jobs/job-paperwork";

/** "2 open" is something waiting on somebody — amber, like the mockup. A
 * zero, or a plain count, is just a fact. */
function isOpenWork(detail: string): boolean {
  return /^[1-9]\d* (open|waiting)/.test(detail);
}

/**
 * The job's paperwork beside whatever stage is open: RFIs, submittals,
 * punch list and the rest from `jobPaperworkLinks` (already filtered to
 * this job and to the pages this viewer can open), plus change orders.
 */
export function JobPaperworkPanel({ links }: { links: JobPaperworkLink[] }) {
  if (links.length === 0) return null;
  return (
    <nav
      aria-label="This job's paperwork"
      className="rounded-[14px] border border-line-card bg-surface px-5 py-4 sm:px-6 print:hidden"
    >
      <h2 className="mb-1 font-headline text-xl text-ink">Paperwork</h2>
      <ul>
        {links.map((link) => (
          <li key={link.href} className="border-b border-line-row last:border-b-0">
            <Link
              href={link.href}
              className="flex min-h-[44px] items-center justify-between gap-3 py-2.5 text-base text-ink hover:text-link mouse:min-h-9 mouse:py-2"
            >
              <span>{link.label}</span>
              <span
                className={`text-sm tabular-nums ${isOpenWork(link.detail) ? "font-semibold text-warn" : "text-ink-muted"}`}
              >
                {link.detail}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
