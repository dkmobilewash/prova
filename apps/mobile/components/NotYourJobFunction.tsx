import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useT, type StringKey } from "@/lib/i18n";
import { type Palette, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

/**
 * What a screen says when this person's job function does not include it.
 *
 * One component, because the alternative is eight screens each inventing
 * a way to be empty — and because the sentence matters: a phone that
 * silently shows nothing reads as broken, and a person who does not know
 * WHY cannot ask for the right thing. It names the capability in the
 * product's own words and says who can change it, which is the same
 * wording the server sends with its 403 and the web uses on a withheld
 * section.
 *
 * `what` is a `StringKey`, not a noun: it comes from `SCREEN_NOUN` and is
 * translated HERE, inside the component that re-renders when the language
 * changes, rather than in the pure table it lives in.
 */
export function NotYourJobFunction({ what }: { what: StringKey }) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const { t } = useT();
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{t("notYourJob.title", { what: t(what) })}</Text>
      <Text style={styles.body}>{t("notYourJob.body")}</Text>
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    wrap: { padding: space.xl, gap: space.xs },
    title: { color: p.colors.ink, fontSize: typography.size.lg, fontWeight: typography.weight.semibold },
    body: { color: p.colors.inkBody, fontSize: typography.size.sm, lineHeight: 22 },
  });
}
