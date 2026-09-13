// The site photo report — a job's captures as a document, with the marks
// drawn on the photographs.
//
// WHAT WAS MISSING. A sub photographs a condition, drags an arrow onto it
// and shows it to the GC through the portal, and then has nothing to HAND
// anybody. The marks live as rows beside the file and are never burned into
// the pixels — deliberately, because a site photo is an evidence record
// (media-annotations.prisma) — so "just send them the photo" sends an
// unmarked photograph and loses the whole point of the arrow. This is the
// document that carries both.
//
// PRINT-STYLED HTML, NOT A GENERATED PDF, and that is this repo's existing
// answer rather than a shortcut. `pay-applications/[invoiceId]`,
// `certified-payroll/wh-347` and `union-compliance/remittance` are all the
// same shape: a white sheet inside the dark app, chrome hidden with
// `print:hidden`, and the browser's own Print / Save as PDF doing the
// conversion. There is no PDF library in this monorepo and this feature did
// not add one.
//
// IT IS ALSO WHAT MAKES THE MARKS POSSIBLE AT ALL, which is worth stating
// because the obvious alternative fails. A flattened export means drawing
// the photograph into a `<canvas>` and reading the pixels back out with
// `toBlob`, and a cross-origin image TAINTS a canvas — the read throws
// `SecurityError` unless the blob host serves the CORS headers
// `crossOrigin="anonymous"` needs. Whether it does could not be established
// from here (see changelog.d/site-photo-report.md for what was checked and
// what the one measurement is). Printing needs none of that: the browser
// composites the `<img>` and the SVG overlay in its own print pipeline and
// nothing ever reads a pixel back, so the marks land on the paper with no
// canvas, no CORS and no new dependency.

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { PrintButton } from "@/components/PrintButton";
import { JobMediaMarks } from "@/components/JobMediaMarks";
import { viewerTimeZone } from "@/lib/viewerToday";
import { countJobMedia, loadJobMediaForReport, loadJobMediaTags } from "@/lib/job-media-query";
import { formatCapturedDay } from "@/lib/job-media";
import {
  PHOTO_REPORT_LIMIT,
  PHOTO_REPORT_SELECTIONS,
  groupByDay,
  oldestFirst,
  parsePhotoReportSelection,
  partitionPrintable,
  photoReportCapNote,
  photoReportHref,
  photoReportIsInternal,
  photoReportSelectionLabel,
  photoReportSharedFlag,
} from "@/lib/photo-report";

/** What each chip says on screen. Shorter than the printed sentence
 *  `photoReportSelectionLabel` produces — a chip is a control and the
 *  header is a claim the paper has to carry on its own. */
const SELECTION_CHIP: Record<(typeof PHOTO_REPORT_SELECTIONS)[number], string> = {
  shared: "Shared with client",
  "not-shared": "Not shared",
  everything: "Everything",
};

export default async function JobPhotoReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ include?: string; tag?: string }>;
}) {
  const { id } = await params;
  const { include, tag } = await searchParams;
  // MANAGE_FIELD, the same capability `/photos`, the job page's own photo
  // section and every other site-capture surface takes. A document showing
  // strictly what those galleries show must not be reachable by somebody
  // who cannot open them, and must not be harder to reach either — a
  // different capability here would be an inconsistency, not a tightening.
  const { context, allowed } = await requireCapability("MANAGE_FIELD");
  if (!allowed) return <NoAccess capability="MANAGE_FIELD" />;
  const { company } = context;

  const job = await prisma.job.findUnique({ where: { id }, include: { contact: true } });
  if (!job || job.companyId !== company.id) notFound();

  const timeZone = await viewerTimeZone();
  const tags = await loadJobMediaTags(company.id);
  // Both parameters are validated against something real before they filter
  // anything: an unrecognised selection falls back to the SAFE default
  // (`parsePhotoReportSelection`), and a tag id this company does not own
  // falls back to no tag filter rather than to an empty document with a
  // live chip nothing on the page can explain. Same posture `/photos`
  // takes, with the one deliberate difference argued in lib/photo-report.ts.
  const selection = parsePhotoReportSelection(include);
  const activeTag = tag && tags.some((t) => t.id === tag) ? tag : null;
  const shared = photoReportSharedFlag(selection);

  const [captures, total] = await Promise.all([
    loadJobMediaForReport(
      {
        jobId: job.id,
        companyId: company.id,
        ...(shared === undefined ? {} : { shared }),
        ...(activeTag ? { tagId: activeTag } : {}),
        take: PHOTO_REPORT_LIMIT,
      },
      timeZone,
    ),
    // The same filter through the same builder the read uses, so the "most
    // recent N of M" line is about the captures on the paper underneath it.
    // A count that ignored the tag filter would be a bigger, wrong number
    // stated with total confidence — the exact bug `countJobMedia`'s own
    // comment exists to prevent.
    countJobMedia({
      companyId: company.id,
      jobId: job.id,
      ...(shared === undefined ? {} : { shared }),
      ...(activeTag ? { tagId: activeTag } : {}),
    }),
  ]);

  // The document reads forwards; the query read backwards so the cap kept
  // the most recent. Both halves of that are stated in lib/photo-report.ts.
  const ordered = oldestFirst(captures);
  const { printable, notPrintable } = partitionPrintable(ordered);
  const days = groupByDay(printable);
  const capNote = photoReportCapNote(captures.length, total);
  const internal = photoReportIsInternal(selection);
  const preparedOn = formatCapturedDay(new Date(), timeZone);

  const chip = (active: boolean) =>
    `inline-flex min-h-11 items-center rounded-md border px-3 py-2 text-sm ${
      active
        ? "border-blue-500 text-blue-400"
        : "border-slate-700 text-slate-300 hover:border-slate-500"
    }`;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 print:max-w-none print:px-0 print:py-0">
      {/* Everything above the sheet is the app, not the document. */}
      <div className="print:hidden">
        <Link href={`/jobs/${job.id}`} className="text-sm text-blue-400 hover:underline">
          ← Back to job
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">Site photo report</h1>
            <p className="mt-1 text-sm text-slate-400">
              {job.name} · the marks are drawn on the photos, so the printed page carries them.
            </p>
          </div>
          <PrintButton />
        </div>

        {/* WHAT GOES IN IS A CHOICE, AND THE CHOICE IS THE FEATURE. A job's
            gallery holds another trade's damage kept for a backcharge, an
            unsafe condition documented defensively, and the crew's own
            mistake before it was put right. The default is the set the
            client has already been shown; widening it is one deliberate
            click that also changes what the printed header says. */}
        <div className="mt-5 flex flex-wrap gap-2">
          {PHOTO_REPORT_SELECTIONS.map((value) => (
            <Link
              key={value}
              href={photoReportHref(job.id, { selection: value, tag: activeTag })}
              className={chip(selection === value)}
            >
              {SELECTION_CHIP[value]}
            </Link>
          ))}
        </div>

        {/* The tag row narrows WITHIN the selection rather than replacing
            it — "the west-wall photos we have already shown Turner" is the
            compound question, and either chip alone answers a different
            one. Only tags this company has actually used are offered; the
            active one stays whatever its count so the chip you are standing
            on never vanishes underneath you. */}
        {tags.some((t) => t.photoCount > 0) && (
          <div className="mt-2 flex flex-wrap gap-2">
            <Link
              href={photoReportHref(job.id, { selection })}
              className={chip(!activeTag)}
            >
              All tags
            </Link>
            {tags
              .filter((t) => t.photoCount > 0 || t.id === activeTag)
              .map((t) => (
                <Link
                  key={t.id}
                  href={photoReportHref(job.id, { selection, tag: t.id })}
                  className={chip(activeTag === t.id)}
                >
                  {t.name}
                </Link>
              ))}
          </div>
        )}

        <p className="mt-4 max-w-2xl text-xs text-slate-500">
          Print / Save as PDF produces the document. Video and voice notes cannot print and are
          listed at the end rather than dropped, so nobody reads this as the whole record.
        </p>
      </div>

      {/* THE SHEET. White, black text — the only surface in the product that
          is not the dark chrome, matching wh-347 and the remittance report,
          because it is a document somebody hands over rather than a screen
          they work on. */}
      <div className="mt-6 border border-slate-300 bg-white p-6 text-black print:mt-0 print:border-0 print:p-0">
        <div className="border-b border-black pb-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide">Site photo report</p>
          <p className="text-lg font-bold">{job.name}</p>
          <p className="text-[11px]">
            {company.name} · {job.contact.name} · prepared {preparedOn}
          </p>
          {/* THE DOCUMENT STATES ITS OWN SELECTION, on the paper, because
              the sentence has to survive leaving the app. A reader months
              later cannot see which chip was lit. */}
          <p className="mt-1 text-[11px]">
            <span className="font-semibold">Contents: </span>
            {photoReportSelectionLabel(selection)}
            {activeTag ? ` · tagged “${tags.find((t) => t.id === activeTag)?.name}”` : ""}
          </p>
        </div>

        {/* An internal selection says so, in red, at the top, where somebody
            about to email the PDF will see it. Judged on the SELECTION and
            not on the rows — see `photoReportIsInternal` for why a report
            that happens to contain only shared captures today still carries
            this. */}
        {internal && (
          <p className="mt-3 border border-red-600 p-2 text-[11px] font-semibold text-red-600">
            INTERNAL — this selection can include captures the client has not been shown. Check
            every page before sending this to anyone outside the company.
          </p>
        )}

        {printable.length === 0 && notPrintable.length === 0 ? (
          /* No blank sheet pretending to be a report. Which selection is on
             is the likeliest reason there is nothing, and it is stated
             about THIS DOCUMENT rather than about the job — "this job has
             no photos" would be a confident lie on a job whose photos are
             all on the other side of the filter. */
          <p className="mt-6 text-[11px]">
            Nothing on this job matches “{photoReportSelectionLabel(selection).toLowerCase()}”
            {activeTag ? " with that tag" : ""}, so there is no report to print. Share captures
            with the client from the gallery, or choose a wider selection above.
          </p>
        ) : (
          <>
            {days.map((group) => (
              <section key={group.day} className="mt-6">
                {/* `break-after-avoid` so a day heading never prints alone
                    at the foot of a page with its photographs overleaf. */}
                <h2 className="border-b border-black pb-1 text-[12px] font-bold uppercase tracking-wide print:break-after-avoid">
                  {group.day}
                </h2>

                {group.captures.map((capture) => (
                  /* `break-inside-avoid` is the whole of the page-break
                     handling and it is the right unit: a photograph split
                     across two sheets is useless, and its caption landing on
                     the next page separates the evidence from what it says. */
                  <figure key={capture.id} className="mt-4 print:break-inside-avoid">
                    {/* THE BOX IS 4:3 WITH `object-contain`, AND THAT IS
                        LOAD-BEARING RATHER THAN STYLING. A mark is stored as
                        a fraction of the surface it was DRAWN on, and
                        `JobMediaAnnotator` draws on a 4:3 box containing the
                        photo letterboxed (`object-contain`, its own
                        `surfaceRef` is what `pointAt` measures). Reproducing
                        that box exactly here is what makes an arrow land on
                        the paper where the person put it, for a photograph
                        of any shape — and it shows the whole frame rather
                        than the gallery thumbnail's crop, which a document
                        of evidence has to. */}
                    <div className="relative mx-auto aspect-[4/3] w-full max-w-xl overflow-hidden bg-slate-100 print:max-w-[5in]">
                      {/* A plain <img>, not next/image, for two reasons that
                          both bite only on paper. `loading="lazy"` — which
                          next/image applies by default — leaves an image
                          that has not scrolled into view UNLOADED when the
                          print dialog opens, and it prints as a blank box;
                          `eager` is not a preference here, it is the
                          difference between a document and a stack of empty
                          rectangles. And the optimizer is out of the picture
                          for these blobs anyway — JobMediaCard's comment
                          carries the reading of next@15.5.23 that
                          establishes why. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={capture.blobUrl}
                        alt={capture.caption ?? "Site photo"}
                        loading="eager"
                        decoding="sync"
                        className="h-full w-full object-contain"
                      />
                      {/* THE SAME COMPONENT THE GALLERY AND THE PORTAL USE,
                          unmodified. A third rendering path for marks would
                          be a third answer to "what does an arrow look
                          like", and the one that matters is that the paper
                          agrees with the screen the sub was looking at when
                          they decided to print it. `aspect` is 4/3 because
                          that is this box, exactly as the annotator's own
                          `aspect()` reads 4/3 off its surface. */}
                      <JobMediaMarks marks={capture.marks} aspect={4 / 3} />
                    </div>

                    <figcaption className="mx-auto mt-1 max-w-xl text-[11px] print:max-w-[5in]">
                      <span className="font-semibold">{capture.capturedAtLabel}</span>
                      {capture.caption ? ` — ${capture.caption}` : " — no caption"}
                      {capture.marks.length > 0 && (
                        <span className="text-slate-600">
                          {" "}
                          · {capture.marks.length === 1 ? "1 mark" : `${capture.marks.length} marks`}{" "}
                          drawn on this photo
                        </span>
                      )}
                      {/* Only on an internal document, and only on the pages
                          that are the reason it is internal. On a
                          shared-only report every page is disclosable and a
                          note on each one would be noise that trains the
                          reader to skip it. */}
                      {internal && !capture.clientCanSee && (
                        <span className="font-semibold text-red-600"> · not shown to the client</span>
                      )}
                    </figcaption>
                  </figure>
                ))}
              </section>
            ))}

            {/* WHAT CANNOT BE PRINTED IS NAMED RATHER THAN DROPPED. The
                argument is on `partitionPrintable`: a document that silently
                omits a walk-through video tells its reader the job's record
                is these photographs, and a GC handed it in a dispute would
                reasonably say the sub disclosed everything they had. */}
            {notPrintable.length > 0 && (
              <section className="mt-8 print:break-inside-avoid">
                <h2 className="border-b border-black pb-1 text-[12px] font-bold uppercase tracking-wide">
                  Also on this job, and not printable
                </h2>
                <p className="mt-2 text-[11px]">
                  {notPrintable.length === 1 ? "This capture is" : `These ${notPrintable.length} captures are`}{" "}
                  in the same selection as the photographs above. Paper cannot hold a recording, so
                  they are listed rather than left out — open the job in Prova to watch or listen.
                </p>
                <ul className="mt-2">
                  {notPrintable.map((capture) => (
                    <li key={capture.id} className="text-[11px]">
                      <span className="font-semibold">
                        {capture.kind === "video" ? "Video" : "Voice note"}
                      </span>
                      {" · "}
                      {capture.capturedAtLabel}
                      {capture.caption ? ` — ${capture.caption}` : " — no caption"}
                      {internal && !capture.clientCanSee && (
                        <span className="font-semibold text-red-600"> · not shown to the client</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* ON THE PAPER, not only on the screen: a capped document that
                says nothing is one whose reader believes they hold the whole
                record. */}
            {capNote && <p className="mt-6 text-[11px] font-semibold">{capNote}</p>}
          </>
        )}
      </div>
    </div>
  );
}
