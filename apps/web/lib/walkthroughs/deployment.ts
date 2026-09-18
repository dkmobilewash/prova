import type { Walkthrough } from "./types";

/** /deployment — who and what is on which job right now. */
export const deploymentWalkthrough: Walkthrough = {
  route: "/deployment",
  title: "Who is where",
  steps: [
    {
      anchor: "deploy-clashes",
      title: "A machine in two places",
      body:
        "Two records say the same piece of equipment is on two jobs at once. One of them is wrong — fix it on the Equipment page.",
    },
    {
      anchor: "deploy-crew",
      title: "Your crew",
      body:
        "Everyone on the team and the running jobs they are on. Someone split across more than one job is marked, and someone on none says Not on an active job.",
    },
    {
      anchor: "deploy-no-jobs",
      title: "Start with a job",
      body:
        "This page fills in once you have jobs under way. Press Create a job to add your first one.",
    },
    {
      anchor: "deploy-none-running",
      title: "Nothing running yet",
      body:
        "Only jobs that are contracted or in progress show here. An estimate has nobody on it yet.",
    },
    {
      anchor: "deploy-by-job",
      title: "Each running job",
      body:
        "Who is on each job and what equipment is signed out to it, with how long it has been there. Put people on a job from the job's own page; sign equipment out from the Equipment page.",
    },
    {
      anchor: "deploy-stranded",
      title: "Equipment nobody brought back",
      body:
        "These pieces are still logged out to a job that has finished or never started. Usually someone forgot to log the return — find it before someone goes looking.",
    },
  ],
};
