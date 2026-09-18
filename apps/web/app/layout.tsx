import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { StaleDeployBanner } from "@/components/StaleDeployBanner";
import { RscFailureBanner } from "@/components/RscFailureBanner";
import "./globals.css";

export const metadata: Metadata = {
  // Absolute base for the link-preview image (app/opengraph-image.png) and
  // the icons, which Next turns into full URLs. The live app's own address.
  metadataBase: new URL("https://app.cstream.ai"),
  title: "C Stream",
  description: "Contractor operating system",
  openGraph: { siteName: "C Stream", title: "C Stream", description: "Contractor operating system" },
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
          // The dark palette (2026-09-11, the approved dark mockups) —
          // same values as tailwind.config.ts: surface card, canvas
          // inputs, the four-step ink ramp. Yellow still cannot carry
          // white text, so the on-primary colour is set explicitly
          // instead of letting Clerk assume light-on-primary.
          colorPrimary: "#facc15",
          colorTextOnPrimaryBackground: "#171717",
          colorBackground: "#1a1a1a",
          colorInputBackground: "#0f0f0f",
          colorInputText: "#fafafa",
          colorText: "#fafafa",
          colorTextSecondary: "#d4d4d4",
          // Clerk derives its grey ramp (borders, secondary buttons)
          // from this; on a dark background it has to be the LIGHT
          // anchor or every derived grey sinks into the card.
          colorNeutral: "#fafafa",
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
          {/* #118: a 5xx on a live RSC navigation fetch or a Server Action
              POST was previously invisible -- Next either silently kept
              rendering an earlier successful prefetch, or (for an
              action) failed with no on-screen sign of it. Renders
              nothing until it actually fires -- see the component's own
              comment for exactly what it does and does not fix. */}
          <RscFailureBanner />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
