import { PageShell } from "@prova/ui";
import { prisma } from "@prova/db";
import { notFound } from "next/navigation";
import { JobSpecSections } from "@/components/JobSpecSections";
import { SpecBookPanel } from "@/components/SpecBookPanel";
import { NoAccess } from "@/components/NoAccess";
import { PageHeader } from "@/components/PageHeader";
import { requireCapability } from "@/lib/authz";
import { loadJobSpecSections } from "@/lib/job-spec-sections-query";
import { loadSpecBookView } from "@/lib/specs/specBookQuery";
import { formatCalendarDate } from "@/lib/render-date";

/** The job's spec book. MANAGE_ESTIMATING, the gate on the upload token that
 * attaches a section's file. */
export default async function JobSpecsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { context, allowed } = await requireCapability("MANAGE_ESTIMATING");
  if (!allowed) return <NoAccess capability="MANAGE_ESTIMATING" />;
  const { company } = context;

  const job = await prisma.job.findFirst({ where: { id, companyId: company.id }, select: { id: true, name: true } });
  if (!job) notFound();
  const [allSections, book] = await Promise.all([loadJobSpecSections(job.id, company.id), loadSpecBookView(job.id, company.id)]);
  // A section found in a spec book is listed with its book, above; this list is the ones uploaded one PDF each.
  const sections = allSections.filter((section) => section.specBookId === null);

  return (
    <PageShell width="working">
      <PageHeader route="/submittals" parent={[{ href: `/jobs/${job.id}`, label: job.name }]} title="Specs" />
      <SpecBookPanel
        jobId={job.id}
        books={book.books}
        hasLegend={book.hasLegend}
        hasPlans={book.hasPlans}
        wallTypes={book.wallTypes}
        sections={book.sections.map((section) => ({
          id: section.id,
          sectionNumber: section.sectionNumber,
          title: section.title,
          pages: section.pageFrom === null ? null : section.pageFrom === section.pageTo ? `${section.pageFrom}` : `${section.pageFrom}–${section.pageTo}`,
          fromBook: section.specBookId !== null,
          fromDrawings: section.fromDrawings,
          reading: section.reading
            ? { id: section.reading.id, facts: section.reading.facts, on: formatCalendarDate(section.reading.on) }
            : null,
        }))}
      />
      <h2 className="mt-6 text-base font-semibold text-ink">Sections uploaded one at a time</h2>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        The sections from the bid this job was won from, plus any added here. This is only what has been uploaded, not
        necessarily the whole spec book.
      </p>
      <JobSpecSections
        jobId={job.id}
        companyId={company.id}
        sections={sections.map((section) => ({
          id: section.id,
          sectionNumber: section.sectionNumber,
          title: section.title,
          fileName: section.fileName,
          hasFile: section.fileUrl !== null,
          ownedByJob: section.jobId !== null,
          lastRead: section.submittalReadings[0]
            ? {
                on: formatCalendarDate(section.submittalReadings[0].createdAt),
                drafts: section.submittalReadings[0]._count.proposals,
              }
            : null,
        }))}
      />
    </PageShell>
  );
}
