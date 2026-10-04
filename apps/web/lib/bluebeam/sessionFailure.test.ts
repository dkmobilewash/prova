import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A FAILED PUSH OR REFRESH MUST SAY SO ON THE CARD.
 *
 * `BluebeamStudioSession` carries `lastSyncedAt`, `lastSyncStatus` and
 * `lastSyncMessage`, and `bluebeam.prisma` states plainly why: "an integration
 * that fails silently is indistinguishable from one nobody used."
 *
 * Until this change nothing ever wrote `FAILURE`. Both write sites set
 * `lastSyncStatus: "SUCCESS"` unconditionally and neither had a catch, so a push
 * that threw left the PREVIOUS success standing — the card read "synced 2
 * minutes ago · ok" while the last attempt had failed. The three columns were
 * doing the opposite of the job they were added for.
 *
 * The defect could not be tested before, either, and the two facts are related:
 * `linkJobToBluebeamStudio` and `pushDocumentToBluebeamSession` called the client
 * WITHOUT forwarding `deps.fetchImpl`, while `refreshBluebeamStudioSession` did.
 * So two of the three paths had no seam to inject a failing transport into, which
 * is exactly why they had no round-trip test and why this went unnoticed.
 * Forwarding it was a one-line fix per call site and is what makes this file
 * possible.
 *
 * What is asserted here is the FAILURE half only. The success paths are already
 * covered elsewhere; the point of this file is the branch that used to not exist.
 */

const studioSession = {
  /* Typed arg, so `mock.calls` is a real tuple rather than `[]` and the
     accessors below need no casts. */
  updateMany: vi.fn(
    async (_args: { data: { lastSyncStatus: string; lastSyncMessage: string } }) => ({ count: 1 }),
  ),
  findFirst: vi.fn(),
  create: vi.fn(),
};

vi.mock("@prova/db", () => ({
  prisma: { bluebeamStudioSession: studioSession },
}));

/* `withBluebeam` resolves a connection and hands the inner call an API target.
 * Here it just runs the callback — the transport is what we are failing, not the
 * credential path, which has its own tests. */
vi.mock("@/lib/bluebeam/connection", () => ({
  withBluebeam: async (_companyId: string, run: (target: unknown) => Promise<unknown>) =>
    run({ baseUrl: "https://example.invalid", accessToken: "t" }),
}));

const { pushDocumentToBluebeamSession, refreshBluebeamStudioSession } = await import(
  "@/lib/bluebeam/session"
);

/** A minimal real PDF header, so the push gets past its own file check and
 *  reaches the transport — otherwise this would test the wrong refusal. */
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);

const LINK = {
  id: "link_1",
  bluebeamSessionId: "sess_1",
  bluebeamSessionName: "Riverside Medical — drawings",
};

const failing = () => Promise.reject(new Error("Bluebeam is unreachable right now."));

beforeEach(() => {
  studioSession.updateMany.mockClear();
  studioSession.findFirst.mockReset();
  studioSession.findFirst.mockResolvedValue(LINK);
});

/** Every `lastSyncStatus` this call wrote, in order. */
const statusesWritten = () =>
  studioSession.updateMany.mock.calls.map(([args]) => args.data.lastSyncStatus);

const lastMessage = () =>
  studioSession.updateMany.mock.calls.at(-1)?.[0].data.lastSyncMessage ?? "";

describe("a push that fails is recorded as a failure", () => {
  it("writes FAILURE, never SUCCESS, when the upload throws", async () => {
    await expect(
      pushDocumentToBluebeamSession(
        "co_1",
        "job_1",
        { name: "A-101 rev C.pdf", bytes: PDF, contentType: "application/pdf" },
        { fetchImpl: failing as unknown as typeof fetch },
      ),
    ).rejects.toThrow();

    expect(
      statusesWritten(),
      "a push that threw must leave a FAILURE on the link. Writing nothing is the " +
        "original defect — the previous SUCCESS stays on the card and the owner " +
        "reads 'synced · ok' about an attempt that failed.",
    ).toEqual(["FAILURE"]);
  });

  it("names the file and the reason, so the card says something useful", async () => {
    await expect(
      pushDocumentToBluebeamSession(
        "co_1",
        "job_1",
        { name: "A-101 rev C.pdf", bytes: PDF, contentType: "application/pdf" },
        { fetchImpl: failing as unknown as typeof fetch },
      ),
    ).rejects.toThrow();

    expect(lastMessage()).toContain("A-101 rev C.pdf");
    expect(
      lastMessage(),
      "the recorded reason should carry the thrown sentence, which is already " +
        "user-facing prose rather than a stack",
    ).toContain("Bluebeam is unreachable right now.");
  });

  it("rethrows rather than swallowing, so the action still refuses", async () => {
    await expect(
      pushDocumentToBluebeamSession(
        "co_1",
        "job_1",
        { name: "A-101.pdf", bytes: PDF, contentType: "application/pdf" },
        { fetchImpl: failing as unknown as typeof fetch },
      ),
    ).rejects.toThrow("Bluebeam is unreachable right now.");
  });
});

describe("a refresh that fails is recorded as a failure", () => {
  it("writes FAILURE, never SUCCESS, when the read throws", async () => {
    await expect(
      refreshBluebeamStudioSession("co_1", "job_1", {
        fetchImpl: failing as unknown as typeof fetch,
      }),
    ).rejects.toThrow();

    expect(statusesWritten(), "a refresh that threw must leave a FAILURE on the link").toEqual([
      "FAILURE",
    ]);
    expect(lastMessage()).toContain("Bluebeam is unreachable right now.");
  });
});

describe("the seam these tests depend on", () => {
  it("forwards the injected transport, or this whole file proves nothing", async () => {
    /* A CONTROL ON THE HARNESS. If `deps.fetchImpl` were not forwarded — which
     * is how `push` shipped — the real `fetch` would run instead, the call would
     * fail for a different reason, and these tests could pass while asserting
     * nothing about the code under test. So: prove the injected transport is the
     * one that gets called. */
    const used = vi.fn(failing);
    await expect(
      pushDocumentToBluebeamSession(
        "co_1",
        "job_1",
        { name: "A-101.pdf", bytes: PDF, contentType: "application/pdf" },
        { fetchImpl: used as unknown as typeof fetch },
      ),
    ).rejects.toThrow();

    expect(
      used,
      "the injected fetch was never called, so the client is still using the real " +
        "one and every assertion in this file is about the wrong thing",
    ).toHaveBeenCalled();
  });
});
