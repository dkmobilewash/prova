import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Alert } from "@/lib/alerts";

/**
 * The push twin of `notification-dispatch.test.ts` — the same claim-
 * before-send ordering, over a separate claim namespace, with no message
 * rows. What is worth testing is exactly what the email tests tested:
 * the ORDER of writes against the provider, and the channel independence
 * the `push:` prefix buys. Unit tests, run by `pnpm test`, with a
 * Prisma-like fake that models the one constraint the mechanism rests on:
 * `(userId, dispatchKey)` uniqueness, which `skipDuplicates` leans on.
 */

function alert(over: Partial<Alert> = {}): Alert {
  return {
    key: "RENEWAL:lic_1:2026-11-30",
    kind: "RENEWAL",
    severity: "DUE_SOON",
    title: "Licence renews soon",
    detail: "California licence CA-123 expires on 2026-11-30.",
    href: "/alerts",
    dueOn: "2026-11-30",
    daysUntil: 3,
    amount: null,
    ...over,
  };
}

const RECIPIENT = {
  id: "u_1",
  companyId: "co_1",
  role: "OWNER",
  jobFunction: null,
};

// The providers, mocked at the boundary.
type PushResult = "sent" | "no-devices" | "unconfigured" | "failed";
const pushToUser = vi.fn(async (): Promise<PushResult> => "sent");
const loadAlerts = vi.fn(async () => ({ visible: [alert()] }));
const readExpoPushConfig = vi.fn(
  (): { accessToken: string } | null => ({ accessToken: "test-token" }),
);

type Row = Record<string, unknown> & { id: string };

function op<T>(run: () => T): PromiseLike<T> {
  return {
    then: (onFulfilled, onRejected) =>
      Promise.resolve().then(run).then(onFulfilled, onRejected),
  };
}

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && "in" in value) {
      return (value as { in: unknown[] }).in.includes(row[key]);
    }
    return row[key] === value;
  });
}

/** Just enough of the client for `dispatchAlertPush`: the device-token
 * read, the ledger find/claim/release, and a writes log for the ordering
 * assertions. `createManyAndReturn` models the real unique constraint —
 * a second insert of the same (userId, dispatchKey) is dropped, which is
 * the lock the whole claim mechanism rests on. */
class FakeDb {
  private tables = new Map<string, Map<string, Row>>();
  private seq = 0;
  readonly writes: string[] = [];
  /** Invoked inside createManyAndReturn, BEFORE inserting — lets a test
   * plant the other run's claims in the gap between this run's read and
   * its write, which is the race `already-claimed` exists for. */
  beforeClaim: (() => void) | null = null;

  rows(name: string): Row[] {
    return [...(this.tables.get(name)?.values() ?? [])];
  }

  seed(name: string, row: Row): void {
    let rows = this.tables.get(name);
    if (!rows) {
      rows = new Map();
      this.tables.set(name, rows);
    }
    rows.set(row.id, row);
  }

  clear(name: string): void {
    this.tables.delete(name);
  }

  client() {
    const self = this;
    return {
      deviceToken: {
        findMany: ({ where }: { where: { userId: string } }) =>
          op(() => self.rows("deviceToken").filter((row) => matches(row, where))),
      },
      notificationDispatch: {
        findMany: ({ where }: { where?: Record<string, unknown> } = {}) =>
          op(() =>
            where
              ? self
                  .rows("notificationDispatch")
                  .filter((row) => matches(row, where))
              : self.rows("notificationDispatch"),
          ),
        createManyAndReturn: ({ data }: { data: Record<string, unknown>[] }) =>
          op(() => {
            self.writes.push("ledger.createManyAndReturn");
            if (self.beforeClaim) self.beforeClaim();
            const created: Row[] = [];
            for (const item of data) {
              const clash = self.rows("notificationDispatch").some(
                (row) =>
                  row.userId === item.userId &&
                  row.dispatchKey === item.dispatchKey,
              );
              if (clash) continue;
              const row = { id: `nd_${++self.seq}`, ...item } as Row;
              self.seed("notificationDispatch", row);
              created.push(row);
            }
            return created;
          }),
        deleteMany: ({ where }: { where: Record<string, unknown> }) =>
          op(() => {
            self.writes.push("ledger.deleteMany");
            let count = 0;
            for (const row of self.rows("notificationDispatch")) {
              if (!matches(row, where)) continue;
              self.tables.get("notificationDispatch")!.delete(row.id);
              count += 1;
            }
            return { count };
          }),
      },
    };
  }
}

let db = new FakeDb();

vi.mock("@prova/db", () => ({
  get prisma() {
    return db.client();
  },
}));

vi.mock("@/lib/push", () => ({
  pushToUser: (...args: Parameters<typeof pushToUser>) => pushToUser(...args),
}));
vi.mock("@/lib/alerts-query", () => ({
  loadAlerts: (...args: Parameters<typeof loadAlerts>) => loadAlerts(...args),
}));
vi.mock("@prova/integrations", () => ({
  readExpoPushConfig: () => readExpoPushConfig(),
}));

import { dispatchAlertPush, pushBody, pushKey } from "@/lib/notification-push";

function seedDevice(userId = "u_1"): void {
  db.seed("deviceToken", { id: "dt_1", userId, expoToken: "ExponentPushToken[test]" });
}

/** A ledger row as a previous run would have written it. `week` always
 * burns `approaching` with it, so a claim fixture that says week must
 * claim both — the state a real run leaves. */
function seedClaims(alertKey: string, prefix = "push:"): void {
  db.seed("notificationDispatch", {
    id: `nd_${prefix}week_${alertKey}`,
    companyId: "co_1",
    userId: "u_1",
    dispatchKey: `${prefix}${alertKey}@week`,
    alertKey,
    rung: "week",
  });
  db.seed("notificationDispatch", {
    id: `nd_${prefix}approaching_${alertKey}`,
    companyId: "co_1",
    userId: "u_1",
    dispatchKey: `${prefix}${alertKey}@approaching`,
    alertKey,
    rung: "approaching",
  });
}

beforeEach(() => {
  db = new FakeDb();
  pushToUser.mockClear();
  pushToUser.mockResolvedValue("sent");
  loadAlerts.mockClear();
  loadAlerts.mockResolvedValue({ visible: [alert()] });
  readExpoPushConfig.mockClear();
  readExpoPushConfig.mockReturnValue({ accessToken: "test-token" });
});

describe("dispatchAlertPush — the channel namespace", () => {
  it("claims push-prefixed keys, so an email claim never suppresses the push", async () => {
    // Wrong behaviour: sharing the unprefixed keys. An email sent this
    // morning would then read as "already told" and the phone would never
    // hear a thing — the channels collapsed into one ledger by accident.
    seedDevice();
    seedClaims("RENEWAL:lic_1:2026-11-30", ""); // the email half's claims

    const outcome = await dispatchAlertPush(RECIPIENT, "2026-09-21");

    expect(outcome).toMatchObject({ ok: true, sent: true, noticeCount: 1 });
    expect(pushToUser).toHaveBeenCalledWith(
      "u_1",
      expect.any(String),
      expect.any(String),
      { target: "alerts" },
    );
    const claimed = db.rows("notificationDispatch").map((row) => row.dispatchKey);
    expect(claimed).toContain("push:RENEWAL:lic_1:2026-11-30@week");
    expect(claimed).toContain("RENEWAL:lic_1:2026-11-30@week");
  });

  it("never re-sends a push whose push claim already exists", async () => {
    seedDevice();
    seedClaims("RENEWAL:lic_1:2026-11-30");

    const outcome = await dispatchAlertPush(RECIPIENT, "2026-09-21");

    expect(outcome).toMatchObject({ ok: true, sent: false, reason: "nothing-due" });
    expect(pushToUser).not.toHaveBeenCalled();
  });

  it("prefixes, never rewrites, the milestone key", () => {
    expect(pushKey("RENEWAL:lic_1:2026-11-30@week")).toBe(
      "push:RENEWAL:lic_1:2026-11-30@week",
    );
  });
});

describe("dispatchAlertPush — the order is the design", () => {
  it("has written the push claims before the provider is reached", async () => {
    seedDevice();
    pushToUser.mockImplementation(async () => {
      db.writes.push("send");
      return "sent";
    });

    await dispatchAlertPush(RECIPIENT, "2026-09-21");

    const claim = db.writes.indexOf("ledger.createManyAndReturn");
    const send = db.writes.indexOf("send");
    expect(claim).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(claim);
  });

  it("stops at no devices, before any alert assembly", async () => {
    // Wrong behaviour: assembling the alerts first. A company two years in
    // pays an alert assembly per phone-less user every single day.
    const outcome = await dispatchAlertPush(RECIPIENT, "2026-09-21");

    expect(outcome).toMatchObject({ ok: true, sent: false, reason: "no-devices" });
    expect(loadAlerts).not.toHaveBeenCalled();
  });

  it("stops at an unconfigured token before claiming anything", async () => {
    // Wrong behaviour: claiming first. The email dispatcher shipped
    // exactly this bug once — every milestone burned permanently for
    // companies whose sending was never set up.
    readExpoPushConfig.mockReturnValue(null);
    seedDevice();

    const outcome = await dispatchAlertPush(RECIPIENT, "2026-09-21");

    expect(outcome).toMatchObject({ ok: false, claimed: 0, unconfigured: true });
    expect(loadAlerts).not.toHaveBeenCalled();
    expect(db.rows("notificationDispatch")).toHaveLength(0);
  });
});

describe("dispatchAlertPush — what survives a failure", () => {
  it("releases the claims when the provider never got the push", async () => {
    seedDevice();
    pushToUser.mockResolvedValue("failed");

    const outcome = await dispatchAlertPush(RECIPIENT, "2026-09-21");

    expect(outcome).toMatchObject({ ok: false, claimed: 0 });
    expect(db.rows("notificationDispatch")).toHaveLength(0);
    expect(db.writes).toContain("ledger.deleteMany");
  });

  it("keeps the claims when the push went out", async () => {
    seedDevice();

    await dispatchAlertPush(RECIPIENT, "2026-09-21");

    expect(db.rows("notificationDispatch").length).toBeGreaterThan(0);
    expect(db.writes).not.toContain("ledger.deleteMany");
  });

  it("sends only the notice it fully won, and touches nobody else's claims", async () => {
    // Two alerts; a previous run already claimed every rung of the first.
    // This run must send the second and leave the first's rows alone —
    // losing ANY key a notice burns means another run is speaking about
    // that alert right now.
    seedDevice();
    seedClaims("RENEWAL:lic_1:2026-11-30");
    loadAlerts.mockResolvedValue({
      visible: [
        alert({ key: "RENEWAL:lic_1:2026-11-30" }),
        alert({ key: "RENEWAL:lic_2:2026-12-05", title: "Second licence renews soon" }),
      ],
    });

    const outcome = await dispatchAlertPush(RECIPIENT, "2026-09-21");

    expect(outcome).toMatchObject({ ok: true, sent: true, noticeCount: 1 });
    expect(pushToUser).toHaveBeenCalledTimes(1);
    const remaining = db.rows("notificationDispatch").map((row) => row.dispatchKey);
    expect(remaining).toContain("push:RENEWAL:lic_1:2026-11-30@week");
    expect(remaining).toContain("push:RENEWAL:lic_2:2026-12-05@week");
  });

  it("reports already-claimed when it won nothing at all", async () => {
    // The race in full: this run reads a clean ledger, and another run
    // claims every key in the gap before this run's write. The insert
    // then wins nothing — and nothing won must read as already-claimed,
    // not as a send of zero notices.
    seedDevice();
    db.beforeClaim = () => seedClaims("RENEWAL:lic_1:2026-11-30");

    const outcome = await dispatchAlertPush(RECIPIENT, "2026-09-21");

    expect(outcome).toMatchObject({ ok: true, sent: false, reason: "already-claimed" });
    expect(pushToUser).not.toHaveBeenCalled();
    // The other run's rows survive; this run inserted and released nothing.
    expect(db.rows("notificationDispatch")).toHaveLength(2);
    expect(db.writes).not.toContain("ledger.deleteMany");
  });
});

describe("pushBody — the banner-sized digest", () => {
  it("names a single notice", () => {
    const body = pushBody([
      { alert: alert(), rung: "week", alsoSpent: ["approaching"] },
    ]);
    expect(body).toContain("Licence renews soon");
  });

  it("counts several, and says how many are overdue", () => {
    const body = pushBody([
      { alert: alert({ severity: "OVERDUE", daysUntil: 0 }), rung: "due", alsoSpent: ["approaching", "week"] },
      { alert: alert(), rung: "week", alsoSpent: ["approaching"] },
    ]);
    expect(body).toContain("2 things need your attention");
    expect(body).toContain("1 overdue");
  });
});
