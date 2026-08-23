import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-3xl font-semibold text-slate-100">Prova</h1>
      <p className="text-slate-400">
        One estimate. One budget. One contract. One job-costing structure. No retyping.
      </p>
      <SignedOut>
        <div className="flex gap-3">
          <Link
            href="/sign-up"
            className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Sign up
          </Link>
          <Link
            href="/sign-in"
            className="inline-flex items-center justify-center rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
          >
            Sign in
          </Link>
        </div>
      </SignedOut>
      <SignedIn>
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          Go to dashboard
        </Link>
      </SignedIn>
    </main>
  );
}
