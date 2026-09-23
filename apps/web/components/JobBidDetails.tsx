import { suggestionsFrom } from "@/lib/ask/webSuggestions";

/**
 * What a bid started from the Ask box recorded beyond the name, GC and
 * scope: where the project is, when the bid is due, and the public-web
 * facts the person kept on the confirm card.
 *
 * Read-only and renders nothing for a job that has none of the three, so
 * every job created from /jobs/new looks exactly as it did.
 *
 * The web facts keep their links and their label. They were a stranger's
 * page when found and they still are; the person ticked them as worth
 * keeping, not as verified.
 */
export function JobBidDetails({
  projectLocation,
  bidDueDate,
  bidResearch,
}: {
  projectLocation: string | null;
  bidDueDate: Date | null;
  bidResearch: unknown;
}) {
  const found = suggestionsFrom(bidResearch);
  if (!projectLocation && !bidDueDate && found.length === 0) return null;

  return (
    <div className="mt-4 rounded-lg border border-line-card bg-surface p-4 text-sm" data-job="bid-details">
      <h3 className="text-sm font-semibold text-ink">Bid details</h3>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {projectLocation && (
          <>
            <dt className="text-ink-body">Location</dt>
            <dd className="min-w-0 break-words text-ink">{projectLocation}</dd>
          </>
        )}
        {bidDueDate && (
          <>
            <dt className="text-ink-body">Bid due</dt>
            <dd className="text-ink">
              {bidDueDate.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })}
            </dd>
          </>
        )}
      </dl>
      {found.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-tag-amber-ink">Found on the web when the bid was started — check before you rely on it</p>
          <ul className="mt-1 space-y-1">
            {found.map((fact) => (
              <li key={fact.key}>
                <span className="text-ink-body">{fact.label}:</span> <span className="text-ink">{fact.value}</span>{" "}
                <span className="text-xs text-ink-body">
                  {fact.sources.map((source, index) => (
                    <a
                      key={source.url}
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="underline hover:text-link"
                    >
                      {index === 0 ? "source" : `source ${index + 1}`}
                    </a>
                  )).reduce<React.ReactNode[]>((acc, link, index) => (index === 0 ? [link] : [...acc, " · ", link]), [])}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
