import { prisma } from "@prova/db";
import type { JobMediaCardData } from "@/components/JobMediaCard";
import type { JobMediaTagSummary } from "@/components/JobMediaTagManager";
import type { JobMediaKind } from "@/lib/job-media";
import type { JobMediaMark } from "@/components/JobMediaMarks";
import {
  formatByteSize,
  formatCapturedAt,
  formatCapturedAtInputValue,
  formatCapturedDay,
  jobMediaClockWarning,
  jobMediaKind,
  jobMediaPlaybackWarning,
} from "@/lib/job-media";
import { describeCapturedLocation } from "@/lib/job-media-location";

/** One stored annotation as the overlay wants it.
 *
 * ONE PROJECTION FOR BOTH GALLERIES AND THE PORTAL, because the marks the
 * GC sees must be the marks the sub saw when they decided to share — two
 * mappings would be two chances for an arrow to land somewhere else on the
 * page where that matters most. The author and timestamp are dropped here
 * rather than in each caller: nothing on any screen renders them today, and
 * a field shipped to a client component and read by nothing is the shape
 * CLAUDE.md names.
 */
function toMark(row: {
  id: string;
  kind: JobMediaMark["kind"];
  x1: number;
  y1: number;
  x2: number | null;
  y2: number | null;
  label: string | null;
}): JobMediaMark {
  return {
    id: row.id,
    kind: row.kind,
    x1: row.x1,
    y1: row.y1,
    x2: row.x2,
    y2: row.y2,
    label: row.label,
  };
}

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

/** What a gallery is showing: the company, and up to four narrowings.
 *
 * All four narrowings are optional and they COMPOSE — `/photos` can be
 * looking at one job, one tag, whether the client can see it, whether it
 * carries a location, any combination or none, and a combination has to
 * mean AND. */
export type JobMediaFilter = {
  companyId: string;
  jobId?: string;
  /** A `JobMediaTag.id`. Photos carrying that tag, and no others. */
  tagId?: string;
  /** `true` — only photos the job's client can currently see through their
   * portal link. `false` — only photos they cannot. UNDEFINED IS BOTH, and
   * the three-valued shape is the point: `false` and "unset" are different
   * questions and a plain boolean cannot hold them apart. Every caller
   * builds this from `SharedFilter`, which is a string union for the same
   * reason (lib/job-media-tags.ts). */
  shared?: boolean;
  /** `true` — only captures that recorded where they were taken. `false` —
   * only those that did not. UNDEFINED IS BOTH, exactly like `shared` above
   * and for the same reason: `false` is a real question here ("which of
   * these has no location") and a plain boolean cannot hold it apart from
   * "not filtered". Built from `LocatedFilter`, a string union, for that
   * reason (lib/job-media-tags.ts).
   *
   * NOT A DEGRADED-ROW FILTER. "No location" is a first-class half of this
   * gallery, not a defect list: every capture taken before this feature
   * shipped, every desktop upload and every denied permission is in it. */
  located?: boolean;
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
    // Tested against `undefined` rather than truthiness, because `false` is
    // a real value here and means the opposite of "no filter". Written the
    // obvious way — `...(filter.shared ? … : {})` — the "not shared" chip
    // would silently show everything, which is a page that looks perfectly
    // healthy while answering a question nobody asked.
    //
    // `{ not: null }` and `null` rather than a boolean column: the schema
    // stores WHEN the disclosure happened, so "can the client see it" is
    // "is that timestamp set". One column, one source of truth, and no
    // stored flag that can disagree with the date beside it.
    ...(filter.shared === undefined
      ? {}
      : { sharedWithClientAt: filter.shared ? { not: null } : null }),
    // Tested against `undefined` for the same reason `shared` is — `false`
    // is a real value that means the opposite of "no filter" — and asked of
    // the LATITUDE alone. That is safe rather than sloppy: the database
    // refuses a row with one coordinate and not the other
    // (`JobMedia_captured_location_pairing`), so one column answers for the
    // pair. Written against both would be two clauses that can only ever
    // agree, and a reader would reasonably wonder what the second was for.
    ...(filter.located === undefined
      ? {}
      : { capturedLatitude: filter.located ? { not: null } : null }),
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
      // Same one-query-for-the-page shape as the tags above rather than a
      // read per card, and ordered here so the marks are drawn in a stable
      // order between renders — SVG paints in document order, so an
      // unordered to-many is an overlay whose overlapping marks reshuffle
      // on a revalidate.
      annotations: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    blobUrl: row.blobUrl,
    // DERIVED HERE, ONCE, for both galleries and every card in them. The
    // column it comes from is the only stored fact; a `kind` column beside
    // it would be a second source of truth that could disagree, which is
    // what the model comment on `contentType` refuses.
    //
    // The fallback is "photo" rather than a throw, and that is a decision
    // about a row that already exists: a content type this build does not
    // recognise can only be one an older build accepted, and the useful
    // behaviour for a stored capture is to render something rather than
    // 500 the whole gallery. It renders as an image, which for anything
    // this app ever accepted is right, and for anything else shows a
    // broken thumbnail next to a working "Open file" — visibly wrong in
    // one card rather than invisibly wrong on the page.
    kind: jobMediaKind(row.contentType) ?? "photo",
    playbackWarning: jobMediaPlaybackWarning(row.contentType),
    caption: row.caption,
    capturedAtLabel: formatCapturedAt(row.capturedAt, timeZone),
    capturedAtInputValue: formatCapturedAtInputValue(row.capturedAt, timeZone),
    sizeLabel: formatByteSize(row.byteSize),
    capturedByName: row.capturedBy?.name ?? null,
    sharedWithClientLabel: row.sharedWithClientAt
      ? formatCapturedAt(row.sharedWithClientAt, timeZone)
      : null,
    clockWarning: jobMediaClockWarning(row.capturedAt, row.createdAt),
    // WHERE, derived on every read from the two or three stored numbers and
    // held nowhere. The coordinate label, the error bar, the "this fix is
    // too wide to be a spot" note and the map link are all computed by one
    // pure function so both galleries say the same words — and so that
    // changing the coarse-fix threshold changes what every existing row
    // says, which a stored flag could not.
    //
    // Null for most rows, and that is an ordinary row: see the column
    // comments in media.prisma.
    location: describeCapturedLocation(row),
    // The DISPLAY name, which is the only form any screen shows.
    // `normalizedName` exists to be the target of a unique index and is
    // deliberately never rendered — see the model comment.
    tags: row.tags.map((assignment) => ({
      id: assignment.tag.id,
      name: assignment.tag.name,
    })),
    marks: row.annotations.map(toMark),
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

/* ------------------------------------------------------------------ *
 * The client's half
 * ------------------------------------------------------------------ */

/**
 * One photo, as the GC sees it through their portal link.
 *
 * A SEPARATE TYPE FROM `JobMediaCardData`, AND DELIBERATELY NOT A SUBSET
 * SHARED WITH IT. This is the enforcement of the three exclusions
 * `PortalJobPhotos` explains, moved from a comment somebody can ignore into
 * a type the compiler will not let them ignore:
 *
 *   - NO TAGS. "backcharge", "GC delay", "rework" is this sub's private
 *     framing of the job, written for their own retrieval and their own
 *     argument. Handing that vocabulary to the party it is about is the
 *     single worst thing this feature could do, and it would happen by
 *     accident the moment somebody reused the internal projection here.
 *   - NO PHOTOGRAPHER. The GC has no use for which of the crew held the
 *     phone, and a name on a photo of a defect is a name to complain about.
 *   - NO COORDINATES. Argued at length on `loadSharedJobMediaForClient`'s
 *     `select` below, because it is the one exclusion here whose case is
 *     genuinely arguable: the GC knows the job's address already. A phone's
 *     GPS fix is not the job's address.
 *   - NO `id`-DRIVEN EDIT AFFORDANCES, no file size, no clock warning, no
 *     `capturedAtInputValue`. Those exist to drive the internal card's edit
 *     form; the portal has no form.
 *
 * So a future reader who wants to "helpfully" put tags on the portal has to
 * change this type, this query and the component — three deliberate edits,
 * not one forgetful one. `id` survives only as a React key.
 */
export type PortalJobPhoto = {
  id: string;
  blobUrl: string;
  /** What the sub drew on it. Carried to the portal ON PURPOSE — see the
   *  select below — but stripped of who drew it and when, like every other
   *  field on this type. */
  marks: JobMediaMark[];
  /** Photo, video or voice note. Added when capture stopped being
   *  photos-only, and it is the one widening of this type that carries no
   *  disclosure: it is derived from the file's own content type, which the
   *  GC already holds — they have the file. Without it the portal renders
   *  an `<img>` at a `.mov` and the GC sees a broken thumbnail of evidence
   *  the sub deliberately chose to show them. */
  kind: JobMediaKind;
  caption: string | null;
  capturedAtLabel: string;
};

/**
 * The photos of one job that its client is allowed to see.
 *
 * THE `where` IS THE SECURITY OF THE WHOLE FEATURE, so it is stated here
 * once, in the module the portal page imports, rather than inline on a page
 * whose next edit might loosen it.
 *
 * Three conditions, and every one of them is load-bearing:
 *
 *   1. `sharedWithClientAt: { not: null }` — the opt-in. Null is the
 *      default for every row this table has ever had, so a photo is
 *      internal until somebody decided otherwise. Withdrawing sets it back
 *      to null and the photo leaves this query, which is why the negative
 *      case is the one worth clicking (see the click-list).
 *   2. `jobId` — the caller has already proved this job belongs to the
 *      contact holding the token. Passing the job id rather than the
 *      contact means this function cannot be called in a way that leaks
 *      across jobs even by mistake.
 *   3. `companyId` — belt and braces, and NOT redundant in the way it
 *      looks. `recordJobMedia` requires a photo's company to match its
 *      job's, so today these agree for every row; this clause is what makes
 *      the query still correct if that ever stops being true, at the cost
 *      of nothing (the `[companyId, capturedAt]` index already exists).
 *
 * THE PORTAL HAS NO AUTH — the token IS the credential — so there is no
 * session to re-check and no capability to assert. The guard is entirely
 * the caller's token lookup plus these three clauses.
 *
 * ONE THING THIS CANNOT DO, and it belongs in writing: unsharing removes a
 * photo from this list, not from the internet. Blob URLs are
 * public-but-unguessable (lib/blob.ts), so a GC who saved the link keeps
 * the file. "Stop sharing" withdraws the photo from the portal; it does not
 * undo the disclosure, which is exactly why the card asks before it shares
 * and does not ask before it withdraws.
 */
export async function loadSharedJobMediaForClient(
  { jobId, companyId, take }: { jobId: string; companyId: string; take: number },
  timeZone: string,
): Promise<PortalJobPhoto[]> {
  const rows = await prisma.jobMedia.findMany({
    where: { jobId, companyId, sharedWithClientAt: { not: null } },
    take,
    // Same order as every internal gallery: by when the picture was TAKEN,
    // newest first. The GC is reading a job's history and it should read in
    // the same order the sub's does.
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
    // An explicit `select` rather than the default row, so the columns that
    // must never reach the portal are not even fetched. `include: { tags }`
    // added here by a future edit would be visible in review as a change to
    // this list; a default select that silently gained a column would not.
    select: {
      id: true,
      blobUrl: true,
      caption: true,
      capturedAt: true,
      contentType: true,
      // NO `capturedLatitude`, `capturedLongitude` OR
      // `capturedAccuracyMeters`, DECIDED RATHER THAN OVERLOOKED.
      //
      // This is the one exclusion on this list whose case is genuinely
      // arguable, so the argument is written down rather than left to the
      // next reader to re-run. The case FOR sending it is real: the GC knows
      // the job's address — they own the building — so a coordinate on a
      // photo of their own site looks like it discloses nothing, and "where
      // on the site was this" is a question a GC asks constantly.
      //
      // It is refused anyway, on four grounds:
      //
      //   1. A PHONE'S FIX IS NOT THE JOB'S ADDRESS. It is where a person
      //      was standing, to a few metres, at a stated minute. A gallery of
      //      forty shared photos is then forty timestamped positions of a
      //      crew of three or four, handed to the party they are in a
      //      commercial relationship with. That is a movement record, and
      //      nobody uploading a photo of a cracked header thinks they are
      //      producing one.
      //   2. IT CONTRADICTS THE EXCLUSION ABOVE IT. The portal already
      //      withholds WHO took the photo, on the grounds that a name on a
      //      photo of a defect is a person to complain about. Withholding
      //      the name while publishing where that unnamed person stood, and
      //      when, is not a coherent position — it is the same disclosure
      //      with the identifier moved.
      //   3. IT CANNOT ANSWER THE QUESTION IT LOOKS LIKE IT ANSWERS. "Which
      //      part of the building" is floors and gridlines, and a GPS fix
      //      has no altitude worth the name and reads tens of metres out
      //      inside a steel frame. The caption is what answers it, and the
      //      caption is already here.
      //   4. IT INVITES AN ARGUMENT THE NUMBER CANNOT SETTLE. Handing over
      //      "36.16994, -115.13983" lets a GC say the photo was taken 40 m
      //      off their property, from a measurement that is routinely 40 m
      //      out. Precision that is not accuracy is worse than nothing in a
      //      dispute, which is the same reason `MEASURE` annotations do not
      //      measure (media-annotations.prisma).
      //
      // ENFORCED STRUCTURALLY, in the two ways this file already uses:
      // `PortalJobPhoto` does not HAVE these fields, so a future edit that
      // wants them has to change the type, this select and the component;
      // and this is an explicit select, so the columns are never even
      // fetched. job-media-location.dbtest.ts asserts on the serialised
      // result that neither the digits nor the keys appear.
      //
      // If this is ever revisited, revisit it as a SHARING decision — a
      // per-photo opt-in like `sharedWithClientAt` — and not as a widening
      // of this projection. "Show the client where this was taken" is a
      // choice somebody makes about one photo, not a property of the query.
      // THE MARKS GO TO THE GC, and that is the point of the feature rather
      // than a widening to be nervous about: an arrow drawn to show a GC
      // where the damage is, is worthless if the GC cannot see it. What is
      // still withheld is everything ABOUT the mark — no author, no
      // timestamp — so the projection below takes the geometry and the
      // words and nothing else.
      annotations: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, kind: true, x1: true, y1: true, x2: true, y2: true, label: true },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    blobUrl: row.blobUrl,
    kind: jobMediaKind(row.contentType) ?? "photo",
    caption: row.caption,
    capturedAtLabel: formatCapturedAt(row.capturedAt, timeZone),
    marks: row.annotations.map(toMark),
  }));
}

/** How many shared photos each of these jobs has, for the portal's job
 * list.
 *
 * ONE `groupBy` FOR THE WHOLE LIST, not a count per job: the list page
 * already renders every job the contact has, and a count inside that map
 * would be the N+1 that `loadJobMedia`'s tag include exists to warn about.
 *
 * A job with no shared photos is ABSENT from the result rather than present
 * with a zero, which is what `groupBy` does and what the caller wants — the
 * portal shows the line only when there is something to look at.
 */
export async function countSharedJobMediaByJob(jobIds: string[]): Promise<Map<string, number>> {
  if (jobIds.length === 0) return new Map();
  const rows = await prisma.jobMedia.groupBy({
    by: ["jobId"],
    where: { jobId: { in: jobIds }, sharedWithClientAt: { not: null } },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.jobId, row._count._all]));
}

/* ------------------------------------------------------------------ *
 * The printed document's half
 * ------------------------------------------------------------------ */

/**
 * One capture as the printed photo report renders it.
 *
 * A SEPARATE TYPE FROM BOTH `JobMediaCardData` AND `PortalJobPhoto`, and
 * for the reason `PortalJobPhoto` is separate: the exclusions are the
 * feature, and a type that does not HAVE a field cannot forget to withhold
 * it. This document is the one artefact of this feature that LEAVES THE
 * APP ENTIRELY — it becomes a PDF on somebody's desktop, an email
 * attachment, an exhibit — so it takes the portal's exclusions rather than
 * the internal card's generosity, and takes them for the same reasons
 * argued at length on `loadSharedJobMediaForClient`'s `select`:
 *
 *   - NO TAGS. "backcharge", "GC delay", "rework" is this sub's own framing
 *     of the job, written for their retrieval and their argument. A printed
 *     page carrying those words cannot be un-handed-over.
 *   - NO PHOTOGRAPHER. A name on a photo of a defect is a person to
 *     complain about. The company printed the document; the company is in
 *     the header.
 *   - NO COORDINATES. A phone's fix is where a person was standing to a few
 *     metres at a stated minute, and forty of them is a movement record.
 *     The four grounds are on the portal select and none of them get weaker
 *     when the page is paper.
 *   - NO FILE SIZE, NO CLOCK WARNING, NO EDIT AFFORDANCES. Storage detail,
 *     an internal note that the sub's own device looks wrong, and controls
 *     a document does not have.
 *
 * WHAT IT CARRIES THAT THE PORTAL DOES NOT is `clientCanSee`, and it is not
 * a widening of the disclosure — it is the opposite. On an internal
 * selection the document mixes captures the GC has seen with captures they
 * have not, and the person holding the paper has to be able to tell which
 * page is which before they photocopy it. It is a boolean rather than the
 * disclosure timestamp: the report answers "may this leave the building",
 * not "when was it disclosed", and the date is the portal's business.
 */
export type JobPhotoReportCapture = {
  id: string;
  blobUrl: string;
  /** Photo, video or voice note. The report can only PRINT the first —
   *  see `partitionPrintable` for why the other two are listed rather than
   *  dropped. */
  kind: JobMediaKind;
  caption: string | null;
  capturedAtLabel: string;
  /** The day this belongs to, in the viewer's zone, for the page heading it
   *  is grouped under. Derived on read like every other label here. */
  dayLabel: string;
  marks: JobMediaMark[];
  /** Whether the job's client can currently see this through their portal
   *  link. Drives one printed note on an internal report and nothing else. */
  clientCanSee: boolean;
};

/**
 * The captures one printed report is built from.
 *
 * A SEPARATE READ FROM `loadJobMedia` RATHER THAN A FLAG ON IT. The two
 * differ in their projection (above), in their default (this one is called
 * with `shared: true` unless somebody chose otherwise — see
 * lib/photo-report.ts) and in what a mistake costs: a gallery that shows
 * one photo too many is a page the sub is already looking at, and a
 * document that does is a disclosure. Sharing one function would put both
 * behind one `where` builder that nobody can read twice as carefully for
 * one caller than the other.
 *
 * THE `shared` PARAMETER IS THREE-VALUED and `undefined` means both, the
 * same shape and the same trap as `JobMediaFilter.shared`: written the
 * obvious way — `...(shared ? … : {})` — the "not shared" report would
 * silently become the everything report, which on this surface prints the
 * crew's own mistakes onto a document headed with the client's job name.
 *
 * Ordered newest-first like every other read in this file, and REVERSED
 * afterwards by `oldestFirst` in the page: the cap has to keep the most
 * recent captures, and the document has to read forwards. That split is
 * stated in lib/photo-report.ts rather than done quietly here.
 */
export async function loadJobMediaForReport(
  {
    jobId,
    companyId,
    shared,
    tagId,
    take,
  }: {
    jobId: string;
    companyId: string;
    shared?: boolean;
    tagId?: string;
    take: number;
  },
  timeZone: string,
): Promise<JobPhotoReportCapture[]> {
  const rows = await prisma.jobMedia.findMany({
    where: jobMediaWhere({
      companyId,
      jobId,
      ...(tagId ? { tagId } : {}),
      ...(shared === undefined ? {} : { shared }),
    }),
    take,
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
    // An explicit `select` rather than the default row, for the same reason
    // the portal read has one: the columns that must never reach this
    // document are not even fetched, so a future edit that wants them is a
    // visible change to this list rather than a field that appeared.
    select: {
      id: true,
      blobUrl: true,
      caption: true,
      capturedAt: true,
      contentType: true,
      sharedWithClientAt: true,
      // NO `capturedBy`, NO `tags`, NO `capturedLatitude`/`Longitude`/
      // `capturedAccuracyMeters`, NO `byteSize`, NO `createdAt`. Each one is
      // argued on `JobPhotoReportCapture` above.
      annotations: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, kind: true, x1: true, y1: true, x2: true, y2: true, label: true },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    blobUrl: row.blobUrl,
    kind: jobMediaKind(row.contentType) ?? "photo",
    caption: row.caption,
    capturedAtLabel: formatCapturedAt(row.capturedAt, timeZone),
    dayLabel: formatCapturedDay(row.capturedAt, timeZone),
    marks: row.annotations.map(toMark),
    // The COLUMN is a timestamp and this is a boolean derived from it on
    // every read — one stored fact, no second flag beside it that could
    // disagree, exactly as the card's `sharedWithClientLabel` is.
    clientCanSee: row.sharedWithClientAt !== null,
  }));
}
