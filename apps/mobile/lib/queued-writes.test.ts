import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __setLanguageForRender } from "./i18n";
import { EN } from "./strings/en";
import { ES } from "./strings/es";

/**
 * A QUEUED WRITE MUST BE WATCHED, AND WHAT IT PROMISED ON SCREEN MUST BE
 * TAKEN BACK IF IT DID NOT LAND.
 *
 * `enqueue` ends in `AsyncStorage.setItem`, which is uncaught. Twelve
 * call sites awaited it bare, and nine of those cleared their form and
 * closed their sheet BEFORE the await — so a phone that could not write
 * to its own storage swallowed what somebody typed, said nothing, and
 * left a sheet closing as if it had saved.
 *
 * The four screens issue #483 named — safety, reports, materials,
 * ticket — were only the ones that happened to have an unused `error`
 * slot, which is what made them visible. `handover` and `time` had no
 * error slot at all and the same bug; `handover`'s is somebody's pay,
 * entered on a phone that is not theirs.
 *
 * THREE CHECKS, and the third is the one a size assertion cannot give:
 *
 *   1. `saveQueued` returns rather than throws, and returns the failure
 *      rather than the thrown text.
 *   2. NOTHING calls `enqueue` bare outside the queue's own module and
 *      its tests — with the SIZE of the scan asserted, so a walk that
 *      stops finding files fails loudly instead of passing on an empty
 *      set (CLAUDE.md, the scratch-cleanup-order scar).
 *   3. Every screen that can SET an error must also RENDER one. That is
 *      the actual defect in #483 stated as a rule, and it is the one I
 *      reintroduced while fixing it: `time/[jobId].tsx` got a
 *      `saveError` state and, for one commit, no line that drew it.
 */

/** Mocked BEFORE `save-queued` is imported, the same way
 * sync-queue.test.ts does it: the real module reaches react-native,
 * whose Flow syntax this node environment cannot parse. */
const store = new Map<string, string>();
let failNextWrite: Error | null = null;

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      if (failNextWrite) {
        const thrown = failNextWrite;
        failNextWrite = null;
        throw thrown;
      }
      store.set(k, v);
    },
    removeItem: async (k: string) => void store.delete(k),
  },
}));

// `sync-queue` also reaches expo/react-native through these two; both are
// mocked for the same reason sync-queue.test.ts mocks them — this suite
// runs in node, where react-native's Flow syntax does not parse.
vi.mock("./photo-store", () => ({
  discardQueuedPhoto: () => {},
  queuedPhotoExists: async () => true,
  uploadQueuedPhoto: async () => ({ ok: true }),
}));
vi.mock("./api", () => ({}));

const { saveQueued, saveFailedMessage } = await import("./save-queued");

const root = join(__dirname, "..");

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

const sources = [...listFiles(join(root, "app")), ...listFiles(join(root, "components")), ...listFiles(join(root, "lib"))]
  .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
  .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));

/** The queue's own module defines and re-exports it; the helper is the
 * one thing allowed to call it. Anything else is the bug this file is
 * about. */
const MAY_CALL_ENQUEUE = ["lib/sync-queue.ts", "lib/save-queued.ts"];

beforeEach(() => {
  store.clear();
  failNextWrite = null;
});

describe("saveQueued answers instead of throwing", () => {
  it("says ok when the write lands", async () => {
    await expect(
      saveQueued({ type: "punch-list:status", jobId: "j", itemId: "i", status: "OPEN" }),
    ).resolves.toEqual({ ok: true });
  });

  it("turns a storage failure into a readable refusal, not an exception", async () => {
    // The real failure mode: AsyncStorage rejects, deep inside enqueue.
    failNextWrite = new Error("SQLITE_FULL: database or disk is full");

    const result = await saveQueued({
      type: "punch-list:status",
      jobId: "j",
      itemId: "i",
      status: "OPEN",
    });

    expect(result.ok).toBe(false);
    expect(result).toEqual({ ok: false, error: saveFailedMessage() });
    // The native message is not shown: it means nothing to somebody
    // holding a phone, and the useful instruction does not depend on it.
    expect(saveFailedMessage()).not.toContain("SQLITE");
    // And it is the DICTIONARY's sentence, not an English literal in the
    // helper: every screen that draws it is in the translated set, so one
    // English sentence here lands on an otherwise Spanish screen.
    //
    // THE SPANISH HALF IS THE CHECK THAT BITES. strings-census.test.ts
    // cannot see this string at all — its literal detector reads text
    // elements and text props, and this is a bare const in lib/, so a
    // hard-coded English sentence here passes the whole census. Asserting
    // the ENGLISH value would not help either; a literal identical to the
    // dictionary entry satisfies it. Asking for Spanish does not.
    expect(saveFailedMessage()).toBe(EN["save.failed"]);
    __setLanguageForRender("es");
    try {
      expect(saveFailedMessage(), "the failure message is not going through the dictionary").toBe(
        ES["save.failed"],
      );
      expect(saveFailedMessage()).not.toBe(EN["save.failed"]);
    } finally {
      __setLanguageForRender("en");
    }
  });
});

describe("no screen queues a write without watching it", () => {
  it("scans a real set of files", () => {
    expect(sources.length, "the file walk found almost nothing").toBeGreaterThan(40);
    expect(
      sources.some((f) => f.endsWith(join("app", "handover.tsx"))),
      "the walk is missing screens it is supposed to cover",
    ).toBe(true);
  });

  it("leaves no bare `enqueue` call outside the queue and its helper", () => {
    const offenders: string[] = [];
    for (const file of sources) {
      const rel = file.slice(root.length + 1);
      if (MAY_CALL_ENQUEUE.includes(rel)) continue;
      const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      if (/\benqueue\s*\(/.test(text)) offenders.push(rel);
    }
    expect(
      offenders,
      `these queue a write with nothing watching whether it landed — use saveQueued: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});

describe("a screen that can set an error must draw one", () => {
  /**
   * The rule #483 is, stated so it cannot rot: an error slot nothing
   * renders is worse than no slot, because it reads as handled.
   *
   * Matching is on the STATE NAME rather than a fixed `error`, because
   * the two screens that needed a new slot called theirs `saveError` —
   * a check keyed to one spelling would have passed over both.
   */
  const screens = sources.filter((f) => f.endsWith(".tsx") && f.includes(join(root, "app")));

  it("finds screens that hold an error state at all", () => {
    const holders = screens.filter((f) => /const \[\w*[Ee]rror, set\w*[Ee]rror\]/.test(readFileSync(f, "utf8")));
    // Vacuity guard: if this stops matching, every case below is empty.
    expect(holders.length, "no screen appears to hold an error state — the pattern has stopped matching").toBeGreaterThan(5);
  });

  it("renders every error state it declares", () => {
    const offenders: string[] = [];
    for (const file of screens) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/const \[(\w*[Ee]rror), set\w*[Ee]rror\]/g)) {
        const name = m[1];
        // Rendered means the value reaches JSX: `{name ? <Text…{name}` or
        // passed to a component as a prop.
        const drawn = new RegExp(`\\{\\s*${name}\\s*\\?|=\\{${name}\\}|\\{${name}\\}`).test(text);
        if (!drawn) offenders.push(`${file.slice(root.length + 1)}: ${name}`);
      }
    }
    expect(
      offenders,
      `these hold an error nobody can see, which reads as handled and is not: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
