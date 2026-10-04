import { describe, expect, it } from "vitest";

import {
  bookingProblem,
  DEFAULT_HOURS,
  INTAKE_SCRIPT,
  LEAD_TIME_MINUTES,
  MIN_CREW,
  overlapsAny,
  SERVED_TRADES,
  serveability,
  slotsFor,
  type IntakeAnswers,
  type Slot,
} from "./demo-booking";

/** A Wednesday, 06:00 UTC. Fixed clock: nothing here reads the real one. */
const NOW = new Date("2026-10-07T06:00:00.000Z");
const at = (iso: string): Slot => ({ at: new Date(iso), minutes: 30 });

const complete: IntakeAnswers = {
  companyName: "Valley Wall & Ceiling",
  contactName: "Ray",
  trade: "METAL_FRAMING_DRYWALL",
  crewSize: 28,
  callback: "+1 916 555 0101",
};

describe("the intake script", () => {
  it("asks for everything the verdict depends on", () => {
    /* A required answer the script never asks for would make ASK_MORE
       unreachable and leave the caller on a loop. */
    const keys = INTAKE_SCRIPT.map((q) => q.key);
    for (const needed of [
      "companyName",
      "contactName",
      "trade",
      "crewSize",
      "callback",
    ]) {
      expect(keys, `${needed} is required but never asked`).toContain(needed);
    }
  });

  it("is a fixed list, so two callers who say the same thing score the same", () => {
    expect(INTAKE_SCRIPT.length).toBeGreaterThanOrEqual(6);
    expect(
      new Set(keysOf()).size,
      "a duplicated key would overwrite an answer",
    ).toBe(INTAKE_SCRIPT.length);
  });

  const keysOf = () => INTAKE_SCRIPT.map((q) => q.key);
});

describe("what the agent should ask next", () => {
  it("asks the first missing required question, in script order", () => {
    const v = serveability({ companyName: "Valley Wall & Ceiling" });
    expect(v.verdict).toBe("ASK_MORE");
    expect(v.missing[0]).toBe("contactName");
    expect(
      v.reason,
      "the reason on ASK_MORE should BE the next question, so the agent has nothing to invent",
    ).toBe(INTAKE_SCRIPT.find((q) => q.key === "contactName")!.ask);
  });

  it("treats blank and whitespace answers as missing", () => {
    expect(serveability({ ...complete, contactName: "   " }).missing).toContain(
      "contactName",
    );
    expect(serveability({ ...complete, contactName: "" }).verdict).toBe(
      "ASK_MORE",
    );
  });

  it("does not require the optional ones", () => {
    const v = serveability(complete);
    expect(v.verdict).toBe("BOOK_IT");
    expect(v.missing).toEqual([]);
  });
});

describe("a trade we cannot serve", () => {
  it("is refused BEFORE the rest of the questions are collected", () => {
    /* The ordering is the whole point: collecting a callback number from a
       plumbing contractor so we can tell him no wastes his afternoon. */
    const v = serveability({ trade: null, tradeHeard: "commercial plumbing" });
    expect(v.verdict).toBe("NOT_SERVED");
    expect(v.reason).toContain("commercial plumbing");
    expect(
      v.missing.length,
      "it should still report what was missing, for the record",
    ).toBeGreaterThan(0);
  });

  it("is NOT refused merely because the trade has not been asked yet", () => {
    /* `trade: undefined` is "we have not got there". `trade: null` WITH
       `tradeHeard` is "they told us and it is not ours". Collapsing those two
       would refuse every caller at the first question. */
    const v = serveability({
      companyName: "Valley Wall & Ceiling",
      contactName: "Ray",
    });
    expect(v.verdict).toBe("ASK_MORE");
  });

  it("is not refused when trade is null and nothing was heard", () => {
    const v = serveability({ ...complete, trade: null, tradeHeard: null });
    expect(v.verdict).not.toBe("NOT_SERVED");
  });

  it("serves all five of the trades the product is built for", () => {
    for (const trade of SERVED_TRADES) {
      expect(
        serveability({ ...complete, trade }).verdict,
        `${trade} was refused`,
      ).toBe("BOOK_IT");
    }
  });
});

describe("a crew too small for this to pay for itself", () => {
  it("is told so plainly rather than booked and lost", () => {
    const v = serveability({ ...complete, crewSize: MIN_CREW - 1 });
    expect(v.verdict).toBe("NOT_SERVED");
    expect(v.reason).toContain(String(MIN_CREW - 1));
    expect(
      v.reason,
      "it should leave the door open rather than just decline",
    ).toMatch(/again/i);
  });

  it("books at exactly the floor", () => {
    expect(serveability({ ...complete, crewSize: MIN_CREW }).verdict).toBe(
      "BOOK_IT",
    );
  });

  it("does not refuse when the crew size has not been given", () => {
    const withoutCrew: IntakeAnswers = { ...complete };
    delete withoutCrew.crewSize;
    expect(serveability(withoutCrew).verdict).toBe("ASK_MORE");
  });
});

describe("the slots offered", () => {
  it("never offers one sooner than the lead time", () => {
    const slots = slotsFor({ now: NOW });
    expect(slots.length).toBeGreaterThan(0);
    const earliest = NOW.getTime() + LEAD_TIME_MINUTES * 60_000;
    for (const s of slots) {
      expect(
        s.at.getTime(),
        `${s.at.toISOString()} is inside the lead time`,
      ).toBeGreaterThanOrEqual(earliest);
    }
  });

  it("starts early, because these people are on site by seven", () => {
    /* Not decoration. A window that only offers mid-morning gets declined, and
       it tells a contractor the product was built by somebody who has never
       had to be on a job site. */
    expect(DEFAULT_HOURS.startHour).toBeLessThanOrEqual(7);
    const hours = new Set(
      slotsFor({ now: NOW, days: 5 }).map((s) => s.at.getUTCHours()),
    );
    expect(
      [...hours].some((h) => h < 8),
      "no slot before 8am is offered at all",
    ).toBe(true);
  });

  it("offers nothing at the weekend", () => {
    for (const s of slotsFor({ now: NOW, days: 14 })) {
      expect([0, 6], `${s.at.toISOString()} is a weekend`).not.toContain(
        s.at.getUTCDay(),
      );
    }
  });

  it("stays inside the booking hours", () => {
    for (const s of slotsFor({ now: NOW, days: 5 })) {
      const h = s.at.getUTCHours();
      expect(h).toBeGreaterThanOrEqual(DEFAULT_HOURS.startHour);
      expect(h).toBeLessThan(DEFAULT_HOURS.endHour);
    }
  });

  it("drops a slot that OVERLAPS a booking, not just one that matches it", () => {
    /* THE CASE AN EQUALITY CHECK WAVES THROUGH. A 30-minute demo starting 15
       minutes into another one is a double-booking. */
    const busy = [{ at: new Date("2026-10-07T09:15:00.000Z"), minutes: 30 }];
    const slots = slotsFor({ now: NOW, busy });
    const starts = slots.map((s) => s.at.toISOString());
    expect(starts).not.toContain("2026-10-07T09:00:00.000Z");
    expect(starts).not.toContain("2026-10-07T09:30:00.000Z");
    expect(
      starts,
      "08:30 ends before the booking starts and should survive",
    ).toContain("2026-10-07T08:30:00.000Z");
  });

  it("is sorted soonest first, so an agent can read the first three", () => {
    const slots = slotsFor({ now: NOW, days: 3 });
    const times = slots.map((s) => s.at.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe("overlap, on its own", () => {
  it("is false for back-to-back slots", () => {
    expect(
      overlapsAny(at("2026-10-07T10:00:00.000Z"), [
        at("2026-10-07T10:30:00.000Z"),
      ]),
    ).toBe(false);
    expect(
      overlapsAny(at("2026-10-07T10:30:00.000Z"), [
        at("2026-10-07T10:00:00.000Z"),
      ]),
    ).toBe(false);
  });

  it("is true from either side of a partial overlap", () => {
    expect(
      overlapsAny(at("2026-10-07T10:00:00.000Z"), [
        at("2026-10-07T10:15:00.000Z"),
      ]),
    ).toBe(true);
    expect(
      overlapsAny(at("2026-10-07T10:15:00.000Z"), [
        at("2026-10-07T10:00:00.000Z"),
      ]),
    ).toBe(true);
  });

  it("is false against an empty calendar", () => {
    expect(overlapsAny(at("2026-10-07T10:00:00.000Z"), [])).toBe(false);
  });
});

describe("writing the slot the caller picked", () => {
  it("allows a clean one", () => {
    expect(
      bookingProblem({ requested: at("2026-10-07T10:00:00.000Z"), now: NOW }),
    ).toBeNull();
  });

  it("refuses one inside the lead time", () => {
    const p = bookingProblem({
      requested: at("2026-10-07T06:30:00.000Z"),
      now: NOW,
    });
    expect(p?.refusal).toBe("TOO_SOON");
  });

  it("refuses one outside the hours, and at the weekend", () => {
    expect(
      bookingProblem({ requested: at("2026-10-07T19:00:00.000Z"), now: NOW })
        ?.refusal,
    ).toBe("OUTSIDE_HOURS");
    expect(
      bookingProblem({ requested: at("2026-10-10T10:00:00.000Z"), now: NOW })
        ?.refusal,
    ).toBe("OUTSIDE_HOURS");
  });

  it("refuses one taken between the offer and the answer", () => {
    /* THE RACE THIS FUNCTION EXISTS FOR, and the reason it does not simply
       re-check the list it offered from: the agent reads out three times, the
       caller picks one, and somebody else takes it while he is deciding.
       Judging against the offer would re-approve a stale offer. */
    const offered = at("2026-10-07T10:00:00.000Z");
    expect(bookingProblem({ requested: offered, now: NOW })).toBeNull();

    const p = bookingProblem({
      requested: offered,
      now: NOW,
      busy: [at("2026-10-07T10:00:00.000Z")],
    });
    expect(p?.refusal).toBe("TAKEN");
    expect(
      p?.reason,
      "the caller is on the phone — tell them to pick another",
    ).toMatch(/another/i);
  });

  it("refuses one that only PARTLY overlaps a booking", () => {
    const p = bookingProblem({
      requested: at("2026-10-07T10:00:00.000Z"),
      now: NOW,
      busy: [at("2026-10-07T10:15:00.000Z")],
    });
    expect(p?.refusal).toBe("TAKEN");
  });

  it("agrees with slotsFor — every offered slot is writable", () => {
    /* A CROSS-CHECK BETWEEN THE TWO FUNCTIONS, because they judge the same
       thing by different routes and a disagreement means the agent offers
       times the write then refuses. */
    const busy = [
      at("2026-10-07T09:15:00.000Z"),
      at("2026-10-08T11:00:00.000Z"),
    ];
    const offered = slotsFor({ now: NOW, days: 3, busy });
    expect(offered.length).toBeGreaterThan(10);
    const rejected = offered.filter(
      (s) => bookingProblem({ requested: s, now: NOW, busy }) !== null,
    );
    expect(
      rejected.map((s) => s.at.toISOString()),
      "slotsFor offered a time bookingProblem refuses — the two disagree",
    ).toEqual([]);
  });
});
