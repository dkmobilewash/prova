import type { Walkthrough } from "./types";

/** /equipment — your own gear, and which job it is on. */
export const equipmentWalkthrough: Walkthrough = {
  route: "/equipment",
  title: "Your equipment",
  steps: [
    {
      anchor: "equipment-add",
      title: "Add a piece of equipment",
      body:
        "Press Add equipment and give it a name, like “Genie lift #2”. Add the gear that moves between jobs — lifts, scaffolding, mixers.",
    },
    {
      anchor: "equipment-empty",
      title: "Nothing added yet",
      body:
        "Once your equipment is in, this list tells you where each piece is without calling the foreman.",
    },
    {
      anchor: "equipment-list",
      title: "Your gear",
      body: "Every piece you own, by name. Press Edit on one to change its name, type or tag number.",
    },
    {
      anchor: "equipment-where",
      title: "Where it is right now",
      body:
        "In the yard, or which job it is on and for how long. Press Send out to a job when it leaves and Bring it back when it returns — that is what keeps this line right.",
    },
  ],
};
