import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function HomePage() {
  // A signed-in person has nowhere to go from here but the dashboard.
  const { userId } = await auth();
  if (userId) redirect("/dashboard");
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-3xl font-semibold text-ink">C Stream</h1>
      <p className="text-ink-body">
        One estimate. One budget. One contract. One job-costing structure. No retyping.
      </p>
      <SignedOut>
        <div className="flex gap-3">
          <Link
            href="/sign-up"
            className="inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
          >
            Sign up
          </Link>
          <Link
            href="/sign-in"
            className="inline-flex items-center justify-center rounded-md bg-neutral-800 px-4 py-2 text-sm font-medium text-ink hover:bg-neutral-700"
          >
            Sign in
          </Link>
        </div>
      </SignedOut>
      <SignedIn>
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
        >
          Go to dashboard
        </Link>
      </SignedIn>
    </main>
  );
}
