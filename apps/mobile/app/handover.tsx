import { useCallback, useMemo, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { GroupedList } from "@/components/GroupedList";
import { Icon } from "@/components/Icon";
import { Sheet } from "@/components/Sheet";
import { SignaturePad } from "@/components/SignaturePad";
import { type Palette, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";
import { endHandover, getHandover, pinAccepted, type Handover } from "@/lib/handover";
import { useT } from "@/lib/i18n";
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
  const { t } = useT();
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
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
      <SafeAreaView edges={["top"]} style={styles.header}>
        <Text style={styles.who}>{handover.name}</Text>
        <Text style={styles.where}>
          {handover.jobName} · {today}
        </Text>
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>{t("handover.intro")}</Text>

        <GroupedList>
          <View style={styles.entry}>
            <Field
              label={t("handover.field.hours")}
              value={hours}
              onChangeText={setHours}
              keyboardType="decimal-pad"
              placeholder="8"
            />
            <Field
              label={t("handover.field.note")}
              value={note}
              onChangeText={setNote}
              placeholder={t("handover.field.noteHint")}
            />
            <Button fullWidth disabled={!canAdd} onPress={addHours}>
              {t("handover.add")}
            </Button>
          </View>
        </GroupedList>

        {saved.length > 0 ? (
          <GroupedList>
            <View style={styles.saved}>
              <Text style={styles.savedTitle}>{t("handover.saved.title")}</Text>
              {saved.map((row, index) => (
                <Text key={`${row.at}-${index}`} style={styles.savedRow}>
                  {t("handover.saved.row", { hours: row.hours, name: handover.name })}
                </Text>
              ))}
              <Text style={styles.savedNote}>{t("handover.saved.note")}</Text>
            </View>
          </GroupedList>
        ) : null}

        <Button fullWidth variant="secondary" onPress={() => setShowSign(true)} disabled={saved.length === 0}>
          {t("handover.signFinish")}
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
          {t("handover.handBack")}
        </Button>
      </ScrollView>

      <Sheet
        visible={showSign}
        onClose={() => setShowSign(false)}
        title={t("handover.sign.title", { name: handover.name })}
        primaryLabel={t("handover.signFinish")}
        onPrimary={signAndFinish}
        primaryDisabled={!signaturePath}
      >
        <Text style={styles.signNote}>
          {t("handover.sign.note", { date: today, job: handover.jobName })}
        </Text>
        <SignaturePad onChange={setSignaturePath} />
      </Sheet>

      <Sheet
        visible={showBack}
        onClose={() => setShowBack(false)}
        title={t("handover.handBack")}
        primaryLabel={t("handover.handBack.primary")}
        onPrimary={handBack}
      >
        <Text style={styles.signNote}>
          {handover.pin ? t("handover.back.pinNote") : t("handover.back.note")}
        </Text>
        {handover.pin ? (
          <>
            <Icon name="keypad" size={22} color={palette.colors.inkMuted} />
            <Field
              label={t("handover.pin.label")}
              value={pin}
              onChangeText={(text) => {
                setPin(text);
                setPinWrong(false);
              }}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
              error={pinWrong ? t("handover.pin.wrong") : undefined}
            />
          </>
        ) : null}
      </Sheet>
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.colors.canvas },
    header: {
      backgroundColor: p.colors.rail,
      paddingBottom: space.md,
      paddingHorizontal: space.md,
      gap: 4,
      borderBottomWidth: 1,
      borderBottomColor: p.colors.lineCard,
    },
    who: { color: p.colors.ink, fontSize: typography.size.xl2, fontWeight: typography.weight.bold },
    where: { color: p.colors.inkBody, fontSize: typography.size.sm },
    content: { padding: space.md, gap: space.sm, paddingBottom: space.xxl },
    intro: { color: p.colors.inkBody, fontSize: typography.size.sm, lineHeight: 20 },
    entry: { padding: space.md, gap: space.sm },
    saved: { padding: space.md, gap: space.xxs },
    savedTitle: { color: p.colors.inkLabel, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
    savedRow: { color: p.colors.ink, fontSize: typography.size.md },
    savedNote: { color: p.colors.inkMuted, fontSize: typography.size.xs },
    signNote: { color: p.colors.inkBody, fontSize: typography.size.sm, lineHeight: 20 },
  });
}
