import { prisma } from "@prova/db";
import type { JobMediaCardData } from "@/components/JobMediaCard";
import type { JobMediaTagSummary } from "@/components/JobMediaTagManager";
import {
  formatByteSize,
  formatCapturedAt,
  formatCapturedAtInputValue,
  jobMediaClockWarning,
} from "@/lib/job-media";

/**
 * Reading site capture for a gallery, in the shape the card wants.
 *
 * The fetch half of the split lib/job-media.ts is the pure half of — the
 * same arrangement as compliance-expiry.ts/renewals.ts and
 * permissions.ts/authz.ts. Everything decided here is decided by a pure
 * function that a test can call without a database.
 *
 * Both galleries go through this so they cannot drift: the job page and
 * `/photos` render the same card from the same projection, differing only
 * in whether the job name is shown (on a job page it is the page).
 */

/** What a gallery is showing: the company, and up to two narrowings.
 *
 * Both narrowings are optional and they COMPOSE — `/photos` can be looking
 * at one job, one tag, both or neither, and "both" has to mean AND. */
export type JobMediaFilter = {
  companyId: string;
  jobId?: string;
  /** A `JobMediaTag.id`. Photos carrying that tag, and no others. */
  tagId?: string;
};

export type JobMediaScope = JobMediaFilter & {
  withJobName?: boolean;
  /** Caps the gallery. BOTH callers pass one: the job page shows a dozen
   * and links to `/photos`, and `/photos` itself caps too. It used to be
   * the "full read" and passed nothing, which meant one query returning
   * every photo the company had ever taken — unbounded, and on an index
   * (`[jobId, capturedAt]`) that could not serve it. */
  take?: number;
};

/**
 * The `where` both the list and the count are built from.
 *
 * ONE BUILDER, TWO QUERIES, and that is the point rather than tidiness.
 * The gallery's footer says "showing the 60 most recent of N", and N comes
 * from a separate count — so if the count and the list disagreed about
 * what is being filtered, the page would state a number that is not about
 * the photos underneath it. Adding the tag filter to the list and
 * forgetting the count is exactly that bug, and it produces a page that
 * looks completely healthy while lying about how much it is withholding.
 */
function jobMediaWhere(filter: JobMediaFilter) {
  return {
    companyId: filter.companyId,
    ...(filter.jobId ? { jobId: filter.jobId } : {}),
    // `some` on the join, rather than a list of ids on the photo: the tag
    // lives one table away and this is the indexed direction of it
    // (`@@index([tagId])` on the assignment exists for this query).
    ...(filter.tagId ? { tags: { some: { tagId: filter.tagId } } } : {}),
  };
}

export async function loadJobMedia(
  scope: JobMediaScope,
  timeZone: string,
): Promise<JobMediaCardData[]> {
  const rows = await prisma.jobMedia.findMany({
    where: jobMediaWhere(scope),
    ...(scope.take ? { take: scope.take } : {}),
    // Newest first, by when the picture was TAKEN rather than when it
    // arrived — a crew uploading Friday's photos on Monday should see them
    // in the order they happened, which is the order they walked the site.
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
    include: {
      capturedBy: true,
      job: scope.withJobName ? true : false,
      // ONE include, not a query per card. Prisma resolves a nested
      // to-many with a single extra query for the whole page (`IN (…)` on
      // the parent ids), so a 60-photo gallery costs two queries and not
      // sixty-one. The obvious alternative — mapping the rows and awaiting
      // this photo's tags inside the map — is the N+1 this note exists to
      // stop somebody writing.
      //
      // Ordered by name here rather than in JavaScript afterwards so the
      // chips on a card are in a stable order between renders: an
      // unordered to-many comes back in whatever order the database found
      // it, and chips that reshuffle when a page revalidates look like
      // something changed when nothing did.
      tags: { include: { tag: true }, orderBy: { tag: { name: "asc" } } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    blobUrl: row.blobUrl,
    caption: row.caption,
    capturedAtLabel: formatCapturedAt(row.capturedAt, timeZone),
    capturedAtInputValue: formatCapturedAtInputValue(row.capturedAt, timeZone),
    sizeLabel: formatByteSize(row.byteSize),
    capturedByName: row.capturedBy?.name ?? null,
    clockWarning: jobMediaClockWarning(row.capturedAt, row.createdAt),
    // The DISPLAY name, which is the only form any screen shows.
    // `normalizedName` exists to be the target of a unique index and is
    // deliberately never rendered — see the model comment.
    tags: row.tags.map((assignment) => ({
      id: assignment.tag.id,
      name: assignment.tag.name,
    })),
    ...(scope.withJobName && "job" in row && row.job ? { jobName: row.job.name } : {}),
  }));
}

/** How many there are in total, for the "showing 12 of 47" line. A
 * separate count rather than `rows.length`, because the list is capped and
 * its length would then be the cap rather than the truth.
 *
 * Takes the same filter the list does, through the same builder: the
 * number has to be about the photos the page is showing, and a count that
 * ignored the tag filter would be a bigger, wrong number stated with total
 * confidence. */
export function countJobMedia(filter: JobMediaFilter): Promise<number> {
  return prisma.jobMedia.count({ where: jobMediaWhere(filter) });
}

/**
 * The company's whole tag vocabulary, with a photo count against each.
 *
 * THE COUNT IS COMPUTED HERE, EVERY TIME, and there is no column holding
 * it. A stored counter is derived state, and this schema's standing rule
 * is that derived state disagrees with what it was derived from sooner or
 * later — here it would take one cascade-deleted photo to make the number
 * on a filter chip permanently wrong, with nothing to notice it.
 *
 * `_count` rather than a second query or a `groupBy`: Prisma turns it into
 * one aggregate on the join table alongside the tag select, so the whole
 * vocabulary costs one round trip however many tags there are.
 *
 * Every assignment reachable from a tag belongs to a photo of the same
 * company — a tag is company-scoped, and `addJobMediaTags` refuses a photo
 * that is not this company's — so an unfiltered count here is a count of
 * THIS company's photos and needs no `where` inside it.
 *
 * Ordered by name, because this list is read by a human looking for a word
 * they already have; ordering by count would move the chips around
 * whenever somebody tagged something.
 */
export async function loadJobMediaTags(companyId: string): Promise<JobMediaTagSummary[]> {
  const rows = await prisma.jobMediaTag.findMany({
    where: { companyId },
    orderBy: { name: "asc" },
    include: { _count: { select: { assignments: true } } },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    photoCount: row._count.assignments,
  }));
}
