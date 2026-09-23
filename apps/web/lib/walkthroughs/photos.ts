import type { Walkthrough } from "./types";

/** /photos — every job's site photos, videos and voice notes in one place. */
export const photosWalkthrough: Walkthrough = {
  route: "/photos",
  title: "Site photos",
  steps: [
    {
      anchor: "photos-no-jobs",
      title: "Start with a job",
      body:
        "Every photo is filed under a job, so you need one first. Press Create a job, then come back here.",
    },
    {
      anchor: "photos-job-filter",
      title: "Pick a job",
      body:
        "Tap a job to see only its photos and to add new ones. All jobs shows everything, newest first.",
    },
    {
      anchor: "photos-pick-job",
      title: "Adding photos",
      body: "The upload box shows up once you tap a job above.",
    },
    {
      anchor: "photos-add",
      title: "Add photos",
      body:
        "Choose photos, a video or a voice note. On a phone this opens the camera. The Photo report link under it makes a printable page of this job's photos.",
    },
    {
      anchor: "photos-tag-filter",
      title: "Find by tag",
      body:
        "Tags are your own words on a photo, like “west wall” or “damage”. Tap one to see only the photos that carry it; the number is how many have it.",
    },
    {
      anchor: "photos-shared-filter",
      title: "What the client can see",
      body:
        "Shared by link shows the photos anyone with the job's portal link can see. Not shared shows the ones kept to yourselves.",
    },
    {
      anchor: "photos-location-filter",
      title: "Where it was taken",
      body:
        "Has a location shows photos that saved where they were taken. Most phone photos do; ones sent from a computer often do not.",
    },
    {
      anchor: "photos-manage-tags",
      title: "Fix a tag",
      body:
        "Press Manage tags to rename or remove a tag. Renaming fixes every photo that carries it at once.",
    },
    {
      anchor: "photos-empty",
      title: "Nothing here yet",
      body:
        "No photos match what you picked. Use the links here to clear a filter, or pick a job and add the first one.",
    },
    {
      anchor: "photos-gallery",
      title: "Your photos",
      body:
        "Each photo has buttons to add a caption or a tag, mark it up, or share it by the portal link. Tick a few to make a photo report of just those.",
    },
  ],
};
