import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useT } from "@/lib/i18n";
import { hitTarget, radius, space, typography, type Palette } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

const MARK = require("../assets/cstream-mark.webp");

/**
 * THE BRAND LOCKUP AT THE TOP OF EVERY TAB, from the reference design: the
 * mark, a tracked `C STREAM` overline, and the screen's name underneath at
 * 30pt with tight tracking.
 *
 * WHAT THE REFERENCE HAS THAT THIS DELIBERATELY DOES NOT: a bell. Its
 * header carries a notification bell AND an avatar, but that mock has the
 * same five tabs we do — so the bell is a second door to the Alerts tab,
 * which already sits one thumb-reach away carrying its own unread badge.
 * Two controls for one destination is chrome, not navigation, and it costs
 * a 48pt target in the row where titles live. The avatar stays because
 * Settings is where you go to STOP working, and a face is a faster read
 * for "this is my account" than a gear.
 *
 * The overline is 13pt, not the reference's 10: nothing on this phone goes
 * below 13 (DESIGN.md, "Type"), so the hierarchy is carried by weight and
 * letter-spacing instead of by size.
 */
export function AppHeader({
  title,
  initials,
  onPressAvatar,
}: {
  title: string;
  /** Omitted renders no avatar — a screen with nowhere to send it. */
  initials?: string;
  onPressAvatar?: () => void;
}) {
  const p = usePalette();
  const { t } = useT();
  const s = makeStyles(p);

  return (
    <View style={s.bar}>
      <View style={s.lockup}>
        <Image source={MARK} style={s.mark} resizeMode="contain" accessibilityIgnoresInvertColors />
        <View style={s.words}>
          <Text style={s.overline} accessibilityElementsHidden>
            {t("brand.wordmark")}
          </Text>
          <Text style={s.title} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
        </View>
      </View>
      {initials ? (
        <Pressable
          onPress={onPressAvatar}
          accessibilityRole="button"
          accessibilityLabel={t("header.avatar.a11y")}
          style={({ pressed }) => [s.avatar, pressed && s.avatarPressed]}
        >
          <Text style={s.avatarInk}>{initials}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    bar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: space.sm,
      paddingBottom: space.sm,
    },
    lockup: { flexDirection: "row", alignItems: "center", gap: space.xs, flex: 1, minWidth: 0 },
    mark: { width: 30, height: 30 },
    words: { flex: 1, minWidth: 0 },
    overline: {
      color: p.colors.inkBody,
      fontSize: typography.size.xs,
      fontWeight: "800",
      letterSpacing: 1.6,
    },
    title: {
      color: p.colors.ink,
      fontSize: typography.size.xxl,
      fontWeight: "700",
      letterSpacing: -1,
    },
    avatar: {
      width: hitTarget,
      height: hitTarget,
      borderRadius: radius.pill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: p.colors.ink,
    },
    avatarPressed: { opacity: 0.8 },
    avatarInk: {
      color: p.colors.surface,
      fontSize: typography.size.xs,
      fontWeight: "800",
    },
  });
}
