import Image from "next/image";
import { SignIn } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { bidAuthDestination, bidAuthHref, parseHostList } from "@/lib/bid/surface";

export const metadata = { title: "Sign in" };

/**
 * SHARED BY BOTH PRODUCTS — one Clerk instance, one account. C Stream Bid
 * (bid.cstream.ai) sends people here too, and they must land back in Bid, not
 * on the CRM's /dashboard. `bidAuthDestination` (lib/bid/surface.ts) decides
 * from the host and from Clerk's `redirect_url` — the only signal a preview or
 * localhost has — and returns a /bid path it BUILT, never the raw
 * redirect_url. `null` means the CRM, exactly as before.
 *
 * For Bid the destination is FORCED rather than a fallback: a fallback loses
 * to whatever the instance is configured with, and a Bid user who reached
 * /dashboard would be inside the CRM. The card's "Sign up" link keeps the
 * Bid redirect_url, so switching cards on a preview does not lose it.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string | string[] }>;
}) {
  const { redirect_url } = await searchParams;
  const bidTarget = bidAuthDestination(
    (await headers()).get("host"),
    Array.isArray(redirect_url) ? redirect_url[0] : redirect_url,
    parseHostList(process.env.BID_HOSTS),
  );
  // Already signed in: this card has nothing to show, and on production it
  // rendered as a blank page after a finished sign-up. Go to the app.
  const { userId } = await auth();
  if (userId) redirect(bidTarget ?? "/dashboard");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-4 py-10">
      <Image src="/brand/cstream-wordmark.png" alt="C Stream" width={240} height={48} className="logo-on-theme h-10 w-auto" priority />
      {bidTarget ? (
        <SignIn
          forceRedirectUrl={bidTarget}
          signUpUrl={bidAuthHref("sign-up")}
          signUpForceRedirectUrl={bidTarget}
        />
      ) : (
        <SignIn fallbackRedirectUrl="/dashboard" />
      )}
    </main>
  );
}
