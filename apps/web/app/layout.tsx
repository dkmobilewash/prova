import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { StaleDeployBanner } from "@/components/StaleDeployBanner";
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
          // The yellow/black/white light palette (2026-09-11). Yellow
          // cannot carry white text, so the on-primary colour is set
          // explicitly instead of letting Clerk assume light-on-primary.
          colorPrimary: "#facc15",
          colorTextOnPrimaryBackground: "#171717",
          colorBackground: "#ffffff",
          colorInputBackground: "#ffffff",
          colorInputText: "#0a0a0a",
          colorText: "#0a0a0a",
          colorTextSecondary: "#404040",
          colorNeutral: "#404040",
          borderRadius: "0.5rem",
        },
      }}
    >
      <html lang="en">
        <body className="min-h-screen bg-canvas text-ink">
          {/* #118: covers every route group, including the public portal
              and esign pages, which are just as likely to be left open
              across a deployment as anything under (app). Renders nothing
              until it actually fires -- see the component's own comment. */}
          <StaleDeployBanner />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
