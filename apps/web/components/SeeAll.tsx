import Link from "next/link";

/**
 * "Showing the latest 7 of 49. See all 49" — the one line under a capped
 * list, copied from JobMediaSection (top 12 photos + See all) so the six
 * hand-rolled versions of it stop multiplying (density audit, pattern 2).
 *
 * URL-driven: `?all=1` shows everything, and the same line then offers the
 * way back. A server page reads the window with `seeAllWindow(sp.all)`,
 * passes `take` to its query, and renders this under the list:
 *
 *   const { take, showingAll } = seeAllWindow(params.all);
 *   const rows = await prisma.x.findMany({ ..., take });
 *   <SeeAll total={count} limit={take} showingAll={showingAll} noun="time entries" />
 *
 * `href` defaults to `?all=1` relative to the current page; pass one when
 * the page has other params to keep (`?job=abc&all=1`) or a section to
 * land on (`?all=1#history`). Renders nothing when the list fits.
 */

export const SEE_ALL_DEFAULT = 7;

export function seeAllWindow(all: string | string[] | undefined, limit = SEE_ALL_DEFAULT): { take: number | undefined; limit: number; showingAll: boolean } {
  const showingAll = all === "1";
  return { showingAll, limit, take: showingAll ? undefined : limit };
}

export function SeeAll({
  total,
  limit = SEE_ALL_DEFAULT,
  showingAll = false,
  noun,
  href = "?all=1",
  fewerHref = "?",
  className = "",
}: {
  /** How many there are in all — a count, not the rows loaded. */
  total: number;
  /** How many the capped view shows; `seeAllWindow`'s `limit`. */
  limit?: number;
  showingAll?: boolean;
  /** Plural, e.g. "time entries". */
  noun: string;
  href?: string;
  fewerHref?: string;
  className?: string;
}) {
  if (total <= limit) return null;
  const link = "inline-flex min-h-11 items-center text-link hover:text-link-hover hover:underline mouse:min-h-7";
  return (
    <p className={`mt-3 text-sm text-ink-body ${className}`}>
      {showingAll ? (
        <>
          Showing all {total} {noun}.{" "}
          <Link href={fewerHref} className={link}>
            Show the latest {limit}
          </Link>
        </>
      ) : (
        <>
          Showing the latest {limit} of {total} {noun}.{" "}
          <Link href={href} className={link}>
            See all {total}
          </Link>
        </>
      )}
    </p>
  );
}
