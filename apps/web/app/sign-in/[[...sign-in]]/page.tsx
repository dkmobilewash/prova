import Image from "next/image";
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-4 py-10">
      <Image src="/brand/cstream-wordmark.png" alt="C Stream" width={240} height={48} className="h-10 w-auto" priority />
      <SignIn />
    </main>
  );
}
