import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "./render";

/**
 * The door.
 *
 * Google-only shipped a rule nobody decided: a framer whose email the
 * office never linked to a Google account could not use the app at all.
 * These cases pin the way in (email and password), the way back when the
 * password is gone, and the decision NOT to offer account creation here
 * — signing up on the phone makes a company rather than joining one, and
 * lands the person in an empty app.
 */

const clerk = vi.hoisted(() => ({
  create: vi.fn(),
  attemptFirstFactor: vi.fn(),
  setActive: vi.fn(),
  startOAuthFlow: vi.fn(),
}));

vi.mock("@clerk/expo", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: false, getToken: async () => null }),
  useUser: () => ({ user: null }),
  useOAuth: () => ({ startOAuthFlow: clerk.startOAuthFlow }),
}));

// The screen takes sign-in from the legacy entry point rather than the
// root — see the note at the top of app/sign-in.tsx. Mocking the module
// the screen actually imports is the point: mock the other one and these
// tests pass against a hook nothing calls.
vi.mock("@clerk/expo/legacy", () => ({
  useSignIn: () => ({
    isLoaded: true,
    signIn: { create: clerk.create, attemptFirstFactor: clerk.attemptFirstFactor },
    setActive: clerk.setActive,
  }),
}));

const { default: SignInScreen } = await import("@/app/sign-in");

beforeEach(() => {
  clerk.create.mockReset();
  clerk.attemptFirstFactor.mockReset();
  clerk.setActive.mockReset();
  clerk.startOAuthFlow.mockReset();
  clerk.startOAuthFlow.mockResolvedValue({ createdSessionId: null, setActive: undefined });
});

function text(): string {
  return document.body.textContent ?? "";
}

function click(label: string): void {
  const node = Array.from(document.querySelectorAll("*")).find((n) => n.textContent === label);
  expect(node, `no control reading "${label}"`).toBeTruthy();
  act(() => {
    node!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Type into a labelled field the way a person does — through the DOM,
 * so the controlled value actually changes rather than being assigned. */
function type(label: string, value: string): void {
  const input = Array.from(document.querySelectorAll("input")).find(
    (i) => i.getAttribute("aria-label") === label,
  );
  expect(input, `no field labelled "${label}"`).toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  act(() => {
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("signing in on the phone", () => {
  it("offers email and password first, with Google kept underneath", async () => {
    const screen = await mount(<SignInScreen />);
    const words = text();
    expect(words).toContain("Email");
    expect(words).toContain("Password");
    expect(words).toContain("Sign in");
    expect(words).toContain("Forgot password?");
    expect(words).toContain("Continue with Google");
    expect(words.indexOf("Password")).toBeLessThan(words.indexOf("Continue with Google"));
    screen.unmount();
  });

  it("never offers to create an account — that would make a company, not join one", async () => {
    const screen = await mount(<SignInScreen />);
    const words = text();
    for (const forbidden of ["Create account", "Create an account", "Sign up", "Register"]) {
      expect(words).not.toContain(forbidden);
    }
    // And says what to do instead, so the dead end is not silent.
    expect(words).toContain("The office adds you first");
    screen.unmount();
  });

  it("signs in with what was typed, and makes the new session active", async () => {
    clerk.create.mockResolvedValue({ status: "complete", createdSessionId: "sess_1" });
    const screen = await mount(<SignInScreen />);

    type("Email", " foreman@example.com ");
    type("Password", "a-real-password");
    click("Sign in");
    await screen.settle();

    // NOT a test of the .trim() in the screen, and saying so because the
    // opposite is the easy assumption: these tests run against a web
    // `input type="email"`, whose value sanitisation strips surrounding
    // whitespace before React ever sees it — so this passes with the trim
    // removed. The trim earns its place on the DEVICE, where a native
    // TextInput sanitises nothing and an iOS keyboard offers a trailing
    // space with every autocomplete.
    expect(clerk.create).toHaveBeenCalledWith({
      identifier: "foreman@example.com",
      password: "a-real-password",
    });
    expect(clerk.setActive).toHaveBeenCalledWith({ session: "sess_1" });
    screen.unmount();
  });

  it("says what went wrong in words the person can act on", async () => {
    clerk.create.mockRejectedValue({ errors: [{ code: "form_identifier_not_found" }] });
    const screen = await mount(<SignInScreen />);

    type("Email", "nobody@example.com");
    type("Password", "whatever");
    click("Sign in");
    await screen.settle();

    expect(text()).toContain("Ask the office");
    expect(clerk.setActive).not.toHaveBeenCalled();
    screen.unmount();
  });

  it("refuses a second submit from the KEYBOARD while one is in flight", async () => {
    // The button being disabled covers the second TAP. It does not cover
    // this: the Go key on the keyboard calls the same submit directly,
    // and a slow round-trip on one bar is exactly when somebody presses
    // it again. Two sign-ins is how a person rate-limits themselves out
    // of a phone they were already signed into. Remove the `if (busy)`
    // guard in the screen and this case goes red; the tap case does not.
    let release: (value: unknown) => void = () => {};
    clerk.create.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const screen = await mount(<SignInScreen />);

    type("Email", "foreman@example.com");
    type("Password", "a-real-password");
    click("Sign in");
    await screen.settle();

    const password = Array.from(document.querySelectorAll("input")).find(
      (i) => i.getAttribute("aria-label") === "Password",
    );
    act(() => {
      password!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await screen.settle();

    expect(clerk.create).toHaveBeenCalledTimes(1);

    release({ status: "complete", createdSessionId: "sess_1" });
    await screen.settle();
    screen.unmount();
  });

  it("says it is working, and the button stops being a button", async () => {
    // The half a person can SEE. The guard above already stops a second
    // submit, so counting calls here proves nothing about the button —
    // the disabled state is asserted on the element itself, which is
    // what greys it out and what a screen reader announces.
    let release: (value: unknown) => void = () => {};
    clerk.create.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const screen = await mount(<SignInScreen />);

    type("Email", "foreman@example.com");
    type("Password", "a-real-password");
    click("Sign in");
    await screen.settle();

    expect(text()).toContain("Signing in…");
    const button = Array.from(document.querySelectorAll("*")).find(
      (n) => n.textContent === "Signing in…" && n.getAttribute("aria-disabled") !== null,
    );
    expect(button, "the in-flight button is not marked disabled").toBeTruthy();
    expect(button!.getAttribute("aria-disabled")).toBe("true");

    release({ status: "complete", createdSessionId: "sess_1" });
    await screen.settle();
    screen.unmount();
  });

  it("sends a reset code to the person holding the phone", async () => {
    clerk.create.mockResolvedValue({ status: "needs_first_factor" });
    const screen = await mount(<SignInScreen />);

    type("Email", "foreman@example.com");
    click("Forgot password?");
    await screen.settle();
    expect(text()).toContain("6-digit code");

    click("Email me a code");
    await screen.settle();

    expect(clerk.create).toHaveBeenCalledWith({
      strategy: "reset_password_email_code",
      identifier: "foreman@example.com",
    });
    expect(text()).toContain("Code from the email");
    expect(text()).toContain("New password");
    screen.unmount();
  });

  it("sets the new password and signs in with it", async () => {
    clerk.create.mockResolvedValue({ status: "needs_first_factor" });
    clerk.attemptFirstFactor.mockResolvedValue({ status: "complete", createdSessionId: "sess_2" });
    const screen = await mount(<SignInScreen />);

    type("Email", "foreman@example.com");
    click("Forgot password?");
    await screen.settle();
    click("Email me a code");
    await screen.settle();

    type("Code from the email", "123456");
    type("New password", "a-brand-new-password");
    click("Set password and sign in");
    await screen.settle();

    expect(clerk.attemptFirstFactor).toHaveBeenCalledWith({
      strategy: "reset_password_email_code",
      code: "123456",
      password: "a-brand-new-password",
    });
    expect(clerk.setActive).toHaveBeenCalledWith({ session: "sess_2" });
    screen.unmount();
  });

  it("still signs in with Google for everyone already using it", async () => {
    clerk.startOAuthFlow.mockResolvedValue({
      createdSessionId: "sess_g",
      setActive: clerk.setActive,
    });
    const screen = await mount(<SignInScreen />);

    click("Continue with Google");
    await screen.settle();

    expect(clerk.startOAuthFlow).toHaveBeenCalled();
    expect(clerk.setActive).toHaveBeenCalledWith({ session: "sess_g" });
    screen.unmount();
  });
});
