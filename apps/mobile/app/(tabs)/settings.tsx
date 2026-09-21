import { useAuth, useUser } from "@clerk/expo";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/Button";
import { GroupedList } from "@/components/GroupedList";
import { GroupedRow } from "@/components/GroupedRow";
import { Icon } from "@/components/Icon";
import { LargeTitle } from "@/components/LargeTitle";
import { SectionHeader } from "@/components/SectionHeader";
import { clearCurrentJob } from "@/lib/current-job";
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

/** More: the account, the queue, and the one piece of app state worth
 * being able to clear by hand — which job the phone thinks it is on. */
export default function SettingsScreen() {
  const { signOut } = useAuth();
  const { user } = useUser();
  const { job } = useCurrentJob();
  const { me } = useMe();
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
        <LargeTitle>More</LargeTitle>

        <SectionHeader>Account</SectionHeader>
        <GroupedList>
          <GroupedRow
            icon={<Icon name="person" />}
            title={user?.primaryEmailAddress?.emailAddress ?? user?.fullName ?? "—"}
            subtitle={
              me
                ? me.role === "OWNER"
                  ? "Account owner — everything on this phone is yours to see"
                  : me.jobFunction
                    ? `${me.jobFunction.replace(/_/g, " ").toLowerCase()} — the account owner sets what that includes, on the Team page`
                    : "Full access to this company's records"
                : undefined
            }
            chevron={false}
          />
        </GroupedList>

        {/* The outbox. A count on one screen was the whole of it before,
            and a count cannot be acted on — see app/outbox.tsx. */}
        <SectionHeader>Waiting to send</SectionHeader>
        <GroupedList>
          <GroupedRow
            icon={<Icon name="outbox" />}
            title="Waiting to send"
            subtitle={
              waiting === 0 && needsAttention === 0
                ? "Everything has reached the office"
                : [
                    waiting > 0 ? `${waiting} waiting` : null,
                    needsAttention > 0 ? `${needsAttention} need attention` : null,
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
        <SectionHeader>Unsent work reminder</SectionHeader>
        <GroupedList>
          <View style={styles.reminder}>
            <Text style={styles.label}>Remind me about unsent work</Text>
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
                    {formatHour(choice)}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>
              {blocked
                ? "Notifications are off for Prova in iOS Settings, so this cannot show. Everything still waits safely on the phone."
                : "Only if something is still unsent at that time. Nothing is sent to anyone else."}
            </Text>
          </View>
        </GroupedList>

        <SectionHeader>Job</SectionHeader>
        <GroupedList>
          {job ? (
            <GroupedRow
              icon={<Icon name="jobs" />}
              title={`Leave ${job.name}`}
              onPress={() => clearCurrentJob()}
            />
          ) : null}
          <GroupedRow
            icon={<Icon name="logOut" />}
            title="Sign out"
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
    content: { paddingHorizontal: space.md, paddingBottom: 88 },
    label: { color: p.colors.inkMuted, fontSize: typography.size.xs, fontWeight: typography.weight.semibold },
    count: {
      color: p.colors.brandInk,
      backgroundColor: p.colors.brand,
      fontSize: typography.size.xs,
      fontWeight: typography.weight.bold,
      minWidth: 22,
      textAlign: "center",
      borderRadius: radius.pill,
      paddingVertical: 3,
      paddingHorizontal: 6,
      overflow: "hidden",
    },
    reminder: { padding: space.md, gap: space.sm },
    choices: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    choice: {
      borderWidth: 1,
      borderColor: p.colors.lineCard,
      borderRadius: radius.pill,
      paddingVertical: 6,
      paddingHorizontal: 12,
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
