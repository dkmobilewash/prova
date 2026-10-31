import { PageShell } from "@prova/ui";
import { prisma } from "@prova/db";
import { notFound } from "next/navigation";
import { JobSpecSections } from "@/components/JobSpecSections";
import { NoAccess } from "@/components/NoAccess";
import { PageHeader } from "@/components/PageHeader";
import { requireCapability } from "@/lib/authz";
import { loadJobSpecSections } from "@/lib/job-spec-sections-query";
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
  const sections = await loadJobSpecSections(job.id, company.id);

  return (
    <PageShell width="working">
      <PageHeader
        route="/submittals"
        parent={[{ href: `/jobs/${job.id}`, label: job.name }]}
        title="Spec sections"
      />
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
