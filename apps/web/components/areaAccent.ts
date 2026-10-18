/** One colour per area, so a heading and its pages read as one block and the
 * six blocks are told apart at a glance. Literal class strings (Tailwind
 * cannot see built ones). The bar-* tokens are the same hex in both themes and
 * are used only on icons, rules and tints — never as text colour — so the
 * contrast census has nothing new to judge. Account/Internal stay neutral. */
const AREA_ACCENT: Record<string, { icon: string; rule: string; tint: string; dot: string }> = {
  "Jobs & bids": { icon: "text-bar-blue", rule: "border-bar-blue/50", tint: "bg-bar-blue/15", dot: "bg-bar-blue" },
  Money: { icon: "text-bar-green", rule: "border-bar-green/50", tint: "bg-bar-green/15", dot: "bg-bar-green" },
  "Crew & field": { icon: "text-bar-amber", rule: "border-bar-amber/50", tint: "bg-bar-amber/15", dot: "bg-bar-amber" },
  Paperwork: { icon: "text-bar-violet", rule: "border-bar-violet/50", tint: "bg-bar-violet/15", dot: "bg-bar-violet" },
  "Compliance & safety": { icon: "text-bar-rose", rule: "border-bar-rose/50", tint: "bg-bar-rose/15", dot: "bg-bar-rose" },
  "Materials & equipment": { icon: "text-bar-teal", rule: "border-bar-teal/50", tint: "bg-bar-teal/15", dot: "bg-bar-teal" },
};
const NEUTRAL_ACCENT = { icon: "text-ink-muted", rule: "border-line-card", tint: "bg-rail-hover", dot: "bg-ink-muted" };
export const accentFor = (heading: string) => AREA_ACCENT[heading] ?? NEUTRAL_ACCENT;

