### The C Stream logo, everywhere the app shows itself (Cyrus)
`cyrus/logo`

Cyrus's logo — a white C with yellow speed lines, then STREAM, on black —
is now the app's identity. The supplied PNG had no transparency, so it was
made transparent by taking alpha from brightness (the ground is black) and
split into the full wordmark and the C mark.

- **Browser tab and home-screen icons** (`app/icon.png`,
  `app/apple-icon.png`): the C on the canvas colour. There was no favicon
  at all before this.
- **Link previews** (`app/opengraph-image.png`, with `metadataBase` set to
  app.cstream.ai so the preview URL is absolute).
- **Sidebar**: the C mark replaces the yellow "C" tile. **Mobile drawer**:
  the wordmark replaces the text "C Stream".
- **Sign-in and sign-up**: the wordmark above Clerk's card. Clerk's own
  card still says "Sign in to Prova" — that is the application name in the
  Clerk dashboard, not code.
- **Phone app** (`apps/mobile`): icon, Android adaptive icon, splash, and
  display name "C Stream". Slug, scheme and bundle identifiers are
  unchanged on purpose — changing those breaks installs. It takes effect
  on the next EAS build.

Images under `/brand/*.png` are outside the auth middleware (its matcher
skips image extensions), so the sign-in page can load them signed out.
Checked in the browser: sign-in shows the wordmark; the rail shows the
mark; the page links `/icon.png`, `/apple-icon.png` and the OG image.
