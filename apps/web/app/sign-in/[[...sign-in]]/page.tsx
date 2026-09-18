import Image from "next/image";
import { SignIn } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function SignInPage() {
  // Already signed in: this card has nothing to show, and on production it
  // rendered as a blank page after a finished sign-up. Go to the app.
  const { userId } = await auth();
  if (userId) redirect("/dashboard");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-4 py-10">
      <Image src="/brand/cstream-wordmark.png" alt="C Stream" width={240} height={48} className="h-10 w-auto" priority />
      <SignIn fallbackRedirectUrl="/dashboard" />
    </main>
  );
}
