import { emailSetupProblem, looksLikeEmail } from "@prova/integrations";
import { helpChannel, type HelpChannel } from "@/lib/help-request";

/**
 * Where a help request goes, read from configuration.
 *
 * Split out of `help-request.ts` so that file can stay import-free and
 * therefore safe to use from the client component that needs its
 * formatters — see the note at the top of it.
 */

/**
 * The address that should receive help requests, or null if this install
 * has not been given one.
 *
 * Validated rather than trusted, and that is the whole reason this is a
 * function instead of a property read. An unset variable and a typo'd one
 * must not look the same: with a typo the panel would offer a Send button
 * or a `mailto:` link that goes nowhere, which is a dead end that LOOKS
 * like a working one. `looksLikeEmail` is the same permissive check every
 * outbound address in this app goes through — deliberately not RFC
 * validation, because rejecting a real address is worse than letting the
 * provider reject a fake one.
 *
 * Takes the environment as an argument so every branch is executed in the
 * unit suite without mutating `process.env`.
 */
export function readSupportAddress(env: Record<string, string | undefined>): string | null {
  const value = env.SUPPORT_EMAIL?.trim();
  if (!value || !looksLikeEmail(value)) return null;
  return value;
}

/**
 * The channel available on this install, right now.
 *
 * Three lines of composition over three tested functions, and it stays
 * that way on purpose: `emailSetupProblem()` reads `process.env` itself,
 * so a version of this that took an environment argument would be lying
 * about half of what it consults. Both call sites — the topbar that
 * renders the panel and the action that sends — go through this, so the
 * panel can never offer a path the action then refuses.
 */
export function helpChannelFromEnv(): HelpChannel {
  return helpChannel({
    supportAddress: readSupportAddress(process.env),
    emailProblem: emailSetupProblem(),
  });
}
