import { useAuth } from "@clerk/expo";
import { useEffect } from "react";
import { registerForPush } from "./push";

/** Registers the device for push once the user is signed in. Idempotent —
 * the backend upserts on the token, so re-registering only refreshes
 * lastSeenAt and re-binds the user. */
export function usePushRegistration() {
  const { isSignedIn, getToken } = useAuth();

  useEffect(() => {
    if (!isSignedIn) return;
    (async () => {
      const token = await getToken();
      if (!token) return;
      try {
        await registerForPush(token);
      } catch {
        // Push registration is best-effort — never block the app on it.
      }
    })();
  }, [isSignedIn, getToken]);
}
