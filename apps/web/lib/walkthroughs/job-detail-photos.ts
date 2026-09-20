import type { Walkthrough } from "./types";

/**
 * /jobs/[id]/photos — site photos, video and voice notes. Split out of
 * the single `jobDetailWalkthrough` on 2026-09-20; see `job-detail.ts`'s
 * doc comment for why. Named `job-detail-photos` to avoid colliding with
 * the top-level `/photos` page's own walkthrough file.
 */
export const jobDetailPhotosWalkthrough: Walkthrough = {
  route: "/jobs/[id]/photos",
  title: "A job — photos",
  steps: [
    {
      anchor: "job-photos",
      title: "Photos, video and voice notes",
      body:
        "Add pictures, a short video or a voice note from the site. On a phone this opens the camera. A photo of the place before you start is the one people most wish they had.",
    },
  ],
};
