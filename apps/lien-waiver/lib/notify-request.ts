import { addContact, isEmail, sendEmail } from "./email";
import { HOUR, LIMITS, rateKey, underLimit, type RateStore } from "./rate-limit";

/**
 * POST /api/notify -- "tell me when you add tools for my state", from the
 * New Mexico page (which has no statutory form to offer) and from any state
 * still waiting on its attorney review in production.
 *
 * Nothing is emailed to the person: they asked to be told later, not to be
 * sent something now. Diego gets the lead; the person goes into the
 * audience, unsubscribed from marketing unless they ticked the box.
 */

export interface NotifyBody {
  email?: string;
  name?: string;
  company?: string;
  state?: string;
  marketingOptIn?: boolean;
  website?: string;
}

export async function handleNotifyRequest(
  body: NotifyBody,
  deps: {
    env: Record<string, string | undefined>;
    rate: { store: RateStore; salt: string } | null;
    ip: string;
    send?: typeof sendEmail;
    subscribe?: typeof addContact;
  },
): Promise<{ status: number; error?: string }> {
  if (body.website) return { status: 400, error: "That request could not be read." };
  const email = (body.email ?? "").trim();
  const name = (body.name ?? "").trim();
  const state = (body.state ?? "").trim().toUpperCase().slice(0, 2);
  if (!isEmail(email)) return { status: 400, error: "Enter a valid email address." };
  if (!name) return { status: 400, error: "Enter your name." };
  if (!/^[A-Z]{2}$/.test(state)) return { status: 400, error: "That request could not be read." };
  if (!deps.rate) return { status: 503, error: "Sign-ups are paused for a moment. Please try again shortly." };
  if (!(await underLimit(deps.rate.store, rateKey("ip", deps.ip, deps.rate.salt), LIMITS.notifyPerIpPerHour, HOUR))) {
    return { status: 429, error: "Please try again a little later." };
  }
  const send = deps.send ?? sendEmail;
  const subscribe = deps.subscribe ?? addContact;
  await send(
    {
      to: deps.env.LEAD_NOTIFY_EMAIL?.trim() || "diego@cstream.ai",
      subject: `Lien waiver tool: notify request for ${state} from ${name}`,
      text: [
        `Name: ${name}`,
        `Email: ${email}`,
        `Company: ${(body.company ?? "").trim() || "(not given)"}`,
        `State: ${state}`,
        `Marketing email: ${body.marketingOptIn ? "opted in" : "not opted in"}`,
      ].join("\n"),
      replyTo: email,
    },
    deps.env,
  ).catch(() => null);
  await subscribe({ email, name, marketingOptIn: body.marketingOptIn === true }, deps.env).catch(() => null);
  return { status: 200 };
}
