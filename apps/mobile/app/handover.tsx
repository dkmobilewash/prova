import { useCallback, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Field } from "@/components/Field";
import { Sheet } from "@/components/Sheet";
import { SignaturePad } from "@/components/SignaturePad";
import { colors, typography } from "@/lib/theme";
import { endHandover, getHandover, pinAccepted, type Handover } from "@/lib/handover";
import { uuid } from "@/lib/id";
import { localToday } from "@/lib/local-today";
import { enqueue } from "@/lib/sync-queue";

/**
 * The phone while a crew member is holding it.
 *
 * ONE screen, one job, one person, one day. No tabs, no back gesture, no
 * link to anywhere — a crew member borrowing the phone to put their hours
 * in must not land in the foreman's margin, the other crews' time, or the
 * jobs list. The route is registered in app/_layout.tsx with the header
 * and the swipe-back turned off, and the app re-enters this screen on
 * launch while a handover is open (lib/handover.ts), so force-quitting is
 * not a way out of it either.
 *
 * What it produces is deliberately made of models that already exist: a
 * TimeEntry carrying this person's `crewMemberId`, and a TimesheetSignoff
 * they signed. Both go through the same offline queue as everything else,
 * so this works in the basement it was built for — and neither invents a
 * new idea of who did what.
 */
export default function HandoverScreen() {
  const [handover, setHandover] = useState<Handover | null>(null);
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState<{ hours: string; at: string }[]>([]);
  const [showSign, setShowSign] = useState(false);
  const [signaturePath, setSignaturePath] = useState<string | null>(null);
  const [showBack, setShowBack] = useState(false);
  const [pin, setPin] = useState("");
  const [pinWrong, setPinWrong] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const open = await getHandover();
        // Nothing to hand over: this screen has no meaning on its own, and
        // arriving here without one means the foreman already took it back.
        if (!open) router.replace("/(tabs)");
        setHandover(open);
      })();
    }, []),
  );

  if (!handover) return null;

  const today = localToday();
  const canAdd = hours.trim().length > 0 && Number(hours) > 0;

  const addHours = async () => {
    if (!canAdd) return;
    const entered = hours.trim();
    setHours("");
    setNote("");
    await enqueue({
      type: "time:create",
      jobId: handover.jobId,
      clientOperationId: uuid(),
      date: today,
      hours: entered,
      payType: "STRAIGHT",
      note: note.trim() || undefined,
      // WHOSE hours. The signed-in session is the foreman's — this is the
      // only thing that says the time is Ana's, so it is not optional.
      crewMemberId: handover.crewMemberId,
    });
    setSaved((rows) => [...rows, { hours: entered, at: new Date().toISOString() }]);
  };

  const signAndFinish = async () => {
    if (!signaturePath) return;
    await enqueue({
      type: "signoff:create",
      jobId: handover.jobId,
      clientOperationId: uuid(),
      date: today,
      signerName: handover.name,
      signaturePath,
    });
    setShowSign(false);
    await endHandover();
    router.replace("/(tabs)");
  };

  const handBack = async () => {
    if (!pinAccepted(handover, pin)) {
      setPinWrong(true);
      return;
    }
    setShowBack(false);
    await endHandover();
    router.replace("/(tabs)");
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.who}>{handover.name}</Text>
        <Text style={styles.where}>
          {handover.jobName} · {today}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          Put your own hours in. Only you and this job are on this screen — nothing else on the
          phone is open while you have it.
        </Text>

        <Card>
          <Field
            label="Hours worked today"
            value={hours}
            onChangeText={setHours}
            keyboardType="decimal-pad"
            placeholder="8"
          />
          <Field
            label="Anything worth noting (optional)"
            value={note}
            onChangeText={setNote}
            placeholder="Hung rock, level 3"
          />
          <Button fullWidth disabled={!canAdd} onPress={addHours}>
            Add these hours
          </Button>
        </Card>

        {saved.length > 0 ? (
          <Card>
            <Text style={styles.savedTitle}>On this phone, waiting to send</Text>
            {saved.map((row, index) => (
              <Text key={`${row.at}-${index}`} style={styles.savedRow}>
                {row.hours} hours · {handover.name}
              </Text>
            ))}
            <Text style={styles.savedNote}>
              Kept on the phone and sent when there is signal. Nothing is lost if there is none.
            </Text>
          </Card>
        ) : null}

        <Button fullWidth variant="secondary" onPress={() => setShowSign(true)} disabled={saved.length === 0}>
          Sign and finish
        </Button>

        <Button
          fullWidth
          variant="secondary"
          onPress={() => {
            setPin("");
            setPinWrong(false);
            setShowBack(true);
          }}
        >
          Hand the phone back
        </Button>
      </ScrollView>

      <Sheet
        visible={showSign}
        onClose={() => setShowSign(false)}
        title={`${handover.name} — sign for today`}
        primaryLabel="Sign and finish"
        onPrimary={signAndFinish}
        primaryDisabled={!signaturePath}
      >
        <Text style={styles.signNote}>
          Signing says these are your hours for {today} on {handover.jobName}. It goes to the office
          with them.
        </Text>
        <SignaturePad onChange={setSignaturePath} />
      </Sheet>

      <Sheet
        visible={showBack}
        onClose={() => setShowBack(false)}
        title="Hand the phone back"
        primaryLabel="Hand it back"
        onPrimary={handBack}
      >
        <Text style={styles.signNote}>
          {handover.pin
            ? "The foreman set a PIN when they handed it over. Give the phone back to them to type it."
            : "This ends your turn on the phone. Anything you have put in is kept and sent either way."}
        </Text>
        {handover.pin ? (
          <Field
            label="Foreman's PIN"
            value={pin}
            onChangeText={(text) => {
              setPin(text);
              setPinWrong(false);
            }}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={4}
            error={pinWrong ? "That is not the PIN this phone was handed over with." : undefined}
          />
        ) : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  header: {
    backgroundColor: colors.rail,
    paddingTop: 64,
    paddingBottom: 16,
    paddingHorizontal: 16,
    gap: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineCard,
  },
  who: { color: colors.ink, fontSize: typography.size.xxl, fontWeight: typography.weight.bold },
  where: { color: colors.inkBody, fontSize: typography.size.sm },
  content: { padding: 16, gap: 12 },
  intro: { color: colors.inkBody, fontSize: typography.size.sm, lineHeight: 20 },
  savedTitle: { color: colors.inkLabel, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
  savedRow: { color: colors.ink, fontSize: typography.size.md },
  savedNote: { color: colors.inkMuted, fontSize: typography.size.xs },
  signNote: { color: colors.inkBody, fontSize: typography.size.sm, lineHeight: 20 },
});
