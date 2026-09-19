import type { WalkthroughStep } from "./types";

/**
 * "Take the full tour": one guided walk ACROSS the app, in the order a new
 * contractor would actually use it — see what needs you today, ask the
 * assistant, start a job, add the people, plan the week, write down the
 * day, chase the next job, get paid, connect the apps you already use.
 *
 * It is not a second tour system. Each stop is a page plus one to three of
 * that page's EXISTING walkthrough anchors, re-narrated to say how the page
 * fits with the next one. The overlay is the same `WalkthroughTour` the
 * per-page tours use; `components/FullTour.tsx` only moves between pages
 * and hands it one stop at a time.
 *
 * A stop may name more anchors than it will show, when a page renders one
 * of two states (its empty state OR its list): the engine skips any anchor
 * not on screen, so a brand-new account and a busy one both get a sensible
 * one-to-three cards. `fullTourCensus.test.ts` holds every anchor here to
 * the route's own walkthrough and to a `data-tour` literal its page
 * renders, so a stop cannot point at nothing.
 *
 * Pure: no DOM, no router. Storage is passed in so every rule below is
 * tested without a browser (full-tour.test.ts).
 */

export type TourStop = {
  /** Unique; also what is remembered in sessionStorage. */
  id: string;
  /** A real page, written the way `app/` writes it. Static only — the tour
   * navigates here, so there is no id to fill in. */
  route: string;
  /** Two or three words, shown as "Stop 3 of 11 · <title>". */
  title: string;
  steps: WalkthroughStep[];
};

export const FULL_TOUR: TourStop[] = [
  {
    id: "today",
    route: "/dashboard",
    title: "Your day",
    steps: [
      {
        anchor: "dashboard-getting-started",
        title: "Start here",
        body: "This checklist is your first week in C Stream. Each line ticks itself once the real thing is done, so there is nothing to mark off by hand.",
      },
      {
        anchor: "dashboard-needs-attention",
        title: "What needs you today",
        body: "Open the app and look here first: late invoices, papers about to expire and jobs heading over budget. Next, the assistant.",
      },
    ],
  },
  {
    id: "ask",
    route: "/ask",
    title: "Ask C Stream",
    steps: [
      {
        anchor: "ask-panel",
        title: "Ask in plain words",
        body: "Ask what is overdue, or tell it to start a job or add a contact. It always shows you what it will change first and saves nothing until you press its button.",
      },
      {
        anchor: "ask-box",
        title: "Type, attach or talk",
        body: "Type here, attach a set of plans for it to read, or tap the microphone if you see one. Next, starting a job by hand.",
      },
    ],
  },
  {
    id: "new-job",
    route: "/jobs/new",
    title: "Jobs and estimates",
    steps: [
      {
        anchor: "new-job-name",
        title: "Every estimate is a job",
        body: "Anything you price starts here: a name you will recognise, and who it is for. The tour will not fill anything in.",
      },
      {
        anchor: "new-job-create",
        title: "Create it when you are ready",
        body: "Create job makes it an estimate and opens its page, where you add prices, send the contract and later bill it. Next, the people you work for.",
      },
    ],
  },
  {
    id: "contacts",
    route: "/contacts",
    title: "Contacts",
    steps: [
      {
        anchor: "contacts-add",
        title: "Clients, contractors, suppliers",
        body: "Everyone you work with lives here. Starting a job for someone new adds them for you, so you rarely need this button.",
      },
      {
        anchor: "contacts-list",
        title: "One line each",
        body: "Tap a name to see their jobs, their people and any bids they invited you to. Next, who is working where.",
      },
      {
        anchor: "contacts-empty",
        title: "Nobody here yet",
        body: "Your first job will put its client here. Next, who is working where.",
      },
    ],
  },
  {
    id: "schedule",
    route: "/schedule",
    title: "Schedule",
    steps: [
      {
        anchor: "schedule-no-jobs",
        title: "The week, once there is a job",
        body: "The schedule lays out your jobs and who is on them. Once you have a job, this is where you plan the next two weeks.",
      },
      {
        anchor: "schedule-crew-board",
        title: "Who is working where",
        body: "Each day for the next two weeks and who is on which job. It shows only what you put on it.",
      },
      {
        anchor: "schedule-put-on",
        title: "Put someone on a day",
        body: "Pick the job, the person and the day. Next, writing down what happened on site.",
      },
    ],
  },
  {
    id: "field-reports",
    route: "/field-reports",
    title: "Daily reports",
    steps: [
      {
        anchor: "field-reports-no-jobs",
        title: "A record of every day",
        body: "A daily report says who was on site, what got done, the weather and what held you up. It needs a job first.",
      },
      {
        anchor: "field-reports-log-day",
        title: "Log a day",
        body: "A couple of minutes at the end of each day. The weather and delays boxes are the ones that matter if there is ever an argument later.",
      },
    ],
  },
  {
    id: "photos",
    route: "/photos",
    title: "Photos",
    steps: [
      {
        anchor: "photos-no-jobs",
        title: "Photos, filed by job",
        body: "Every photo, video and voice note is filed under a job. On a phone the upload opens the camera.",
      },
      {
        anchor: "photos-job-filter",
        title: "Pick a job to add photos",
        body: "Tap a job to see its photos and add new ones. You can share chosen photos with the client by the job's portal link.",
      },
    ],
  },
  {
    id: "punch-lists",
    route: "/punch-lists",
    title: "Punch lists",
    steps: [
      {
        anchor: "punch-add",
        title: "What still needs fixing",
        body: "Walk the job and add one item at a time, like “touch-up paint, hallway”. Tick each off when it is done. With no jobs yet, this box says punch list items attach to a job, and there aren't any yet.",
      },
      {
        anchor: "punch-open",
        title: "What is still open",
        body: "The count of items not fixed yet. Next, the work you are chasing.",
      },
    ],
  },
  {
    id: "pipeline",
    route: "/pipeline",
    title: "Pipeline and bids",
    steps: [
      {
        anchor: "pipeline-chase-list",
        title: "Your next jobs",
        body: "Jobs you have heard about but nobody has asked you to price yet. Keep them here so none slips.",
      },
      {
        anchor: "pipeline-waiting",
        title: "Bids waiting on you",
        body: "Invitations to bid you have not finished, with the date they asked for. Red is past it.",
      },
      {
        anchor: "pipeline-no-invitations",
        title: "Invitations to bid",
        body: "When a contractor asks you to price a job, it shows here. Next, getting paid.",
      },
    ],
  },
  {
    id: "cash-flow",
    route: "/cash-flow",
    title: "Getting paid",
    steps: [
      {
        anchor: "cash-flow-empty",
        title: "Invoices start on the job",
        body: "You bill from a job's own page, in its Invoices section. Everything you bill then shows up here: who owes you, how late, and what should arrive when.",
      },
      {
        anchor: "cash-flow-aging",
        title: "Who owes you, and how late",
        body: "Each unpaid invoice and how many days late it is. Next, connecting the apps you already use.",
      },
    ],
  },
  {
    id: "integrations",
    route: "/settings/integrations",
    title: "Your other apps",
    steps: [
      {
        anchor: "integrations-intro",
        title: "Bring your work in",
        body: "Connect Jobber, where it's set up on this install, to bring your clients, jobs and open quotes across — and QuickBooks for the books. Connecting never lets one company see another's data.",
      },
      {
        anchor: "integrations-list",
        title: "One card per app",
        body: "Each card says whether it is connected. That is the tour — Help, top right, can walk you through any page again.",
      },
    ],
  },
];

/** The stops this person can open, in order. `canOpen` is the nav's own
 * rule (components/navItems.tsx), passed in so this file stays free of
 * the nav's icons and is testable on its own. A stop the viewer cannot
 * reach is dropped entirely rather than shown as a refusal — and dropped
 * BEFORE numbering, so "Stop 3 of 9" counts only stops they will see. */
export function stopsFor(canOpen: (route: string) => boolean, stops: TourStop[] = FULL_TOUR): TourStop[] {
  return stops.filter((stop) => canOpen(stop.route));
}

// ---------------------------------------------------------------- state --

/** Where the tour is, per TAB (sessionStorage): a reload or a mid-tour
 * click elsewhere resumes it, and a new tab does not inherit it. */
export const FULL_TOUR_KEY = "cstream:full-tour";

/** The first-visit offer on the dashboard, dismissed per browser. */
export const FULL_TOUR_OFFER_KEY = "cstream:full-tour:offer-dismissed";

/** Fired on window when the tour is started or ended from anywhere, so the
 * one runner in the layout re-reads the state. */
export const FULL_TOUR_EVENT = "cstream:full-tour";

export type FullTourState = { stop: string };

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

export function readTourState(storage: Storage | null | undefined, stops: TourStop[] = FULL_TOUR): FullTourState | null {
  try {
    const raw = storage?.getItem(FULL_TOUR_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const stop = (parsed as { stop?: unknown }).stop;
    // A stop id from an older build that no longer exists is no tour at
    // all, rather than a tour stuck on nothing.
    return typeof stop === "string" && stops.some((candidate) => candidate.id === stop) ? { stop } : null;
  } catch {
    return null;
  }
}

export function writeTourState(storage: Storage | null | undefined, state: FullTourState | null): void {
  try {
    if (state) storage?.setItem(FULL_TOUR_KEY, JSON.stringify(state));
    else storage?.removeItem(FULL_TOUR_KEY);
  } catch {
    // Blocked storage: the tour still runs, it just will not survive a reload.
  }
}

/** The stop after / before `id` among `stops`, or null at either end. An id
 * not in the list (the viewer lost access mid-tour) goes to the first stop
 * after it in the FULL order, so the tour still moves forward. */
export function stopAfter(stops: TourStop[], id: string, all: TourStop[] = FULL_TOUR): TourStop | null {
  const at = stops.findIndex((stop) => stop.id === id);
  if (at !== -1) return stops[at + 1] ?? null;
  const fullAt = all.findIndex((stop) => stop.id === id);
  return stops.find((stop) => all.findIndex((candidate) => candidate.id === stop.id) > fullAt) ?? null;
}

export function stopBefore(stops: TourStop[], id: string): TourStop | null {
  const at = stops.findIndex((stop) => stop.id === id);
  return at > 0 ? stops[at - 1] : null;
}

export function isOfferDismissed(storage: Pick<Storage, "getItem"> | null | undefined): boolean {
  try {
    return storage?.getItem(FULL_TOUR_OFFER_KEY) === "1";
  } catch {
    // Unreadable storage: do not nag someone whose browser cannot remember
    // that they said no.
    return true;
  }
}

export function dismissOffer(storage: Pick<Storage, "setItem"> | null | undefined): void {
  try {
    storage?.setItem(FULL_TOUR_OFFER_KEY, "1");
  } catch {
    // Nothing to do: the banner goes away for this page view regardless.
  }
}

// -------------------------------------------------------------- browser --

function session(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function local(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Start from the first stop. Any entry point calls this; the runner in the
 * layout picks it up. Starting also retires the first-visit offer. */
export function startFullTour(): void {
  writeTourState(session(), { stop: FULL_TOUR[0].id });
  dismissOffer(local());
  window.dispatchEvent(new Event(FULL_TOUR_EVENT));
}

export function browserTourState(): FullTourState | null {
  return readTourState(session());
}

export function setBrowserTourState(state: FullTourState | null): void {
  writeTourState(session(), state);
}

export function browserOfferDismissed(): boolean {
  return isOfferDismissed(local());
}

export function dismissBrowserOffer(): void {
  dismissOffer(local());
}
