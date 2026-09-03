import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/fake-prisma";

/**
 * The evidence hole in `sendOutboundEmail` (#111, severity DATA-LOST).
 *
 * The provider was called first and the record of the handover written
 * afterwards, in a separate transaction. Everything between those two
 * points is a window where the email HAS GONE to a real person and the
 * database says otherwise — no `providerMessageId`, no events at all. The
 * log then reads "No word back yet", and `reachedProvider` — the guard on
 * deletion, whose own comment says removing such a row would "destroy the
 * evidence that they received it" — sees nothing and lets it be deleted.
 *
 * These are ordering tests, so they assert on the order of writes and on
 * what survives a write that throws. A return value cannot show either.
 *
 * `notification-dispatch.ts` states the principle these tests encode:
 * "THE ORDER IS THE DESIGN ... claimed BEFORE the provider is called ... A
 * crash between sending and recording is then a notice that was sent and
 * recorded". Overstating a send is recoverable — a person checks. Losing
 * one is not.
 */

/** `providerMessageId` is nullable in the schema, and `reachedProvider`
 * tests it against `null` specifically. A fake that left it `undefined`
 * would answer that guard wrongly. */
const newDb = () =>
  new FakeDb().defaults("outboundMessage", { providerMessageId: null });

let db = newDb();
const context = { company: { id: "co_1" }, id: "user_1", role: "OWNER" as string };

const sendEmail = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => context,
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("@prova/db", () => ({
  get prisma() {
    return db.client();
  },
}));

vi.mock("@prova/integrations", () => ({
  looksLikeEmail: (value: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value),
  readEmailConfig: () => ({
    provider: "resend",
    apiKey: "test",
    from: "office@example.test",
    webhookSecret: null,
  }),
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));

const { deleteOutboundMessage, sendOutboundEmail } = await import("./messages");

function composed() {
  const fd = new FormData();
  fd.set("toAddress", "pm@gc.example");
  fd.set("subject", "Backcharge dispute");
  fd.set("body", "The deduction on pay app 4 is not ours.");
  return fd;
}

function messageRow() {
  const rows = db.rows("outboundMessage");
  expect(rows).toHaveLength(1);
  return rows[0];
}

function eventTypes() {
  return db.rows("outboundMessageEvent").map((event) => event.type);
}

/** The delete guard's answer, obtained by asking it rather than by
 * re-deriving it here. Two opinions about whether a message is evidence is
 * how the guard and the log come to disagree. */
async function deletionRefused() {
  const result = await deleteOutboundMessage(String(messageRow().id));
  return result.ok === false;
}

beforeEach(() => {
  vi.clearAllMocks();
  db = newDb();
});

describe("sendOutboundEmail records the handover before the provider is called", () => {
  it("writes the message and its handover event before sendEmail runs", async () => {
    let writesAtSend: string[] = [];
    sendEmail.mockImplementation(async () => {
      writesAtSend = [...db.writes];
      return { ok: true, providerMessageId: "prov_1", from: "office@example.test" };
    });

    const result = await sendOutboundEmail(composed());
    expect(result).toEqual({ ok: true });

    // The row AND the event, both already written by the time the provider
    // is reached. Not "the row" — a row with no events is exactly what the
    // delete guard reads as never-sent.
    expect(writesAtSend).toContain("outboundMessage.create");
    expect(writesAtSend).toContain("outboundMessageEvent.create");
  });

  it("keeps the evidence when the write that follows the send fails", async () => {
    sendEmail.mockImplementation(async () => {
      // Everything after this point is a database the process may lose.
      db.failNext = "outboundMessage.update";
      return { ok: true, providerMessageId: "prov_1", from: "office@example.test" };
    });

    const result = await sendOutboundEmail(composed());

    // The mail has gone. Whatever we tell the user, we must not tell them
    // it failed — that is how a GC gets two copies.
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toMatch(/sent/i);
    }

    // The row survives with an event that is not FAILED, which is what
    // `reachedProvider` reads.
    expect(eventTypes()).toEqual(["QUEUED"]);
    expect(await deletionRefused()).toBe(true);
    expect(db.rows("outboundMessage")).toHaveLength(1);
  });

  it("still lets a send that never reached the provider be deleted", async () => {
    sendEmail.mockResolvedValue({
      ok: false,
      error: "Network unreachable",
      configured: true,
    });

    const result = await sendOutboundEmail(composed());
    expect(result).toEqual({ ok: false, error: "Network unreachable" });

    // The handover was written speculatively and must be taken back: there
    // is no copy anywhere, so this row is not evidence of anything and the
    // owner may remove it. A leftover QUEUED here would make every failed
    // send permanent — the fix for the hole above, over-applied.
    expect(eventTypes()).toEqual(["FAILED"]);
    expect(await deletionRefused()).toBe(false);
    expect(db.rows("outboundMessage")).toHaveLength(0);
  });

  it("keeps a send the provider accepted without returning an id", async () => {
    sendEmail.mockResolvedValue({
      ok: false,
      error: "Provider returned no id",
      configured: true,
      mayHaveSent: true,
    });

    const result = await sendOutboundEmail(composed());
    expect(result.ok).toBe(false);

    // It reached the provider, so it is QUEUED and it stays.
    expect(eventTypes()).toEqual(["QUEUED"]);
    expect(await deletionRefused()).toBe(true);
    expect(String(db.rows("outboundMessageEvent")[0].detail)).toMatch(
      /Provider returned no id/,
    );
  });
});
