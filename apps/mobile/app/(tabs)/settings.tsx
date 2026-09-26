import { useAuth, useUser } from "@clerk/expo";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { GroupedList } from "@/components/GroupedList";
import { GroupedRow } from "@/components/GroupedRow";
import { Icon } from "@/components/Icon";
import { LargeTitle } from "@/components/LargeTitle";
import { SectionHeader } from "@/components/SectionHeader";
import { clearCurrentJob } from "@/lib/current-job";
import { APPEARANCE_CHOICES, setAppearance, useAppearance, type Appearance } from "@/lib/appearance";
import { type LanguageChoice, setLanguage, type StringKey, useT } from "@/lib/i18n";
import { pendingCount, listRefused } from "@/lib/sync-queue";
import {
  ensureReminderPermission,
  formatHour,
  reconcileReminder,
  reminderHour,
  REMINDER_CHOICES,
  setReminderHour,
} from "@/lib/unsent-reminder";
import { type Palette, radius, space, typography } from "@/lib/theme";
import { useCurrentJob } from "@/lib/use-current-job";
import { useMe } from "@/lib/use-me";
import { usePalette } from "@/lib/use-palette";

/** Written out rather than built as `settings.appearance.${pick}`, and the
 * reason is a census rather than taste: strings-census.test.ts reads the
 * keys the app asks for out of the SOURCE, so a key assembled at runtime
 * is a key it cannot see — it reported all four of these as "written,
 * documented and never called". A template literal defeats the type
 * checker the same way. */
const APPEARANCE_LABEL: Record<Appearance, StringKey> = {
  system: "settings.appearance.system",
  light: "settings.appearance.light",
  dark: "settings.appearance.dark",
  outdoor: "settings.appearance.outdoor",
};

/** More: the account, the queue, and the one piece of app state worth
 * being able to clear by hand — which job the phone thinks it is on. */
export default function SettingsScreen() {
  const appearance = useAppearance();
  const { signOut } = useAuth();
  const { user } = useUser();
  const { job } = useCurrentJob();
  const { me } = useMe();
  const { t, choice } = useT();
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [waiting, setWaiting] = useState(0);
  const [needsAttention, setNeedsAttention] = useState(0);
  const [hour, setHour] = useState<number | null>(null);
  const [blocked, setBlocked] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        setWaiting(await pendingCount());
        setNeedsAttention((await listRefused()).length);
        setHour(await reminderHour());
      })();
    }, []),
  );

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <LargeTitle>{t("settings.title")}</LargeTitle>

        <SectionHeader>{t("settings.account")}</SectionHeader>
        <GroupedList>
          <GroupedRow
            icon={<Icon name="person" />}
            title={user?.primaryEmailAddress?.emailAddress ?? user?.fullName ?? "—"}
            subtitle={
              me
                ? me.role === "OWNER"
                  ? t("settings.account.owner")
                  : me.jobFunction
                    ? t("settings.account.role", {
                        role: me.jobFunction.replace(/_/g, " ").toLowerCase(),
                      })
                    : t("settings.account.full")
                : undefined
            }
            chevron={false}
          />
        </GroupedList>

        {/* The outbox. A count on one screen was the whole of it before,
            and a count cannot be acted on — see app/outbox.tsx. */}
        <SectionHeader>{t("nav.outbox")}</SectionHeader>
        <GroupedList>
          <GroupedRow
            icon={<Icon name="outbox" />}
            title={t("nav.outbox")}
            subtitle={
              waiting === 0 && needsAttention === 0
                ? t("settings.outbox.clear")
                : [
                    waiting > 0 ? t("settings.outbox.waiting", { count: waiting }) : null,
                    needsAttention > 0
                      ? t("settings.outbox.attention", { count: needsAttention })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
            }
            trailing={
              waiting + needsAttention > 0 ? (
                <Text style={styles.count}>{waiting + needsAttention}</Text>
              ) : undefined
            }
            onPress={() => router.push("/outbox")}
          />
        </GroupedList>

        {/* The end-of-day reminder. Local to this phone — it has to work
            on the day it matters, which is the day there was no signal. */}
        <SectionHeader>{t("settings.reminder")}</SectionHeader>
        <GroupedList>
          <View style={styles.reminder}>
            <Text style={styles.label}>{t("settings.reminder.label")}</Text>
            <View style={styles.choices}>
              {REMINDER_CHOICES.map((choice) => (
                <Pressable
                  key={String(choice)}
                  onPress={async () => {
                    // Permission is asked for HERE, where the person has
                    // just said they want it — not silently at sign-in,
                    // where a decline makes this whole row a lie.
                    const allowed = choice === null || (await ensureReminderPermission());
                    setBlocked(choice !== null && !allowed);
                    await setReminderHour(choice);
                    setHour(choice);
                    await reconcileReminder(await pendingCount());
                  }}
                  style={[styles.choice, hour === choice && styles.choiceOn]}
                >
                  <Text style={hour === choice ? styles.choiceOnText : styles.choiceText}>
                    {/* The hours are digits and read the same either way;
                        only "Off" is a word, so only "Off" is a key. */}
                    {choice === null ? t("settings.reminder.off") : formatHour(choice)}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>
              {blocked ? t("settings.reminder.blocked") : t("settings.reminder.note")}
            </Text>
          </View>
        </GroupedList>

        {/* How the screen is lit. `outdoor` is the one people will come
            looking for — a near-black-on-white palette at 7:1 and up, for
            a phone held in direct sun — and it is deliberately a choice
            rather than something sensed: see lib/appearance.ts. */}
        <SectionHeader>{t("settings.appearance")}</SectionHeader>
        <GroupedList>
          <View style={styles.reminder}>
            <View style={styles.choices}>
              {APPEARANCE_CHOICES.map((pick: Appearance) => (
                <Pressable
                  key={pick}
                  accessibilityRole="button"
                  accessibilityState={{ selected: appearance === pick }}
                  onPress={() => {
                    void setAppearance(pick);
                  }}
                  style={[styles.choice, appearance === pick && styles.choiceOn]}
                >
                  <Text style={appearance === pick ? styles.choiceOnText : styles.choiceText}>
                    {t(APPEARANCE_LABEL[pick])}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>{t("settings.appearance.note")}</Text>
          </View>
        </GroupedList>

        {/* The language. Last of the settings and first in importance for
            the person this exists for — and the reason this whole screen
            is translated rather than left in English: finding "Idioma"
            on an English screen is the problem, not the fix.

            The two language names are NEVER translated. "Español" reads
            as Español in an English app, which is how every OS does it:
            somebody who cannot read the current language still has to be
            able to find their own. */}
        <SectionHeader>{t("settings.language")}</SectionHeader>
        <GroupedList>
          <View style={styles.reminder}>
            <View style={styles.choices}>
              {(["auto", "en", "es"] as const).map((pick: LanguageChoice) => (
                <Pressable
                  key={pick}
                  accessibilityRole="button"
                  accessibilityState={{ selected: choice === pick }}
                  onPress={() => {
                    void setLanguage(pick);
                  }}
                  style={[styles.choice, choice === pick && styles.choiceOn]}
                >
                  <Text style={choice === pick ? styles.choiceOnText : styles.choiceText}>
                    {pick === "auto"
                      ? t("settings.language.auto")
                      : pick === "en"
                        ? "English"
                        : "Español"}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>{t("settings.language.note")}</Text>
          </View>
        </GroupedList>

        <SectionHeader>{t("settings.job")}</SectionHeader>
        <GroupedList>
          {job ? (
            <GroupedRow
              icon={<Icon name="jobs" />}
              title={t("settings.leave", { job: job.name })}
              onPress={() => clearCurrentJob()}
            />
          ) : null}
          <GroupedRow
            icon={<Icon name="logOut" />}
            title={t("settings.signOut")}
            divider={!!job}
            onPress={() => signOut()}
          />
        </GroupedList>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.colors.canvas },
    content: { paddingHorizontal: space.md, paddingBottom: space.scrollBottom },
    label: { color: p.colors.inkMuted, fontSize: typography.size.xs, fontWeight: typography.weight.semibold },
    count: {
      color: p.colors.brandInk,
      backgroundColor: p.colors.brand,
      fontSize: typography.size.xs,
      fontWeight: typography.weight.bold,
      minWidth: 22,
      textAlign: "center",
      borderRadius: radius.pill,
      paddingVertical: space.badge,
      paddingHorizontal: space.six,
      overflow: "hidden",
    },
    reminder: { padding: space.md, gap: space.sm },
    choices: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    choice: {
      borderWidth: 1,
      borderColor: p.colors.lineCard,
      borderRadius: radius.pill,
      paddingVertical: space.six,
      paddingHorizontal: space.sm,
    },
    choiceOn: { backgroundColor: p.colors.brand, borderColor: p.colors.brand },
    choiceText: { color: p.colors.inkBody, fontSize: typography.size.sm },
    choiceOnText: {
      color: p.colors.brandInk,
      fontSize: typography.size.sm,
      fontWeight: typography.weight.semibold,
    },
  });
}
