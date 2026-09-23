/**
 * The two values a build has to be given, and what to say when it wasn't.
 *
 * Both are `EXPO_PUBLIC_`, so they are baked into the bundle AT BUILD
 * TIME. On a laptop they come from `apps/mobile/.env`; on EAS they
 * cannot — Expo's own docs say .env files "are not available for jobs
 * that run on a remote server, for example, EAS Build". So a cloud build
 * gets whatever `eas.json` and the EAS environment supply, and nothing
 * else.
 *
 * **The reason this file exists is the shape of the failure, not the
 * lookup.** Both reads used to fall back silently: the API URL to
 * `http://localhost:3000` and the Clerk key to `""`. A TestFlight build
 * made without them would install, launch, and then fail every request
 * against a localhost that is the PHONE — which the offline-first engine
 * renders as "No connection", the one message that blames the jobsite
 * for a mistake made at build time. An empty Clerk key throws somewhere
 * inside the provider instead. Neither says the true thing, which is
 * that this build was never told where the server is.
 */

const LOCAL_SERVER = "http://localhost:3000";

export const apiBaseUrl: string = process.env.EXPO_PUBLIC_API_URL ?? LOCAL_SERVER;
export const clerkPublishableKey: string =
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

/**
 * A sentence naming what the build is missing, or null when it is fine.
 *
 * Pure, and takes its inputs, so the release case is testable from a
 * laptop where `__DEV__` is true and both values are present.
 *
 * A development build pointed at localhost is normal — that IS the
 * laptop running `pnpm dev`. The same thing in a release build is a
 * misconfigured build, because no phone has a server on its own port
 * 3000.
 */
export function configProblem(input: {
  apiUrl: string;
  clerkKey: string;
  isDev: boolean;
}): string | null {
  const missing: string[] = [];
  if (!input.isDev && input.apiUrl === LOCAL_SERVER) {
    missing.push("the server address (EXPO_PUBLIC_API_URL)");
  }
  if (!input.clerkKey) {
    missing.push("the sign-in key (EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY)");
  }
  if (missing.length === 0) return null;

  return `This build was made without ${missing.join(" and ")}. It cannot reach C Stream until it is rebuilt with them — see eas.json and the EAS environment for this profile.`;
}
