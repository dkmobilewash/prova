"use client";

import { PageTabs } from "@/components/PageTabs";
import type { JobTab } from "@/components/job/jobTabs";

/**
 * The job's tab row, directly under the stage bar (`JobStageNav`): the bar
 * says where the job is, this row is how you get around it. Restored from
 * the pre-#748 `components/JobSectionNav.tsx` in Concept G's tokens, and
 * since the declutter pass (2026-10-13) it is `PageTabs` with the job's
 * name on it — the same row /settings and /union-compliance use.
 *
 * `tabs` comes from `jobTabs()`, already filtered to this viewer and stage.
 */
export function JobSectionNav({ tabs }: { tabs: JobTab[] }) {
  return <PageTabs tabs={tabs} label="Job sections" />;
}
