import { beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "expo-router";
import { CaptureSheet } from "@/components/CaptureSheet";
import { FloatingCaptureButton } from "@/components/FloatingCaptureButton";
import { deviceStore, goOffline } from "./setup";
import { mount } from "./render";

/**
 * The capture sheet — the Create and Camera tabs collapsed into one
 * button. The tab-bar gate itself is pinned by screen-capabilities.test.ts
 * (the census reads the layout's source); what this covers is the SHEET:
 * Photo on top, everything filed against the current job, and the
 * pick-a-job refusal when there is none. The route strings are the
 * contract — a wrong path here is a photo filed against the wrong site.
 */

beforeEach(async () => {
  deviceStore.clear();
  await goOffline();
  vi.mocked(router.push).mockClear();
  vi.mocked(router.navigate).mockClear();
});

const JOB = { id: "job_1", name: "Riverside Drywall", status: "IN_PROGRESS" };

/** The Sheet renders inside a Modal, and react-native-web portals a Modal
 * to document.body — so the mount helper's container text stays empty and
 * the assertions read the body instead. */
function text(): string {
  return document.body.textContent ?? "";
}

function click(textToFind: string): void {
  const node = Array.from(document.querySelectorAll("*")).find((n) => n.textContent === textToFind);
  expect(node, `no node with text "${textToFind}"`).toBeTruthy();
  node!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("the capture sheet", () => {
  it("lists the day's actions with Photo on top, against the current job", async () => {
    const screen = await mount(<CaptureSheet visible onClose={() => {}} job={JOB} />);
    const words = text();
    expect(words).toContain("Photo");
    expect(words).toContain("Field report");
    expect(words).toContain("Time");
    expect(words).toContain("Punch item");
    expect(words).toContain("Material order");
    expect(words).toContain("Toolbox talk or an incident");
    expect(words).toContain("T&M ticket");
    expect(words).not.toContain("Pick a job first");
    // Photo is the first row — the shutter is what the button is FOR.
    expect(words.indexOf("Photo")).toBeLessThan(words.indexOf("Field report"));
    screen.unmount();
  });

  it("opens the shutter on the Photo row — the two-tap promise", async () => {
    const screen = await mount(<CaptureSheet visible onClose={() => {}} job={JOB} />);
    click("Photo");
    expect(vi.mocked(router.push)).toHaveBeenCalledWith("/photos/job_1?open=camera");
    screen.unmount();
  });

  it("routes every other action to its section for this job", async () => {
    const screen = await mount(<CaptureSheet visible onClose={() => {}} job={JOB} />);
    click("Time");
    expect(vi.mocked(router.push)).toHaveBeenCalledWith("/time/job_1");
    screen.unmount();
  });

  it("refuses to guess the job, and points at the picker", async () => {
    const screen = await mount(<CaptureSheet visible onClose={() => {}} job={null} />);
    expect(text()).toContain(
      "Pick a job first — everything here gets filed against one, and guessing which is how a",
    );
    click("Pick a job");
    expect(vi.mocked(router.navigate)).toHaveBeenCalledWith("/(tabs)/jobs");
    screen.unmount();
  });
});

describe("the floating capture button", () => {
  it("is one press away and tells nobody else about it", async () => {
    const onPress = vi.fn();
    const screen = await mount(<FloatingCaptureButton onPress={onPress} />);
    // The label is the accessibility name — an aria-label, not text.
    const button = document.querySelector('[aria-label="Capture"]');
    expect(button, "no capture button").toBeTruthy();
    button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onPress).toHaveBeenCalledTimes(1);
    screen.unmount();
  });
});
