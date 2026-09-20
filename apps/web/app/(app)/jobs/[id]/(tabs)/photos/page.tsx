import { NoAccess } from "@/components/NoAccess";
import { JobMediaSection } from "@/components/JobMediaSection";
import { countJobMedia, loadJobMedia, loadJobMediaTags } from "@/lib/job-media-query";
import { requireCapability } from "@/lib/authz";
import { requireJobGivenContext } from "@/lib/jobs/job-access";
import { viewerTimeZone } from "@/lib/viewerToday";

const JOB_MEDIA_LIMIT = 12;

/**
 * Photos — site photos, video and voice notes. Hard-gated on MANAGE_FIELD,
 * exactly the capability the monolith withheld this section behind
 * (`showsField`, the same gate `/photos`, `/punch-lists` and
 * `/field-reports` use company-wide).
 */
export default async function JobPhotosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { context, allowed } = await requireCapability("MANAGE_FIELD");
  if (!allowed) return <NoAccess capability="MANAGE_FIELD" />;
  const { company, job: jobRef } = await requireJobGivenContext(id, context);

  const timeZone = await viewerTimeZone();
  const [jobMedia, jobMediaTotal, jobMediaTags] = await Promise.all([
    loadJobMedia({ companyId: company.id, jobId: jobRef.id, take: JOB_MEDIA_LIMIT }, timeZone),
    countJobMedia({ companyId: company.id, jobId: jobRef.id }),
    loadJobMediaTags(company.id),
  ]);

  return (
    <JobMediaSection
      jobId={jobRef.id}
      media={jobMedia}
      total={jobMediaTotal}
      tagNames={jobMediaTags.map((tag) => tag.name)}
      limit={JOB_MEDIA_LIMIT}
    />
  );
}
