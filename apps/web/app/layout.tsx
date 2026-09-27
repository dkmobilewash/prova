import type { Metadata } from "next";
import localFont from "next/font/local";
import { ClerkProvider } from "@clerk/nextjs";
import { StaleDeployBanner } from "@/components/StaleDeployBanner";
import { RscFailureBanner } from "@/components/RscFailureBanner";
import "./globals.css";

/**
 * THE ONLY TYPEFACE THIS APP DECLARES, AND UNTIL NOW IT DECLARED NONE.
 * Nothing in globals.css, tailwind.config.ts or this file set a family, so
 * every heading rendered in `ui-sans-serif, system-ui, sans-serif` — SF Pro
 * on a Mac, Segoe UI on Windows, Roboto on Android. Measured, not assumed:
 * `document.fonts.size` was 0 on the landing page and no font file was
 * requested. That is the argument for a webfont on its own. It also means
 * every width ever measured for this page was a measurement of whatever the
 * measuring machine happened to have, which is why #532's report had to
 * carry a caveat about its own numbers. A self-hosted face removes the
 * caveat rather than shrinking it.
 *
 * NO PSYCHOLOGY CLAIM IS BEING MADE. A serif does not "read as more
 * trustworthy" than a sans in any evidence worth citing — the studies that
 * get quoted for that compare a competent face against Comic Sans, which
 * says nothing about choosing between two competent ones. The two reasons
 * here are both measurable: the page gets ONE appearance everywhere, and a
 * condensed face fits materially more per line.
 *
 * THAT SECOND REASON IS WHY IT IS CONDENSED RATHER THAN A MATTER OF TASTE.
 * Measured in real Chromium at 1280, the min-content width of
 * "subcontractors." — the widest unbreakable word in the headline, and the
 * thing that decides how narrow its column can be — at 64px:
 *
 *     system fallback   549.5px      Archivo           449.9px
 *     Barlow Condensed  342.0px      Chivo             484.7px
 *     Archivo Narrow    364.5px      Roboto Condensed  383.2px
 *
 * In the hero's left column at the widened panel (488px), the largest size
 * that still sets the headline in four lines: Barlow Condensed 84px,
 * Archivo Narrow 72px, Roboto Condensed 72px, Archivo 64px, Chivo none —
 * and the SYSTEM FALLBACK NONE, at any size down to 56. So the face is what
 * makes the bigger panel and a bigger headline possible at the same time.
 *
 * Barlow Condensed over Archivo Narrow on the numbers (84px against 72px in
 * the same column, and 448.9px of min-content inside 488px), and it reads
 * like the signage and stencilled lettering this trade is surrounded by,
 * which is a better fit for a union specialty-trade subcontractor than a
 * neutral UI face. Roboto Condensed matched Archivo Narrow and is the
 * Android system font, so it is the one condensed face that would look like
 * "no choice was made" on a large share of phones.
 *
 * HEADINGS ONLY, and body text stays on the system stack: a second family
 * is a second download, and this page's speed is an asset. One weight (600)
 * covers every heading in the app — they are all `font-semibold`.
 *
 * `next/font` rather than a <link> to Google Fonts, for two things a link
 * cannot do: it SELF-HOSTS the file (no third-party connection from the
 * visitor's browser, nothing to block, no privacy question) and it generates
 * a size-adjusted local fallback, so the swap does not move the text.
 * `display: "swap"` keeps the headline readable if the file is slow — with
 * the adjusted fallback, a swap that shifts nothing.
 *
 * LOCAL rather than `next/font/google`, and app/fonts/README.md has the long
 * version: the Google loader fetches at BUILD time, which makes every build
 * in CI and on Vercel depend on a third party for a 22KB file that never
 * changes, and a build that cannot reach it fails rather than degrades. It
 * also could not be measured from here — Node's fetch does not use the
 * egress proxy, so the build died on "Failed to fetch `Barlow Condensed`
 * from Google Fonts" and there was no page to put a browser in front of.
 * A face chosen by measurement has to be measurable.
 */
const headline = localFont({
  src: "./fonts/BarlowCondensed-SemiBold-latin.woff2",
  weight: "600",
  style: "normal",
  display: "swap",
  variable: "--font-headline",
});

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
      // Where a finished sign-in or sign-up goes. Left unset, Clerk falls
      // back to whatever the instance is configured with — and on production
      // a brand-new account finished sign-up and stayed on /sign-up, signed
      // in, looking at a blank page (the card renders nothing once there is
      // a session). Found walking the contractor's first-day path, 2026-09-18.
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/dashboard"
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
      <html lang="en" className={headline.variable}>
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
