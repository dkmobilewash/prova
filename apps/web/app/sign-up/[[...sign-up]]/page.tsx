import Image from "next/image";
import { SignUp } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { bidAuthDestination, bidAuthHref, parseHostList } from "@/lib/bid/surface";

export const metadata = { title: "Sign up" };

/**
 * SHARED BY BOTH PRODUCTS — see the sign-in page's header, which this mirrors.
 * A first-time sign-up from C Stream Bid is FORCED back into Bid: left to the
 * CRM default it would reach /dashboard, whose onboarding gate walks a new
 * company into /welcome — the CRM's questions, on the wrong product. The
 * company itself is still created by `requireCompanyContext` on the first
 * signed-in Bid page, exactly as on the CRM: same account, same company.
 */
export default async function SignUpPage({
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
        <SignUp
          forceRedirectUrl={bidTarget}
          signInUrl={bidAuthHref("sign-in")}
          signInForceRedirectUrl={bidTarget}
        />
      ) : (
        <SignUp fallbackRedirectUrl="/dashboard" />
      )}
    </main>
  );
}
