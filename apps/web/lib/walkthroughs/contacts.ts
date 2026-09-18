import type { Walkthrough } from "./types";

/** /contacts — the contractors, clients and suppliers you work with. */
export const contactsWalkthrough: Walkthrough = {
  route: "/contacts",
  title: "Your contacts",
  steps: [
    {
      anchor: "contacts-add",
      title: "Add a contact",
      body:
        "Press Add a contact for a contractor, client, developer or supplier. Type the name and whatever else you have, then press Save contact.",
    },
    {
      anchor: "contacts-empty",
      title: "No contacts yet",
      body:
        "Everyone you add is listed here. Contacts are also added for you when you start a job for someone new.",
    },
    {
      anchor: "contacts-list",
      title: "Everyone you work with",
      body:
        "One line each, with how many jobs you have done for them. Tap a name to see their people, their jobs, and any bids they have invited you to.",
    },
  ],
};
