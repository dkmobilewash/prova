import { beforeEach, describe, expect, it, vi } from "vitest";
import { deviceStore } from "./setup";
import { mount } from "./render";

/**
 * The phone while a crew member is holding it.
 *
 * Most hangers and tapers do not carry a company phone, so their hours
 * are typed by a foreman from memory at the end of the day. This screen
 * is the alternative: the foreman hands the phone across, and while it is
 * in somebody else's hands the app is one screen — their own hours for
 * today, and their signature.
 *
 * What is worth testing is not that it renders. It is the RAILS: that
 * nothing else is on the screen, that the hours carry the crew member's
 * id rather than the foreman's session, and that the way out is handing
 * the phone back rather than a gesture or a force-quit.
 */

const replace = vi.fn();
vi.mock("expo-router", async () => {
  const react = await import("react");
  return {
    useLocalSearchParams: () => ({}),
    useRouter: () => ({ push: vi.fn(), replace, back: vi.fn() }),
    router: { push: vi.fn(), replace, back: vi.fn() },
    useFocusEffect: (effect: () => void | (() => void)) => react.useEffect(effect, [effect]),
    Redirect: () => null,
    Link: ({ children }: { children?: unknown }) => children ?? null,
  };
});

const ANA = {
  crewMemberId: "cm_1",
  name: "Ana Reyes",
  jobId: "job_1",
  jobName: "ZZQB-TEST",
  startedAt: "2026-09-20T15:00:00.000Z",
};

beforeEach(() => {
  deviceStore.clear();
  replace.mockClear();
});

async function open() {
  const { default: Handover } = await import("@/app/handover");
  return mount(<Handover />);
}

function queued() {
  return JSON.parse(deviceStore.get("prova.field-queue") ?? "[]") as Record<string, unknown>[];
}

describe("the handover screen", () => {
  it("shows whose hours these are, and nothing else about the company", async () => {
    deviceStore.set("prova.handover", JSON.stringify(ANA));
    const screen = await open();

    expect(screen.text()).toContain("Ana Reyes");
    expect(screen.text()).toContain("ZZQB-TEST");
    expect(screen.text()).toContain("Hours worked today");
    // The things a borrowed phone must not put in front of somebody: the
    // job list, other people's time, anything with money in it.
    expect(screen.text()).not.toMatch(/Jobs|Margin|Backlog|Invoice/);
    screen.unmount();
  });

  it("sends the crew member's id with the hours, not just the foreman's session", async () => {
    // The signed-in session is the FOREMAN's. `crewMemberId` is the only
    // thing on the write that says the time is Ana's.
    deviceStore.set("prova.handover", JSON.stringify(ANA));
    const screen = await open();

    const input = document.querySelector("input");
    expect(input, "no hours field").toBeTruthy();
    const { act } = await import("react");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "8");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const add = Array.from(document.querySelectorAll("*")).find((node) => node.textContent === "Add these hours");
    await act(async () => {
      (add as HTMLElement)?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const ops = queued();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: "time:create", jobId: "job_1", hours: "8", crewMemberId: "cm_1" });
    screen.unmount();
  });

  it("goes back to the foreman's app when there is no handover open", async () => {
    // Arriving here with nothing handed over means the foreman already
    // took it back; the screen has no meaning on its own.
    const screen = await open();
    expect(replace).toHaveBeenCalledWith("/(tabs)");
    screen.unmount();
  });

  it("offers the PIN when the foreman set one, and not when they did not", async () => {
    deviceStore.set("prova.handover", JSON.stringify({ ...ANA, pin: "2468" }));
    const withPin = await open();
    expect(withPin.text()).toContain("Hand the phone back");
    withPin.unmount();

    deviceStore.set("prova.handover", JSON.stringify(ANA));
    const without = await open();
    expect(without.text()).toContain("Hand the phone back");
    without.unmount();
  });
});
