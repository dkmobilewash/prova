/**
 * EVERYTHING ON /associations/wwcca THAT NAMES THE ASSOCIATION OR MAKES AN
 * OFFER TO ITS MEMBERS LIVES IN THIS FILE, so it can be switched off, or
 * reworded after the association has read it, without touching layout.
 *
 * ── READ THIS BEFORE EDITING ANY SENTENCE BELOW ─────────────────────────
 *
 * THERE IS NO PARTNERSHIP, ENDORSEMENT OR MEMBER-DISCOUNT PROGRAM WITH THE
 * WWCCA. The association has never run one. Its CEO is related to one of
 * C Stream's founders, which makes anything that LOOKS like an endorsement
 * actively harmful: it would read as a favour and embarrass him. The plan is
 * to ask the association's Innovation Committee to evaluate the product, and
 * this page is something to show them — not a claim that they approved
 * anything.
 *
 * So the test for every sentence here: WOULD THE WWCCA HAVE TO AGREE TO IT
 * FOR IT TO BE TRUE? If yes, cut it. "For wall and ceiling contractors in
 * the WWCCA" is true on our say-so. "Endorsed by", "official partner", "in
 * partnership with", "WWCCA member discount", "exclusive through WWCCA" are
 * not, and neither is the association's logo. The offer below is C STREAM'S
 * offer, made to the association's members by name — never the
 * association's program.
 *
 * ── WHAT THE ASSOCIATION MUST APPROVE BEFORE THIS PAGE GOES LIVE ─────────
 *
 * Nothing below is done until the WWCCA says yes IN WRITING. Until then the
 * page stays noindex, unlinked, and shown only on request:
 *
 *   1. Use of the association's name on the page ("For WWCCA member
 *      contractors", and the name in the offer and the disclosure).
 *   2. The founding-member offer made to its members by name: $399 per
 *      month per company, flat, unlimited users, the first 60 days free as
 *      onboarding, limited to the first 10 member companies.
 *   3. Use of the WWCCA logo, with written permission — `logoSrc` below.
 *   4. Linking to the page from anywhere, or letting search engines index
 *      it (both are code changes, deliberately; see THE SWITCH).
 *
 * ── THE LOGO ────────────────────────────────────────────────────────────
 *
 * `logoSrc` is a SLOT, and it is null. A trade association's logo may not
 * be used without its written permission, and showing it before then would
 * imply exactly the endorsement this file exists to rule out. When it is
 * null the hero renders no lockup and leaves no gap. Set it ONLY after
 * permission is in writing, to a file the association itself supplied and
 * committed under public/ — never downloaded, copied or hotlinked from its
 * website — and change page.test.ts's null pin in the same commit, with the
 * permission referenced in the PR.
 *
 * ── THE SWITCH ──────────────────────────────────────────────────────────
 *
 * `enabled: false` makes the route 404 (app/associations/wwcca/page.tsx
 * calls notFound()). One line, no layout edit, no deploy of anything else.
 * Chosen over deleting the route because the page is meant to be shown to
 * the committee on request, and over an environment variable because a
 * reviewer can read this line in a diff and cannot read Vercel's settings.
 *
 * What the switch does NOT control, on purpose: `noindex, nofollow`. That is
 * hard-coded in the page's metadata and asserted by its test. A flag that
 * turns indexing on is a flag somebody flips to "see if it helps", and the
 * page must stay out of search until the association has seen it and agreed
 * to the use of its name. Turning indexing on should be a code change with a
 * reason in the PR, not a boolean.
 *
 * ── PRICING ─────────────────────────────────────────────────────────────
 *
 * Set by Cyrus 2026-09-21: $399 per month, per company, flat, unlimited
 * users, with the first 60 days free as ONBOARDING (the founders load the
 * member's data and run one real billing cycle through it) — never called
 * a free trial. That is the only number on this page and it lives in
 * `FOUNDING_OFFER.price` and `.onboarding` below, nowhere in the layout.
 *
 * NOT DECIDED, AND THEREFORE NOT ON THE PAGE: how long the lock lasts, any
 * discount percentage, and anything about AI allowances. The "locked in"
 * sentence stays deliberately without a length. page.test.ts fails on a
 * lifetime promise, a percentage, a second dollar figure, "trial", or an AI
 * allowance, so adding one of those is a decision somebody has to make in
 * the test as well as here.
 *
 * The "first 10" limit is stated with its real reason (the founders' own
 * time) and deliberately has NO counter, no "spots left" and no countdown:
 * nothing in this app tracks how many companies have taken it up, and a
 * counter we cannot back up is a false claim on a page shown to the
 * association.
 */

export const WWCCA = {
  /** THE SWITCH. false = /associations/wwcca returns 404. See the header. */
  enabled: true,

  shortName: "WWCCA",
  fullName: "Western Wall & Ceiling Contractors Association",

  /** Small line above the headline. Says who the page is for — not who it
   * is from, and not who approved it. */
  eyebrow: "For WWCCA member contractors",

  /**
   * The disclosure. One line near the foot of the page, in plain words,
   * because the relationship described in the header is exactly what a
   * careful reader will wonder about, and the honest answer costs nothing.
   */
  independence:
    "C Stream is an independent company. This page is not published, sponsored or endorsed by the WWCCA.",

  /** THE LOGO SLOT — null until the association gives written permission.
   * See THE LOGO in the header; page.test.ts pins this to null. */
  logoSrc: null as string | null,
  logoAlt: "Western Wall & Ceiling Contractors Association",
} as const;

/**
 * C Stream's founding-member offer to WWCCA member companies.
 *
 * All the offer copy is here, price included, so a change to the terms is an
 * edit to this object and never to layout. Keep the framing exactly as it
 * is: C Stream is offering this; the association does not run it.
 */
export const FOUNDING_OFFER = {
  heading: "Founding-member pricing",
  lead: "C Stream is offering founding-member pricing to the first 10 WWCCA member companies.",
  /** The founding price, set by Cyrus 2026-09-21. The layout renders this
   * string verbatim and renders nothing if it is null. */
  price: "$399 per month, per company — flat, with unlimited users." as string | null,
  /** Onboarding, NOT a free trial: the 60 days are the founders doing the
   * setup and one real billing cycle, which is what makes them free. */
  onboarding: "The first 60 days are free. That is onboarding, not a trial: we load your data and run one real billing cycle with you.",
  terms: [
    // NOT a lifetime lock and NOT "for as long as you stay a customer": the
    // pricing research recommends against promising either and it is not
    // decided. This is the sentence the exact terms replace when they are.
    "Founding members get a lower price than anyone who comes after them, locked in.",
    "Why ten: the first ten get the founders' direct time, and a say in what gets built next.",
  ],
  /**
   * How to ask. There is no contact form and no public address on purpose —
   * /pilot makes the same call — so the route to a person is the one the
   * app already has: sign up, then Help → "Or ask a person", which emails
   * the founders (components/HelpButton.tsx; "within one business day" is
   * that panel's own promise, quoted rather than improved on).
   */
  howToAsk: [
    { title: "Sign up", body: "Your company gets its own private account." },
    { title: "Press Help, then “Or ask a person”", body: "Say you are a WWCCA member. A founder answers within one business day." },
  ],
} as const;
