import { useAuth } from "@clerk/expo";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Chip } from "@/components/Chip";
import { Field } from "@/components/Field";
import { List } from "@/components/List";
import { Sheet } from "@/components/Sheet";
import { colors, typography } from "@/lib/theme";
import * as api from "@/lib/api";
import {
  clearSession,
  dayFromClockIn,
  getOpenSession,
  hoursFromClockInterval,
  saveSession,
  type OpenClockSession,
} from "@/lib/clock-session";
import { uuid } from "@/lib/id";
import { enqueue } from "@/lib/sync-queue";
import { useSync } from "@/lib/use-sync";
import type { Craft, CrewMember, LineItem, TimeEntry, TimeEntryPayType } from "@/lib/types";

const PAY_TYPES: TimeEntryPayType[] = ["STRAIGHT", "OVERTIME", "DOUBLE_TIME", "SHIFT_DIFFERENTIAL"];

function formatElapsed(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

export default function TimeScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { getToken } = useAuth();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [crafts, setCrafts] = useState<Craft[]>([]);
  // Job names by id, so the clock card can name the job a session is on —
  // which may not be the job this screen is showing.
  const [jobNames, setJobNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  // Clock state. `sessionLoaded` holds the card back until the saved session
  // has been read — until then a running clock would render as "Not on the
  // clock", and Clock in would overwrite its start time.
  const [openSession, setOpenSession] = useState<OpenClockSession | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [clockError, setClockError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [showClockIn, setShowClockIn] = useState(false);
  const [showSwitch, setShowSwitch] = useState(false);
  const [clockCraftId, setClockCraftId] = useState<string | null>(null);
  const [clockLineItemId, setClockLineItemId] = useState<string | null>(null);

  // Manual "Log time" form state (backfill — no clock capture).
  const [showForm, setShowForm] = useState(false);
  const [date, setDate] = useState("");
  const [hours, setHours] = useState("");
  const [payType, setPayType] = useState<TimeEntryPayType>("STRAIGHT");
  const [note, setNote] = useState("");
  const [crewMemberId, setCrewMemberId] = useState<string | null>(null);
  const [lineItemId, setLineItemId] = useState<string | null>(null);
  const [craftClassificationId, setCraftClassificationId] = useState<string | null>(null);

  const load = async () => {
    const token = await getToken();
    if (!token || !jobId) return;
    try {
      const [es, cs, ls, cts, js] = await Promise.all([
        api.listTimeEntries(jobId, token),
        api.listCrew(token),
        api.listLineItems(jobId, token),
        api.listCrafts(token),
        api.listJobs(token),
      ]);
      setEntries(es);
      setCrew(cs);
      setLineItems(ls);
      setCrafts(cts);
      setJobNames(Object.fromEntries(js.map((j) => [j.id, j.name])));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load time");
    }
  };

  // The saved session is local, so read it straight away rather than after
  // the network load.
  useEffect(() => {
    (async () => {
      setOpenSession(await getOpenSession());
      setSessionLoaded(true);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // Tick the elapsed clock once a minute.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const { pending, sync } = useSync(load);

  /** Close the running interval: compute the worked duration (phone computes
   * DURATION only — pay type is entered, never derived) and enqueue the
   * TimeEntry with the captured clock evidence. */
  const closeInterval = async (endedAtISO: string): Promise<boolean> => {
    if (!openSession) return false;
    const computedHours = hoursFromClockInterval(
      openSession.clockStartedAt,
      endedAtISO,
      openSession.breakMinutes,
    );
    // Nothing left to record once the break is subtracted. A "0" entry would
    // be rejected by the server and block the offline queue, so refuse and
    // SAY SO — the caller keeps the session open so the break can be fixed.
    if (Number(computedHours) <= 0) {
      setClockError(
        `Nothing to record: the ${openSession.breakMinutes}-minute break is as long as the time on the clock. Lower the break first.`,
      );
      return false;
    }
    setClockError(null);
    await enqueue({
      type: "time:create",
      jobId: openSession.jobId,
      clientOperationId: uuid(),
      date: dayFromClockIn(openSession.clockStartedAt),
      hours: computedHours,
      payType: "STRAIGHT",
      lineItemId: openSession.lineItemId || undefined,
      craftClassificationId: openSession.craftClassificationId || undefined,
      clockStartedAt: openSession.clockStartedAt,
      clockEndedAt: endedAtISO,
      clockBreakMinutes: openSession.breakMinutes || undefined,
    });
    await sync();
    return true;
  };

  const onClockIn = async () => {
    if (!jobId) return;
    // Never overwrite a running clock: its start time is the evidence.
    const existing = await getOpenSession();
    if (existing) {
      setOpenSession(existing);
      setShowClockIn(false);
      setClockError("You're already on the clock. Clock out or switch instead.");
      return;
    }
    setClockError(null);
    const session: OpenClockSession = {
      clockStartedAt: new Date().toISOString(),
      jobId,
      lineItemId: clockLineItemId,
      craftClassificationId: clockCraftId,
      breakMinutes: 0,
    };
    await saveSession(session);
    setOpenSession(session);
    setShowClockIn(false);
  };

  /** Adjust the unpaid break by `delta` minutes, never below zero and never
   * past the time actually on the clock. */
  const onBreak = async (delta: number) => {
    if (!openSession) return;
    const onClockMinutes = Math.floor(
      (Date.now() - new Date(openSession.clockStartedAt).getTime()) / 60000,
    );
    const breakMinutes = Math.min(Math.max(0, openSession.breakMinutes + delta), onClockMinutes);
    const updated = { ...openSession, breakMinutes };
    await saveSession(updated);
    setOpenSession(updated);
    setClockError(null);
  };

  const onSwitch = async () => {
    if (!jobId || !openSession) return;
    const closed = await closeInterval(new Date().toISOString());
    if (!closed) {
      setShowSwitch(false);
      return;
    }
    const session: OpenClockSession = {
      clockStartedAt: new Date().toISOString(),
      jobId,
      lineItemId: clockLineItemId,
      craftClassificationId: clockCraftId,
      breakMinutes: 0,
    };
    await saveSession(session);
    setOpenSession(session);
    setShowSwitch(false);
  };

  const onClockOut = async () => {
    const closed = await closeInterval(new Date().toISOString());
    if (!closed) return;
    await clearSession();
    setOpenSession(null);
  };

  const openClockIn = () => {
    setClockCraftId(null);
    setClockLineItemId(null);
    setShowClockIn(true);
  };

  const openSwitch = () => {
    if (!openSession) return;
    setClockCraftId(openSession.craftClassificationId);
    // A cost code belongs to one job. Switching onto THIS job from another
    // must not carry the other job's cost code over — the server would
    // refuse it and the offline queue would stall behind the refusal.
    setClockLineItemId(openSession.jobId === jobId ? openSession.lineItemId : null);
    setShowSwitch(true);
  };

  const submit = async () => {
    if (!jobId || !date || !hours) return;
    setDate("");
    setHours("");
    setNote("");
    setShowForm(false);
    await enqueue({
      type: "time:create",
      jobId,
      clientOperationId: uuid(),
      date,
      hours,
      payType,
      note: note || undefined,
      crewMemberId: crewMemberId || undefined,
      lineItemId: lineItemId || undefined,
      craftClassificationId: craftClassificationId || undefined,
    });
    await sync();
  };

  const elapsedMs = openSession ? now.getTime() - new Date(openSession.clockStartedAt).getTime() : 0;
  const clockCraftLabel = openSession?.craftClassificationId
    ? crafts.find((c) => c.id === openSession.craftClassificationId)?.name ?? null
    : null;
  const clockLineItemLabel = openSession?.lineItemId
    ? lineItems.find((l) => l.id === openSession.lineItemId)?.description ?? null
    : null;
  // The session is on a different job from the one this screen shows.
  const onOtherJob = openSession != null && openSession.jobId !== jobId;
  const sessionJobName = openSession ? jobNames[openSession.jobId] : undefined;
  const switchLabel = onOtherJob ? "Switch to this job" : "Switch";

  return (
    <View style={styles.screen}>
      {pending > 0 ? <Text style={styles.pending}>Pending sync: {pending}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* Clock card */}
      <View style={styles.clockCard}>
        {!sessionLoaded ? (
          <Card>
            <Text style={styles.clockIdle}>Checking the clock…</Text>
          </Card>
        ) : openSession ? (
          <Card>
            <Text style={styles.clockElapsed}>On the clock · {formatElapsed(elapsedMs)}</Text>
            {onOtherJob ? (
              <Text style={styles.clockOtherJob}>Clocked in on {sessionJobName ?? "another job"}</Text>
            ) : sessionJobName ? (
              <Text style={styles.clockJob}>{sessionJobName}</Text>
            ) : null}
            {clockCraftLabel || clockLineItemLabel ? (
              <Text style={styles.clockContext}>
                {[clockCraftLabel, clockLineItemLabel].filter(Boolean).join(" · ")}
              </Text>
            ) : null}
            <View style={styles.breakRow}>
              <Button variant="secondary" onPress={() => onBreak(-30)}>
                −30m
              </Button>
              <Text style={styles.clockBreak}>Break: {openSession.breakMinutes} min</Text>
              <Button variant="secondary" onPress={() => onBreak(30)}>
                +30m
              </Button>
            </View>
            {clockError ? <Text style={styles.clockErrorText}>{clockError}</Text> : null}
            <View style={styles.clockActions}>
              <Button variant="secondary" onPress={openSwitch}>
                {switchLabel}
              </Button>
              <Button fullWidth onPress={onClockOut}>
                Clock out
              </Button>
            </View>
          </Card>
        ) : (
          <Card>
            <Text style={styles.clockIdle}>Not on the clock</Text>
            <Button fullWidth onPress={openClockIn}>
              Clock in
            </Button>
          </Card>
        )}
      </View>

      <List
        data={entries}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Card>
            <View style={styles.entryHead}>
              <Text style={styles.date}>{item.date}</Text>
              <Text style={styles.hours}>{item.hours}h</Text>
            </View>
            <Text style={styles.meta}>
              {item.employeeName} · {item.payType.replace(/_/g, " ")}
              {item.craftLabel ? ` · ${item.craftLabel}` : ""}
            </Text>
            {item.lineItemDescription ? <Text style={styles.note}>{item.lineItemDescription}</Text> : null}
            {item.note ? <Text style={styles.note}>{item.note}</Text> : null}
          </Card>
        )}
        emptyTitle="No time logged"
        emptyDescription="Tap “Log time” to record the day's hours."
      />

      <View style={styles.footer}>
        <Button fullWidth onPress={() => setShowForm(true)}>
          Log time
        </Button>
      </View>

      {/* Clock in / Switch — pick craft + cost code together */}
      <Sheet
        visible={showClockIn || showSwitch}
        onClose={() => { setShowClockIn(false); setShowSwitch(false); }}
        title={showClockIn ? "Clock in" : switchLabel}
        primaryLabel={showClockIn ? "Start" : switchLabel}
        onPrimary={showClockIn ? onClockIn : onSwitch}
      >
        <Text style={styles.chipLabel}>Cost code</Text>
        <View style={styles.chips}>
          <Chip label="No specific line" selected={clockLineItemId === null} onPress={() => setClockLineItemId(null)} />
          {lineItems.map((l) => (
            <Chip key={l.id} label={l.description} selected={clockLineItemId === l.id} onPress={() => setClockLineItemId(l.id)} />
          ))}
        </View>

        <Text style={styles.chipLabel}>Craft</Text>
        <View style={styles.chips}>
          <Chip label="No craft" selected={clockCraftId === null} onPress={() => setClockCraftId(null)} />
          {crafts.map((c) => (
            <Chip key={c.id} label={c.name} selected={clockCraftId === c.id} onPress={() => setClockCraftId(c.id)} />
          ))}
        </View>
      </Sheet>

      {/* Manual "Log time" backfill form */}
      <Sheet
        visible={showForm}
        onClose={() => setShowForm(false)}
        title="Log time"
        primaryLabel="Save entry"
        onPrimary={submit}
      >
        <Field label="Date" placeholder="YYYY-MM-DD" value={date} onChangeText={setDate} />
        <Field label="Hours" placeholder="e.g. 8 or 8.5" value={hours} onChangeText={setHours} keyboardType="decimal-pad" />
        <Field label="Note" placeholder="Optional" value={note} onChangeText={setNote} />

        <Text style={styles.chipLabel}>Who</Text>
        <View style={styles.chips}>
          <Chip label="Me" selected={crewMemberId === null} onPress={() => setCrewMemberId(null)} />
          {crew.map((c) => (
            <Chip key={c.id} label={c.name} selected={crewMemberId === c.id} onPress={() => setCrewMemberId(c.id)} />
          ))}
        </View>

        <Text style={styles.chipLabel}>Pay type</Text>
        <View style={styles.chips}>
          {PAY_TYPES.map((p) => (
            <Chip key={p} label={p.replace(/_/g, " ")} selected={payType === p} onPress={() => setPayType(p)} />
          ))}
        </View>

        <Text style={styles.chipLabel}>Cost code</Text>
        <View style={styles.chips}>
          <Chip label="No specific line" selected={lineItemId === null} onPress={() => setLineItemId(null)} />
          {lineItems.map((l) => (
            <Chip key={l.id} label={l.description} selected={lineItemId === l.id} onPress={() => setLineItemId(l.id)} />
          ))}
        </View>

        <Text style={styles.chipLabel}>Craft</Text>
        <View style={styles.chips}>
          <Chip label="No craft" selected={craftClassificationId === null} onPress={() => setCraftClassificationId(null)} />
          {crafts.map((c) => (
            <Chip key={c.id} label={c.name} selected={craftClassificationId === c.id} onPress={() => setCraftClassificationId(c.id)} />
          ))}
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  pending: { color: colors.link, padding: 16, paddingBottom: 0, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
  error: { color: colors.tagRoseInk, padding: 16, paddingBottom: 0, fontSize: typography.size.sm },
  clockCard: { padding: 16, paddingBottom: 4 },
  clockElapsed: { color: colors.ink, fontSize: typography.size.lg, fontWeight: typography.weight.bold },
  clockContext: { color: colors.inkBody, fontSize: typography.size.md, marginTop: 4 },
  clockJob: { color: colors.inkBody, fontSize: typography.size.md, marginTop: 4 },
  clockOtherJob: {
    color: colors.tagRoseInk,
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    marginTop: 4,
  },
  clockBreak: { color: colors.inkBody, fontSize: typography.size.md, fontWeight: typography.weight.semibold },
  clockErrorText: { color: colors.tagRoseInk, fontSize: typography.size.sm, marginTop: 8 },
  clockIdle: { color: colors.ink, fontSize: typography.size.md, fontWeight: typography.weight.semibold },
  breakRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8 },
  clockActions: { gap: 8, marginTop: 8 },
  entryHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  date: { color: colors.ink, fontSize: typography.size.md, fontWeight: typography.weight.semibold },
  hours: { color: colors.ink, fontSize: typography.size.lg, fontWeight: typography.weight.bold },
  meta: { color: colors.inkMuted, fontSize: typography.size.sm },
  note: { color: colors.inkBody, fontSize: typography.size.md, marginTop: 4 },
  chipLabel: { color: colors.inkLabel, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  footer: { padding: 16, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.lineRow },
});
