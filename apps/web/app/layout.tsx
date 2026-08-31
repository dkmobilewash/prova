import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prova",
  description: "Contractor operating system",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider
      // Where Clerk's own components link to. Without these they fall back
      // to whatever the INSTANCE is configured with, and the two instances
      // disagree: a development instance defaults to these app paths, a
      // production one defaults to its Account Portal. The result on
      // production was a "Sign up" link on the sign-in card that navigated
      // nowhere and logged nothing — no error, no movement, and no way for
      // a new person to create an account.
      //
      // Relative, not absolute. Previews run on vercel.app hostnames and
      // production on app.cstream.ai; a hardcoded origin would be wrong on
      // one of them, and this is exactly the kind of setting that should
      // live in the repo rather than in a dashboard that differs per
      // instance.
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      appearance={{
        variables: {
          colorPrimary: "#3b82f6",
          colorBackground: "#0f172a",
          colorInputBackground: "#1e293b",
          colorInputText: "#f1f5f9",
          colorText: "#f1f5f9",
          colorTextSecondary: "#94a3b8",
          colorNeutral: "#94a3b8",
          borderRadius: "0.5rem",
        },
      }}
    >
      <html lang="en">
        <body className="min-h-screen bg-slate-950 text-slate-100">{children}</body>
      </html>
    </ClerkProvider>
  );
}
