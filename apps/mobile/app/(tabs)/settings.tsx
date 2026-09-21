import { useAuth, useUser } from "@clerk/expo";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { CurrentJobBar } from "@/components/CurrentJobBar";
import { colors, typography } from "@/lib/theme";
import { clearCurrentJob } from "@/lib/current-job";
import { Icon } from "@/components/Icon";
import { pendingCount, listRefused } from "@/lib/sync-queue";
import {
  ensureReminderPermission,
  formatHour,
  reconcileReminder,
  reminderHour,
  REMINDER_CHOICES,
  setReminderHour,
} from "@/lib/unsent-reminder";
import { useCurrentJob } from "@/lib/use-current-job";
import { useMe } from "@/lib/use-me";

/** The account, and the one piece of app state worth being able to clear
 * by hand: which job the phone thinks it is on. */
export default function SettingsScreen() {
  const { signOut } = useAuth();
  const { user } = useUser();
  const { job } = useCurrentJob();
  const { me } = useMe();
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
    <View style={styles.screen}>
      <CurrentJobBar job={job} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.panel}>
          <Text style={styles.label}>Signed in as</Text>
          <Text style={styles.value}>
            {user?.primaryEmailAddress?.emailAddress ?? user?.fullName ?? "—"}
          </Text>
          {/* What this phone will and will not show you, said once, here —
              so a missing tab is answerable without asking the office. */}
          {me ? (
            <Text style={styles.label}>
              {me.role === "OWNER"
                ? "Account owner — everything on this phone is yours to see"
                : me.jobFunction
                  ? `${me.jobFunction.replace(/_/g, " ").toLowerCase()} — the account owner sets what that includes, on the Team page`
                  : "Full access to this company's records"}
            </Text>
          ) : null}
        </View>

        {/* The outbox. A count on one screen was the whole of it before,
            and a count cannot be acted on — see app/outbox.tsx. */}
        <Pressable style={styles.rowLink} onPress={() => router.push("/outbox")}>
          <View style={styles.rowText}>
            <Text style={styles.value}>Waiting to send</Text>
            <Text style={styles.label}>
              {waiting === 0 && needsAttention === 0
                ? "Everything has reached the office"
                : [
                    waiting > 0 ? `${waiting} waiting` : null,
                    needsAttention > 0 ? `${needsAttention} need attention` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </Text>
          </View>
          {waiting + needsAttention > 0 ? <Text style={styles.count}>{waiting + needsAttention}</Text> : null}
          <Icon name="chevron" size={18} />
        </Pressable>

        {/* The end-of-day reminder. Local to this phone — it has to work
            on the day it matters, which is the day there was no signal. */}
        <View style={styles.panel}>
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
                <Text style={hour === choice ? styles.choiceOnText : styles.choiceText}>{formatHour(choice)}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.label}>
            {blocked
              ? "Notifications are off for Prova in iOS Settings, so this cannot show. Everything still waits safely on the phone."
              : "Only if something is still unsent at that time. Nothing is sent to anyone else."}
          </Text>
        </View>

        {job ? (
          <Button variant="secondary" onPress={() => clearCurrentJob()}>
            Leave {job.name}
          </Button>
        ) : null}

        <Button variant="secondary" onPress={() => signOut()}>
          Sign out
        </Button>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 16, gap: 16 },
  panel: {
    borderWidth: 1,
    borderColor: colors.lineCard,
    borderRadius: 12,
    backgroundColor: colors.surface,
    padding: 16,
    gap: 4,
  },
  label: { color: colors.inkMuted, fontSize: typography.size.xs, fontWeight: typography.weight.semibold },
  value: { color: colors.ink, fontSize: typography.size.md },
  rowLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: colors.lineCard,
    borderRadius: 12,
    backgroundColor: colors.surface,
    padding: 16,
  },
  rowText: { flex: 1, gap: 4 },
  count: {
    color: colors.canvas,
    backgroundColor: colors.brand,
    fontSize: typography.size.xs,
    fontWeight: typography.weight.bold,
    minWidth: 22,
    textAlign: "center",
    borderRadius: 11,
    paddingVertical: 3,
    paddingHorizontal: 6,
    overflow: "hidden",
  },
  choices: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  choice: {
    borderWidth: 1,
    borderColor: colors.lineCard,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  choiceOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  choiceText: { color: colors.inkBody, fontSize: typography.size.sm },
  choiceOnText: { color: colors.canvas, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
});
