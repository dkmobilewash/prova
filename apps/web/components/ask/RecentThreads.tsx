import Link from "next/link";
import { listRecentThreads } from "@/lib/ask/threads";
import { answeredAgo } from "@/lib/ask/transcript";

/**
 * The person's own recent conversations, newest first.
 *
 * A server component: the list is read with the session's company AND person
 * by the caller, so nobody sees a colleague's threads here. The time is
 * relative and computed on the server, so there is no client clock for
 * hydration to disagree with. `hrefFor` lets /ai point a row at its own page.
 */
export async function RecentThreads({
  companyId,
  userId,
  limit = 10,
  hrefFor = (id) => `/ask?thread=${encodeURIComponent(id)}`,
  activeId,
}: {
  companyId: string;
  userId: string;
  limit?: number;
  hrefFor?: (id: string) => string;
  /** The thread open beside this list, marked so the person can see which
   * one they are in. */
  activeId?: string;
}) {
  const threads = await listRecentThreads(companyId, userId, limit);
  const now = Date.now();

  return (
    <nav aria-labelledby="recent-threads-heading" data-ask="recent-threads">
      <h2 id="recent-threads-heading" className="text-sm font-semibold text-ink">
        Recent
      </h2>
      {threads.length === 0 ? (
        <p className="mt-2 text-sm text-ink-body">
          No conversations yet. Ask something and it will be kept here, so you can pick it up later.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {threads.map((thread) => {
            const active = thread.id === activeId;
            return (
              <li key={thread.id}>
                <Link
                  href={hrefFor(thread.id)}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 flex-col justify-center rounded-md px-3 py-2 hover:bg-rail-hover ${
                    active ? "bg-rail-hover" : ""
                  }`}
                >
                  <span className="truncate text-sm text-ink">{thread.title}</span>
                  <span className="text-xs text-ink-muted">
                    {answeredAgo(thread.lastMessageAt.getTime(), now)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
