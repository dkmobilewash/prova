/**
 * What the change-orders section calls each state, and which band it sits in.
 *
 * WHY THIS FILE EXISTS. `ChangeOrderStatus` has always modelled the
 * lifecycle correctly — DRAFT → SUBMITTED → APPROVED / REJECTED / VOID,
 * with the schema comment on SUBMITTED already reading "This is the PCO
 * state". The SCREEN did not say any of it: one flat "Change orders"
 * heading over all five states, with the only difference a chip at the end
 * of the row. A construction manager reviewing the product stopped on that
 * section and asked "is this for executed change orders or for pending
 * change orders? There's a big difference." He is right, and the
 * difference is money: an EXECUTED change order has already moved the
 * contract sum, a PENDING one has not and may never.
 *
 * So nothing here is a new state or a new number. It is the vocabulary a
 * contractor uses, attached to the states that already exist, in one plain
 * module the row, the band heading and the tests all read from — so they
 * cannot disagree about what "pending" means.
 *
 * NOT a "use client" module on purpose: a constant exported from one
 * crosses the RSC boundary as a client-reference proxy, and an array stops
 * being an array (see lib/client-boundary.test.ts).
 */

/** Mirrors the Prisma enum. `changeOrderStates.test.ts` reads the enum out
 * of the schema and fails if this union or the bands below drift from it. */
export type ChangeOrderStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "VOID";

/** The chip on the row. Trade words, not enum words. */
export const STATUS_LABEL: Record<ChangeOrderStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Pending GC",
  APPROVED: "Executed",
  REJECTED: "Rejected",
  VOID: "Withdrawn",
};

/**
 * Chip colours.
 *
 * VOID used to be `bg-surface text-ink-muted`, which is the CARD's own
 * colour — so the one outcome the reviewer specifically named as needing to
 * survive ("argued off or withdrawn") had a chip with no ground at all. It
 * is on the neutral tag pair now, which is visible and still reads as
 * quieter than the live states. DRAFT keeps its own grey so the two
 * nothing-happened states are not the same colour.
 */
export const STATUS_STYLE: Record<ChangeOrderStatus, string> = {
  DRAFT: "border-neutral-400 bg-neutral-800 text-ink-label",
  SUBMITTED: "border-amber-600 bg-tag-amber text-tag-amber-ink",
  APPROVED: "border-emerald-700 bg-tag-green text-tag-green-ink",
  REJECTED: "border-rose-700 bg-tag-rose text-tag-rose-ink",
  VOID: "border-line-card bg-tag-slate text-tag-slate-ink",
};

/**
 * What this change order has done to the contract sum, stated per state.
 *
 * Read off the status alone — no arithmetic. The money already exists:
 * `changeOrderValueDelta` computes the row's figure and APPROVED has
 * already written its proposals onto JobLineItem. What was missing was any
 * sentence saying WHETHER the figure on screen is in the contract or only
 * being asked for, which is the entire question the reviewer asked.
 */
export const CONTRACT_EFFECT: Record<ChangeOrderStatus, string> = {
  DRAFT: "Not sent, so the contract sum has not moved. It moves only if the GC approves it.",
  SUBMITTED:
    "Not in the contract sum. This is what we have asked for — the budget moves on approval, not before.",
  APPROVED: "In the contract sum. Its proposals were written into the budget when it was approved.",
  REJECTED:
    "Never applied, so the contract sum is unchanged. Kept as the record that it was asked for and refused.",
  VOID: "Withdrawn before a decision, so it was never applied and the contract sum is unchanged.",
};

/** The short form that sits beside the money figure on the row, so a
 * dollar amount is never on screen without saying whether it is real. */
export const VALUE_QUALIFIER: Record<ChangeOrderStatus, string> = {
  DRAFT: "drafted",
  SUBMITTED: "requested",
  APPROVED: "in the contract",
  REJECTED: "not granted",
  VOID: "withdrawn",
};

export type BandKey = "DRAFT" | "PENDING" | "EXECUTED" | "CLOSED";

export type Band = {
  key: BandKey;
  /** The heading over the band. */
  heading: string;
  /** What the rest of the industry calls the same thing, when it has
   * another name. A PM who has only ever said "COR" should still find it. */
  alsoCalled: string | null;
  /** One sentence under the heading: who authored it, and where it stands
   * against the contract sum. */
  blurb: string;
  statuses: readonly ChangeOrderStatus[];
};

/**
 * In lifecycle order, which is also the enum's order.
 *
 * The two middle bands are the ones the review was about and they are
 * deliberately adjacent and worded as opposites: PENDING is ours, sent,
 * not in the money; EXECUTED is theirs, signed, in the money. CLOSED holds
 * both dead ends together because what a PM wants from that band is the
 * same for either — the record that it was raised — while the chips inside
 * it keep rejected and withdrawn apart, since "the GC said no" and "we
 * stopped asking" are different facts in a dispute.
 */
export const BANDS: readonly Band[] = [
  {
    key: "DRAFT",
    heading: "Drafts",
    alsoCalled: null,
    blurb:
      "Being written here. Nothing has gone to the GC, and nothing has moved on the contract.",
    statuses: ["DRAFT"],
  },
  {
    key: "PENDING",
    heading: "Pending change orders (PCOs)",
    alsoCalled: "change order requests",
    blurb:
      "Priced and sent by us, waiting on the GC. NOT in the contract sum — this is exposure, not revenue.",
    statuses: ["SUBMITTED"],
  },
  {
    key: "EXECUTED",
    heading: "Executed change orders",
    alsoCalled: null,
    blurb:
      "Agreed with the GC and applied. These ARE in the contract sum — the budget already includes them.",
    statuses: ["APPROVED"],
  },
  {
    key: "CLOSED",
    heading: "Closed with no change to the contract",
    alsoCalled: null,
    blurb:
      "Argued off or withdrawn. Never applied, and kept rather than deleted — a change order somebody refused is exactly the record a claim is argued from.",
    statuses: ["REJECTED", "VOID"],
  },
];

const BAND_BY_STATUS = new Map<ChangeOrderStatus, Band>(
  BANDS.flatMap((band) => band.statuses.map((status) => [status, band] as const)),
);

/** The band a status belongs to, or null when nothing claims it. Null is a
 * real answer rather than a default band: silently filing an unknown state
 * under "Executed" would tell a PM money had moved when it had not. */
export function bandForStatus(status: string): Band | null {
  return BAND_BY_STATUS.get(status as ChangeOrderStatus) ?? null;
}

export type BandedGroup<T> = { band: Band; items: T[] };

/**
 * Change orders split into the bands above, in BANDS order, input order
 * kept inside each band (the page loads them by number ascending).
 *
 * Empty bands are dropped — four headings over one draft is noise. Rows
 * whose status no band claims are returned separately rather than thrown
 * away: this function is the only thing standing between a state and the
 * screen, and a change order that renders nowhere is the failure the
 * reviewer was worried about in the first place.
 */
export function groupIntoBands<T extends { status: string }>(
  changeOrders: readonly T[],
): { groups: BandedGroup<T>[]; unbanded: T[] } {
  const buckets = new Map<BandKey, T[]>();
  const unbanded: T[] = [];

  for (const co of changeOrders) {
    const band = bandForStatus(co.status);
    if (!band) {
      unbanded.push(co);
      continue;
    }
    const bucket = buckets.get(band.key);
    if (bucket) bucket.push(co);
    else buckets.set(band.key, [co]);
  }

  const groups = BANDS.flatMap((band) => {
    const items = buckets.get(band.key);
    return items && items.length > 0 ? [{ band, items }] : [];
  });

  return { groups, unbanded };
}
