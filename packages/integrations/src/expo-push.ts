// Push notifications to devices, via Expo's push service.
//
// Same contract as email.ts: nothing throws for a missing key. An
// unconfigured install is a clearly reported state, not a crash — CI and
// local dev have no Expo access token, and a contractor who hasn't wired
// push yet still needs the rest of the app to work.

export type ExpoPushRequest = {
  /** The Expo push token (an `ExponentPushToken[...]` string). */
  to: string;
  title: string;
  body: string;
  /** Arbitrary payload, delivered to the app alongside the notification. */
  data?: Record<string, unknown>;
};

export type ExpoPushResult =
  | { ok: true; ticketCount: number }
  | { ok: false; error: string; configured: boolean };

/** Reads the Expo access token from the environment. Null means sending
 * isn't set up — the caller reports that as a state. */
export function readExpoPushConfig(): { accessToken: string } | null {
  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
  if (!accessToken) return null;
  return { accessToken };
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export async function sendExpoPush(messages: ExpoPushRequest[]): Promise<ExpoPushResult> {
  const config = readExpoPushConfig();
  if (!config) {
    return { ok: false, error: "EXPO_ACCESS_TOKEN is not set", configured: false };
  }

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        messages.map((m) => ({ to: m.to, title: m.title, body: m.body, data: m.data ?? {} })),
      ),
    });
    if (!res.ok) {
      return { ok: false, error: `Expo push failed (${res.status})`, configured: true };
    }
    const json = (await res.json()) as { data?: unknown[] };
    return { ok: true, ticketCount: json.data?.length ?? 0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Expo push failed", configured: true };
  }
}
