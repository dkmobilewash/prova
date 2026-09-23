/**
 * What a failed sign-in SAYS, in this app's voice.
 *
 * Clerk's own errors are written for a web app with a support team
 * ("Couldn't find your account.", "Password is incorrect. Try again, or
 * use another method."). A foreman on a roof needs to know which of two
 * things to do next: fix what they typed, or ask the office to add them.
 * So the codes that matter are mapped, and everything else falls back to
 * a sentence rather than a raw object — an error screen that renders
 * `[object Object]` is the one thing worse than no message.
 *
 * PASSWORD RULES ARE DELIBERATELY NOT RESTATED HERE. The minimum length
 * and the breach check are instance settings in the Clerk dashboard, so
 * any copy repeating them here would go stale the day somebody changes
 * one — the failure this repo keeps paying for. Those errors pass
 * Clerk's own sentence through instead, which is generated from the
 * setting itself.
 */

type ClerkFieldError = {
  code?: string;
  message?: string;
  longMessage?: string;
};

/** Clerk throws an object carrying an `errors` array; anything else here
 * is a thrown Error, a network failure, or a bug. */
function clerkErrors(error: unknown): ClerkFieldError[] {
  if (!error || typeof error !== "object") return [];
  const errors = (error as { errors?: unknown }).errors;
  return Array.isArray(errors) ? (errors as ClerkFieldError[]) : [];
}

const BY_CODE: Record<string, string> = {
  form_identifier_not_found:
    "No account for that email. Ask the office to add you, or use Continue with Google.",
  form_password_incorrect: "That password doesn't match. Try again, or reset it below.",
  form_param_format_invalid: "Check the email address — that one isn't valid.",
  form_param_nil: "Fill in both fields.",
  form_code_incorrect: "That code isn't right. Check the email and type it again.",
  verification_expired: "That code has expired. Send a new one.",
  verification_failed: "That code didn't work. Send a new one.",
  too_many_requests: "Too many tries. Wait a minute, then try again.",
  session_exists: "You're already signed in.",
};

/** A lost connection, which on a jobsite is the likeliest failure of all
 * and the only one where trying again later is the right advice. */
function isNetworkFailure(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /network request failed|failed to fetch|network error/i.test(message);
}

/**
 * The sentence to show under the form. Always non-empty.
 */
export function signInMessage(error: unknown): string {
  if (isNetworkFailure(error)) {
    return "No connection. Signing in needs signal — once you're in, the app keeps working offline.";
  }

  const [first] = clerkErrors(error);
  if (first) {
    const mapped = first.code ? BY_CODE[first.code] : undefined;
    if (mapped) return mapped;
    // Password rules come from the dashboard, so Clerk's own sentence is
    // the only one that cannot be wrong about them.
    const passed = first.longMessage || first.message;
    if (passed) return passed;
  }

  return "Couldn't sign in. Try again.";
}

/**
 * The race the old screen swallowed: the session already exists and
 * `isSignedIn` has not flipped yet, so the redirect is one render away
 * and there is nothing to apologise for.
 */
export function isAlreadySignedIn(error: unknown): boolean {
  return clerkErrors(error).some((e) => e.code === "session_exists");
}
