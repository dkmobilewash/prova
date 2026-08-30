/** Shared outbound-message semantics, so the log, the row and the counters
 * can't disagree about whether something arrived.
 *
 * Nothing here is stored. A message's status is derived from its newest
 * event on every read — a stored status can disagree with the events
 * underneath it, and "we sent it and it was delivered" is a claim people
 * make while chasing money.
 */

export type MessageEventData = {
  id: string;
  type: string;
  occurredAt: string;
  detail: string | null;
};

export type MessageData = {
  id: string;
  channel: string;
  toAddress: string;
  toName: string | null;
  subject: string | null;
  fromAddress: string;
  sentAt: string;
  events: MessageEventData[];
};

/** Newest first. Ties on the provider's timestamp break on event id so the
 * order is total and stable — two events can genuinely share a second, and
 * an unstable sort would make the derived status flicker between renders. */
export function newestFirst(events: MessageEventData[]): MessageEventData[] {
  return [...events].sort((a, b) => {
    if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
}

export type MessageState =
  | "UNKNOWN" // handed over, provider has told us nothing yet
  | "IN_FLIGHT" // queued or sent, not yet accepted by the far end
  | "DELIVERED" // the receiving server took it
  | "BOUNCED" // rejected
  | "COMPLAINED" // marked as spam
  | "FAILED"; // never reached the provider at all

/** OPENED is deliberately not a state.
 *
 * Image-blocking makes a missing open meaningless, so an open can only ever
 * add information, never remove it. Letting it become the newest state
 * would also let a later open overwrite a bounce, which is exactly
 * backwards — a message can be opened and still have bounced for a second
 * recipient. It is recorded, shown, and never concluded from. */
export function messageState(events: MessageEventData[]): MessageState {
  for (const event of newestFirst(events)) {
    switch (event.type) {
      case "COMPLAINED":
        return "COMPLAINED";
      case "BOUNCED":
        return "BOUNCED";
      case "FAILED":
        return "FAILED";
      case "DELIVERED":
        return "DELIVERED";
      case "SENT":
      case "QUEUED":
        return "IN_FLIGHT";
      default:
        continue; // OPENED and anything a provider adds later
    }
  }
  return "UNKNOWN";
}

export function stateLabel(state: MessageState) {
  switch (state) {
    case "UNKNOWN":
      return "No word back yet";
    case "IN_FLIGHT":
      return "Handed over, not confirmed";
    case "DELIVERED":
      return "Delivered";
    case "BOUNCED":
      return "Bounced";
    case "COMPLAINED":
      return "Marked as spam";
    case "FAILED":
      return "Never sent";
  }
}

/** Did it arrive? The only question the log exists to answer. */
export function arrived(events: MessageEventData[]) {
  return messageState(events) === "DELIVERED";
}

/** Needs a human. Bounced and failed are fixable; complaints threaten the
 * sending domain. "No word back yet" is not a problem on its own — see
 * `stale` below for when it becomes one. */
export function needsAttention(events: MessageEventData[]) {
  const state = messageState(events);
  return state === "BOUNCED" || state === "FAILED" || state === "COMPLAINED";
}

/** Whole days between two UTC-midnight ISO dates. */
export function daysBetween(fromIso: string, toIso: string) {
  const ms = Date.parse(`${toIso}T00:00:00.000Z`) - Date.parse(`${fromIso}T00:00:00.000Z`);
  return Math.round(ms / 86_400_000);
}

/** Sent a while ago and still unconfirmed.
 *
 * This is the state the competitor research is really about: a product
 * that says "sending" forever while nothing arrives. Silence past a day is
 * not proof of failure, but it is the thing worth surfacing, because the
 * alternative is finding out when someone asks why you never replied. */
export function stale(message: MessageData, today: string) {
  const state = messageState(message.events);
  if (state !== "UNKNOWN" && state !== "IN_FLIGHT") return false;
  return daysBetween(message.sentAt, today) >= 1;
}

/** Share of messages that reached the far end, as a whole percent.
 *
 * Counts only messages the provider has reported on at all. Including
 * unconfirmed ones would let a provider outage quietly halve the number
 * and read as a deliverability collapse — the figure would move for a
 * reason that has nothing to do with deliverability. Null when there is
 * nothing decided yet, so the caller can never render a confident 0%. */
export function deliveryRate(messages: MessageData[]): number | null {
  const decided = messages.filter((m) => {
    const s = messageState(m.events);
    return s === "DELIVERED" || s === "BOUNCED" || s === "COMPLAINED" || s === "FAILED";
  });
  if (decided.length === 0) return null;
  const good = decided.filter((m) => messageState(m.events) === "DELIVERED").length;
  return Math.round((good / decided.length) * 100);
}

export function channelLabel(channel: string) {
  return channel === "SMS" ? "Text" : "Email";
}

/** The recipient as a person would write it. */
export function recipient(message: MessageData) {
  return message.toName ? `${message.toName} <${message.toAddress}>` : message.toAddress;
}
