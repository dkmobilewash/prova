"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { isEmail } from "@/lib/email";

/**
 * The frame of every step-by-step tool here (Diego, 2026-10-13: one section
 * per screen, Next and Back): the sticky header and progress bar, the
 * screen's heading, and the Back / Next bar pinned to the bottom of a phone.
 * The lien waiver (WaiverTool) and the change order request
 * (ChangeOrderTool) both render inside it, so the two cannot drift on
 * touch sizes, focus or the progress bar.
 *
 * Next is a submit button for the form whose id is `formId`, so Enter on a
 * phone keyboard is Next too. The tool decides what Next does.
 */
export function StepShell({
  toolName,
  formId,
  index,
  total,
  done,
  title,
  notice,
  onBack,
  busy,
  nextLabel,
  children,
}: {
  /** Shown small in the header, e.g. "Arizona lien waiver". */
  toolName: string;
  formId: string;
  /** The screen shown, from 0. */
  index: number;
  total: number;
  done: boolean;
  title: string;
  /** Shown above every screen. */
  notice?: ReactNode;
  /** Null hides Back (the first screen, and once sent). */
  onBack: (() => void) | null;
  busy: boolean;
  nextLabel: string;
  children: ReactNode;
}) {
  // Move focus to the new screen's heading, so a screen reader announces it
  // and the keyboard starts at the top. Not on first load: that would steal
  // focus from whatever the person was reaching for.
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    heading.current?.focus();
  }, [index, done]);

  const shown = done ? total : index + 1;
  return (
    <>
      <div className="sticky top-0 z-10 border-b border-rule bg-paper">
        <div className="mx-auto flex min-h-touch max-w-2xl items-center justify-between gap-4 px-4 py-2">
          <Link href="/" className="inline-flex min-h-touch items-center font-bold text-ink">
            C-Stream
          </Link>
          <h1 className="text-sm font-semibold text-quiet">{toolName}</h1>
        </div>
        <div
          role="progressbar"
          aria-label="Progress"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={Math.min(shown, total)}
          aria-valuetext={done ? "Sent" : `Step ${shown} of ${total}`}
          className="h-1.5 bg-rule"
        >
          <div className="h-full bg-progress transition-[width] duration-300" style={{ width: `${(Math.min(shown, total) / total) * 100}%` }} />
        </div>
      </div>

      <main className="mx-auto max-w-2xl px-4 pb-36 pt-6">
        {notice}
        {!done ? (
          <p className="mt-2 text-sm font-semibold text-quiet">
            Step {shown} of {total}
          </p>
        ) : null}
        <h2 ref={heading} tabIndex={-1} className="mt-1 text-3xl font-bold leading-tight text-ink focus:outline-none">
          {title}
        </h2>
        {children}
      </main>

      <nav aria-label="Steps" className="fixed inset-x-0 bottom-0 z-10 border-t border-rule bg-paper">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          {!done && onBack ? (
            <button type="button" onClick={onBack} disabled={busy} className="inline-flex min-h-primary items-center gap-1 rounded-lg px-3 text-lg font-semibold text-ink hover:bg-canvas">
              <span aria-hidden="true">‹</span> Back
            </button>
          ) : (
            <span />
          )}
          {done ? null : (
            <button type="submit" form={formId} disabled={busy} aria-busy={busy} className={PRIMARY}>
              {nextLabel}
            </button>
          )}
        </div>
      </nav>
    </>
  );
}

/**
 * The last screen of every tool: who the PDF is for and where it goes.
 * There is no download -- the server emails the PDF and never returns it
 * (lib/waiver-request.ts) -- so the address has to be one the person can
 * open on the job. The honeypot is hidden from people and screen readers.
 */
export function SendFields({
  tried,
  returning,
  name,
  setName,
  email,
  setEmail,
  company,
  setCompany,
  marketing,
  setMarketing,
  website,
  setWebsite,
  sendError,
  readFirst,
}: {
  tried: boolean;
  /** This browser has sent before with this address: no marketing box. */
  returning: boolean;
  name: string;
  setName: (value: string) => void;
  email: string;
  setEmail: (value: string) => void;
  company: string;
  setCompany: (value: string) => void;
  marketing: boolean;
  setMarketing: (value: boolean) => void;
  website: string;
  setWebsite: (value: string) => void;
  sendError: string | null;
  /** The tool's own "read it first" sentence. */
  readFirst: string;
}) {
  return (
    <>
      <p className="text-quiet">We email your PDF. There is no download, so use an address you can open on the job.</p>
      <Card htmlFor="send-name" label="Your name" error={tried && !name.trim() ? "Enter your name." : undefined} errorId="send-name-error">
        <input id="send-name" type="text" name="name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} aria-invalid={tried && !name.trim()} aria-describedby={tried && !name.trim() ? "send-name-error" : undefined} className={INPUT} placeholder="First and last name" />
      </Card>
      <Card htmlFor="send-email" label="Email" error={tried && !isEmail(email) ? "Enter a valid email address." : undefined} errorId="send-email-error">
        <input id="send-email" type="email" inputMode="email" name="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} aria-invalid={tried && !isEmail(email)} aria-describedby={tried && !isEmail(email) ? "send-email-error" : undefined} className={INPUT} placeholder="you@company.com" />
      </Card>
      <Card htmlFor="send-company" label="Company" optional>
        <input id="send-company" type="text" name="company" autoComplete="organization" value={company} onChange={(event) => setCompany(event.target.value)} className={INPUT} />
      </Card>
      {returning ? null : (
        <label className="flex min-h-touch items-start gap-4 rounded-xl bg-paper p-5 text-ink ring-1 ring-rule">
          <input type="checkbox" className="mt-0.5 h-6 w-6 shrink-0 accent-ink" checked={marketing} onChange={(event) => setMarketing(event.target.checked)} />
          <span>
            Send me occasional emails from C-Stream about running a subcontracting business.{" "}
            <span className="text-quiet">(Optional. You get your PDF either way.)</span>
          </span>
        </label>
      )}
      {/* Honeypot: hidden from people and from screen readers. */}
      <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="send-website">Website</label>
        <input id="send-website" type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} />
      </div>
      <p className="text-sm text-quiet">
        {readFirst} C-Stream is not a law firm and this is not legal advice. See our{" "}
        <Link className="underline" href="/privacy">
          privacy notice
        </Link>
        .
      </p>
      {sendError ? (
        <p role="alert" className="rounded-md bg-warn-ground p-3 font-semibold text-danger">
          {sendError}
        </p>
      ) : null}
    </>
  );
}

export const INPUT =
  "min-h-touch w-full bg-transparent py-2 text-lg text-ink placeholder:text-quiet/70 focus:outline-none focus-visible:outline-none";
export const PRIMARY =
  "min-h-primary rounded-lg bg-ink px-8 text-lg font-bold text-paper hover:bg-quiet disabled:cursor-not-allowed disabled:opacity-60";

/** One question: its label on top, a rule, then the answer -- the shape of
 * every screen. The whole card shows focus, since the input itself has no
 * border of its own. */
export function Card({
  htmlFor,
  label,
  optional,
  help,
  helpId,
  error,
  errorId,
  children,
}: {
  htmlFor: string;
  label: string;
  optional?: boolean;
  help?: string;
  helpId?: string;
  error?: string;
  errorId?: string;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-xl bg-paper focus-within:ring-2 focus-within:ring-focus ${error ? "ring-2 ring-danger" : "ring-1 ring-rule"}`}>
      <div className="px-5 pb-4 pt-5">
        <label htmlFor={htmlFor} className="block text-lg font-semibold text-ink">
          {label}
          {optional ? <span className="font-normal text-quiet"> (optional)</span> : null}
        </label>
        {help ? (
          <p id={helpId} className="mt-1 text-sm text-quiet">
            {help}
          </p>
        ) : null}
      </div>
      <div className="border-t border-rule px-5 py-2">{children}</div>
      {error ? (
        <p id={errorId} className="px-5 pb-4 text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
