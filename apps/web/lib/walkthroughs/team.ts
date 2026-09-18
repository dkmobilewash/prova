import type { Walkthrough } from "./types";

/** /team — who is on the account, and what each person can see. */
export const teamWalkthrough: Walkthrough = {
  route: "/team",
  title: "Your team",
  steps: [
    {
      anchor: "team-members",
      title: "Everyone on the account",
      body:
        "Each person who can sign in to your company. The account owner can use the menu on a line to pick what that person does, which decides what they see; leaving it on Full office access shows them everything.",
    },
    {
      anchor: "team-invite",
      title: "Invite someone",
      body:
        "Type their email and press Invite. No email is sent — send them the sign-up link yourself, and when they sign up with that address they join your company.",
    },
    {
      anchor: "team-pending",
      title: "Waiting to join",
      body: "People you invited who have not signed up yet. Press Cancel on a line to take the invite back.",
    },
  ],
};
