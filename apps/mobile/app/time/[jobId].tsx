import { useAuth } from "@clerk/expo";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Chip } from "@/components/Chip";
import { DateField } from "@/components/DateField";
import { Field } from "@/components/Field";
import { GroupedList } from "@/components/GroupedList";
import { GroupedRow } from "@/components/GroupedRow";
import { JobContextChip } from "@/components/JobContextChip";
import { SectionHeader } from "@/components/SectionHeader";
import { Sheet } from "@/components/Sheet";
import { SignaturePad } from "@/components/SignaturePad";
import { SyncStatus } from "@/components/SyncStatus";
import { JobSections } from "@/components/JobSections";
import { cacheKeys } from "@/lib/cache-keys";
import { cachedRead, requireToken, staleNote } from "@/lib/cached-read";
import { tokenOrNull } from "@/lib/clerk-token";
import { emptyFor } from "@/lib/empty-state";
import { NotYourJobFunction } from "@/components/NotYourJobFunction";
import { SCREEN_CAPABILITY, SCREEN_NOUN } from "@/lib/screen-capabilities";
import { holds } from "@/lib/capabilities";
import { useMe } from "@/lib/use-me";
import { dayKey, todayKey } from "@/lib/today";
import { leadingFor, type Palette, radius, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";
import * as api from "@/lib/api";
import {
  clearSession,
  dayFromClockIn,
  getOpenSession,
  hoursFromClockInterval,
  saveSession,
  type OpenClockSession,
} from "@/lib/clock-session";
import { craftsForWorker, pickCraft, type CraftWorker } from "@/lib/crafts";
import {
  copyFromLastDay,
  crewIdOf,
  crewKey,
  isValidDate,
  isValidHours,
  type CrewRow,
  type WorkerKey,
} from "@/lib/crew-entry";
import { uuid } from "@/lib/id";
import { isValidPin, startHandover } from "@/lib/handover";
import { enqueue, queuedOperationIds, type CreateOp } from "@/lib/sync-queue";
import { useSync } from "@/lib/use-sync";
import type {
  Craft,
  CrewMember,
  LineItem,
  RatioWarning,
  TimeEntry,
  TimeEntryPayType,
  TimesheetSignoff,
} from "@/lib/types";

const PAY_TYPES: TimeEntryPayType[] = ["STRAIGHT", "OVERTIME", "DOUBLE_TIME", "SHIFT_DIFFERENTIAL"];

/** "7:02 AM" in the device's own time zone. */
function formatClockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** One line per breach, in the unit it was measured in: people on the
 * schedule, hours once logged. */
function ratioWarningText(w: RatioWarning): string {
  const planned = w.source === "planned";
  const apprentices = planned ? people(w.apprentices, "apprentice") : `${w.apprentices}h apprentice`;
  const journeymen = planned ? people(w.journeymen, "journeyman", "journeymen") : `${w.journeymen}h journeyman`;
  const where = planned ? "Scheduled crew" : "Hours logged";
  const rule = `(${w.unionLocalLabel}: ${w.rule})`;
  if (w.status === "NO_JOURNEYMAN") return `${where}: ${apprentices} and no journeyman ${rule}.`;
  const allowed =
    w.allowedApprentices === null ? "" : ` — ${planned ? w.allowedApprentices : `${w.allowedApprentices}h`} allowed`;
  return `${where}: ${apprentices} to ${journeymen}${allowed} ${rule}.`;
}

function people(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The line under "Craft": why the list is what it is. */
function CraftHint({ required, fallback, who }: { required: boolean; fallback: boolean; who: string }) {
  const palette = usePalette();
  const hint = useMemo(
    () =>
      StyleSheet.create({
        hint: { color: palette.colors.inkMuted, fontSize: typography.size.sm },
      }),
    [palette],
  );
  if (!required) {
    return (
      <Text style={hint.hint}>
        No crafts are set up for this company, so these hours will show as untagged on certified payroll.
      </Text>
    );
  }
  if (fallback) {
    return (
      <Text style={hint.hint}>
        No crafts are ticked for {who} yet, so every craft is shown. Tick them on the web under Union compliance.
      </Text>
    );
  }
  return <Text style={hint.hint}>Required.</Text>;
}

function formatElapsed(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

export default function TimeScreen() {
  const { me } = useMe();
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { getToken } = useAuth();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  // Rows saved on this phone that the server hasn't returned yet. Shown at
  // once, marked "Syncing…", so a save never looks like it did nothing while
  // the queue flushes and the list reloads.
  const [optimistic, setOptimistic] = useState<(TimeEntry & { clientOperationId: string })[]>([]);
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [crafts, setCrafts] = useState<Craft[]>([]);
  // Job names by id, so the clock card can name the job a session is on —
  // which may not be the job this screen is showing.
  const [jobNames, setJobNames] = useState<Record<string, string>>({});
  const [offline, setOffline] = useState<string | "nothing" | null>(null);
  // Apprentice-ratio breaches for today on this job, from the crew schedule
  // and the hours already logged. Empty when within ratio, or when it could
  // not be read (a failed read is not a warning).
  const [ratioWarnings, setRatioWarnings] = useState<RatioWarning[]>([]);

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

  // "Log time" — the crew sheet (typed, no clock capture). One set of
  // details for everyone selected; each person's row can override the hours
  // (late arrival, early out) and carries their own craft.
  const [showForm, setShowForm] = useState(false);
  const [date, setDate] = useState("");
  const [sharedHours, setSharedHours] = useState("8");
  const [payType, setPayType] = useState<TimeEntryPayType>("STRAIGHT");
  const [note, setNote] = useState("");
  const [lineItemId, setLineItemId] = useState<string | null>(null);
  const [rows, setRows] = useState<CrewRow[]>([]);

  // "Sign the day" — the foreman's signature on one day's hours. From then
  // the day is locked until the office reopens it on the web.
  const [signoffs, setSignoffs] = useState<TimesheetSignoff[]>([]);
  // The day's report and delays, so the sign sheet can say what else the
  // signature covers — signing locks them too.
  const [reportDates, setReportDates] = useState<Set<string>>(new Set());
  const [delayCounts, setDelayCounts] = useState<Map<string, number>>(new Map());
  const [showSign, setShowSign] = useState(false);
  // "Hand the phone to a crew member": who, and the PIN that brings it
  // back. See lib/handover.ts — this is the C15/D-13 case, the hanger or
  // taper who does not carry a company phone.
  const [showHandover, setShowHandover] = useState(false);
  const [handTo, setHandTo] = useState<string | null>(null);
  const [handPin, setHandPin] = useState("");
  const [signDate, setSignDate] = useState("");
  const [signerName, setSignerName] = useState("");
  const [signaturePath, setSignaturePath] = useState<string | null>(null);

  const load = async () => {
    if (!jobId) return;
    // ONE token for the screen, with a deadline: offline `getToken()`
    // takes about two and a half minutes to answer (lib/clerk-token.ts),
    // and the hours below are the record a foreman is asked about at the
    // end of the week — they come off the cache long before that.
    const token = await tokenOrNull(getToken);
    const today = dayFromClockIn(new Date().toISOString());
    // Everything at once, each piece shown the moment it arrives. These used
    // to run one batch after another, and the list a person had just saved
    // into waited for the slowest of them — seconds, on a phone connection.
    await Promise.allSettled([
      // The hours themselves go through the cache: with no signal this
      // screen showed an error and no rows, on the one record a foreman is
      // asked about at the end of the week.
      cachedRead(cacheKeys.time(jobId), requireToken(token, (t) => api.listTimeEntries(jobId, t))).then(
        async (result) => {
          if (result.from === "nothing") {
            setOffline("nothing");
            return;
          }
          setEntries(result.value);
          setOffline(staleNote(result));
          // Drop just-saved rows the server now has, or refused.
          const queued = await queuedOperationIds();
          setOptimistic((rows) => rows.filter((r) => queued.has(r.clientOperationId)));
        },
      ),
      // The rest are the pickers and the context around the hours. With
      // no token there is nothing to ask for, and the hours above still
      // render.
      ...(token
        ? [
            api.listCrew(token).then(setCrew),
            api.listLineItems(jobId, token).then(setLineItems),
            api.listCrafts(token).then(setCrafts),
            api.listJobs(token).then((js) => setJobNames(Object.fromEntries(js.map((j) => [j.id, j.name])))),
            // An older server without sign-offs still shows the hours.
            api.listSignoffs(jobId, token).then(setSignoffs, () => setSignoffs([])),
            Promise.all([api.listFieldReports(jobId, token), api.listDelays(jobId, token)]).then(([rs, ds]) => {
              setReportDates(new Set(rs.map((r) => r.reportDate)));
              const counts = new Map<string, number>();
              for (const d of ds) counts.set(d.date, (counts.get(d.date) ?? 0) + 1);
              setDelayCounts(counts);
            }),
            // A ratio that cannot be read is not a warning, and offline it
            // simply shows nothing.
            api.getApprenticeRatio(jobId, today, token).then(
              (r) => setRatioWarnings(r.warnings),
              () => setRatioWarnings([]),
            ),
          ]
        : []),
    ]);
  };

  // The saved session is local, so read it straight away rather than after
  // the network load.
  useEffect(() => {
    (async () => {
      setOpenSession(await getOpenSession());
      setSessionLoaded(true);
    })();
  }, []);


  // Tick the elapsed clock once a minute.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const { pending, sync, refused, dismissRefused, retrySetAside } = useSync(load);

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
    await saveEntry({
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

  /** Queues one entry and shows it straight away as "Syncing…" when it is
   * for this job. The server's copy replaces it on the next load. */
  const saveEntry = async (op: Extract<CreateOp, { type: "time:create" }>) => {
    if (op.jobId === jobId) {
      const crewId = op.crewMemberId ?? null;
      setOptimistic((rows) => [
        {
          id: `local-${op.clientOperationId}`,
          clientOperationId: op.clientOperationId,
          date: op.date,
          hours: op.hours,
          payType: op.payType as TimeEntryPayType,
          note: op.note ?? null,
          clockStartedAt: op.clockStartedAt ?? null,
          clockEndedAt: op.clockEndedAt ?? null,
          clockBreakMinutes: op.clockBreakMinutes ?? null,
          employeeName: crewId ? (crew.find((c) => c.id === crewId)?.name ?? "Crew member") : "Me",
          lineItemDescription: lineItems.find((l) => l.id === op.lineItemId)?.description ?? null,
          craftLabel: crafts.find((c) => c.id === op.craftClassificationId)?.name ?? null,
        },
        ...rows,
      ]);
    }
    await enqueue(op);
  };

  const onClockIn = async () => {
    if (!jobId || (craftRequired && !clockCraftId) || (costCodeRequired && !clockLineItemId)) return;
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
    if (!jobId || !openSession || (craftRequired && !clockCraftId) || (costCodeRequired && !clockLineItemId)) return;
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
    setClockCraftId(pickCraft(myCrafts.options, null));
    setClockLineItemId(onlyLineItemId);
    setShowClockIn(true);
  };

  const openSwitch = () => {
    if (!openSession) return;
    setClockCraftId(pickCraft(myCrafts.options, openSession.craftClassificationId));
    // A cost code belongs to one job. Switching onto THIS job from another
    // must not carry the other job's cost code over — the server would
    // refuse it and the offline queue would stall behind the refusal.
    setClockLineItemId(openSession.jobId === jobId ? (openSession.lineItemId ?? onlyLineItemId) : onlyLineItemId);
    setShowSwitch(true);
  };

  const workerOf = (key: WorkerKey): CraftWorker => {
    const id = crewIdOf(key);
    return id ? { kind: "crew", id } : { kind: "me" };
  };
  const nameOf = (key: WorkerKey): string => {
    const id = crewIdOf(key);
    return id ? (crew.find((c) => c.id === id)?.name ?? "Crew member") : "Me";
  };
  const craftOptionsFor = (key: WorkerKey) => craftsForWorker(crafts, workerOf(key));

  const openForm = () => {
    if (!date) setDate(today);
    if (!lineItemId) setLineItemId(onlyLineItemId);
    // Start with "Me" the first time, so logging your own day is still one tap.
    if (rows.length === 0) {
      setRows([{ worker: "me", hours: null, craftId: pickCraft(craftOptionsFor("me").options, null) }]);
    }
    setShowForm(true);
  };

  const toggleWorker = (key: WorkerKey) => {
    setRows((current) =>
      current.some((r) => r.worker === key)
        ? current.filter((r) => r.worker !== key)
        : [...current, { worker: key, hours: null, craftId: pickCraft(craftOptionsFor(key).options, null) }],
    );
  };
  const setRowHours = (key: WorkerKey, text: string) =>
    setRows((current) => current.map((r) => (r.worker === key ? { ...r, hours: text.trim() === "" ? null : text } : r)));
  const setRowCraft = (key: WorkerKey, craftId: string) =>
    setRows((current) => current.map((r) => (r.worker === key ? { ...r, craftId } : r)));

  /** Fill the sheet from the last day this job had hours — people, hours,
   * crafts, cost code — for the foreman to adjust rather than re-pick. Crew
   * members who have since been archived are dropped; a craft the person no
   * longer works under is re-picked from their current ones. */
  const copyLastDay = () => {
    if (!lastDay) return;
    const active = new Set(crew.map((c) => crewKey(c.id)));
    setRows(
      lastDay.rows
        .filter((r) => r.worker === "me" || active.has(r.worker))
        .map((r) => ({ ...r, craftId: pickCraft(craftOptionsFor(r.worker).options, r.craftId) })),
    );
    setSharedHours(lastDay.sharedHours);
    // Copied only if that cost code is still on the job; otherwise keep
    // what is picked (or the only line) rather than clearing it.
    if (lastDay.lineItemId && lineItems.some((l) => l.id === lastDay.lineItemId)) setLineItemId(lastDay.lineItemId);
    if (lastDay.payType) setPayType(lastDay.payType as TimeEntryPayType);
  };

  const handOver = async () => {
    const member = crew.find((c) => c.id === handTo);
    if (!jobId || !member) return;
    setShowHandover(false);
    await startHandover({
      crewMemberId: member.id,
      name: member.name,
      jobId,
      jobName: jobNames[jobId] ?? "this job",
      // Blank means no PIN, which is a decision rather than an omission:
      // the protection is then the foreman standing next to the phone.
      ...(isValidPin(handPin.trim()) ? { pin: handPin.trim() } : {}),
    });
    setHandTo(null);
    setHandPin("");
    router.replace("/handover");
  };

  const openSign = () => {
    setSignDate(today);
    setSignaturePath(null);
    setShowSign(true);
  };

  const submitSignoff = async () => {
    if (!jobId || !canSign || !signaturePath) return;
    const op = {
      type: "signoff:create" as const,
      jobId,
      clientOperationId: uuid(),
      date: signDate,
      signerName: signerName.trim(),
      signaturePath,
    };
    setShowSign(false);
    setSignaturePath(null);
    await enqueue(op);
    await sync();
  };

  const submit = async () => {
    if (!jobId || !canSave) return;
    const toSave = rows;
    const savedDate = date;
    setRows([]);
    setNote("");
    // Back to today next time: a sheet reopened tomorrow must not still say
    // the day that was logged last.
    setDate("");
    setShowForm(false);
    // One entry per person, each with its own idempotency key, so a retried
    // offline flush replays each rather than duplicating any.
    for (const r of toSave) {
      await saveEntry({
        type: "time:create",
        jobId,
        clientOperationId: uuid(),
        date: savedDate,
        hours: (r.hours ?? sharedHours).trim(),
        payType,
        note: note || undefined,
        crewMemberId: crewIdOf(r.worker) ?? undefined,
        lineItemId: lineItemId || undefined,
        craftClassificationId: r.craftId || undefined,
      });
    }
    await sync();
  };

  // A craft is required whenever the company has any — certified payroll
  // (wh347.ts) cannot place untagged hours. With none set up at all there is
  // nothing to choose, so hours can still be logged and payroll flags them.
  const craftRequired = crafts.length > 0;
  // A cost code is required whenever the job has any — job costing and the
  // WIP report cannot place hours on "no line". A job with none set up can
  // still take hours; there is nothing to choose.
  const costCodeRequired = lineItems.length > 0;
  const onlyLineItemId = lineItems.length === 1 ? lineItems[0].id : null;
  const myCrafts = craftsForWorker(crafts, { kind: "me" });
  const today = dayFromClockIn(new Date().toISOString());
  const lastDay = copyFromLastDay(entries, today);
  const rowProblem = (r: CrewRow): string | null => {
    if (!isValidHours(r.hours ?? sharedHours)) return "Hours must be more than 0 and at most 24.";
    if (craftRequired && !r.craftId) return "Pick a craft.";
    return null;
  };
  // Days with a live sign-off: their hours are locked. The server refuses a
  // write to one (409), so the sheet refuses first rather than queueing
  // entries that can only be set aside.
  const signedByDate = new Map(signoffs.map((s) => [s.date, s]));
  const dateSigned = signedByDate.get(date);
  const canSave =
    isValidDate(date) &&
    !dateSigned &&
    (!costCodeRequired || lineItemId !== null) &&
    rows.length > 0 &&
    rows.every((r) => rowProblem(r) === null);

  const signEntries = entries.filter((e) => e.date === signDate);
  const signHours = signEntries.reduce((sum, e) => sum + Number(e.hours), 0);
  const signDateSigned = signedByDate.get(signDate);
  const canSign =
    isValidDate(signDate) &&
    !signDateSigned &&
    signEntries.length > 0 &&
    signerName.trim().length > 0 &&
    signaturePath !== null;
  const saveLabel = rows.length > 1 ? `Save ${rows.length} entries` : "Save entry";

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

  // The server refuses this route to anybody without the
  // capability (see lib/screen-capabilities.ts, checked against the
  // route itself in its test). Saying so beats a 403 rendering as
  // an empty screen with no explanation.
  if (!holds(me, SCREEN_CAPABILITY["time/[jobId]"])) return <NotYourJobFunction what={SCREEN_NOUN["time/[jobId]"]} />;

  const allEntries = [...optimistic, ...entries];
  const todayIso = todayKey();
  const todayEntries = allEntries.filter((item) => dayKey(item.date) === todayIso);
  const earlierEntries = allEntries.filter((item) => dayKey(item.date) !== todayIso);
  const empty = emptyFor(offline, "the hours", {
    title: "No time logged",
    description: "Tap “Log time” to record the day's hours.",
  });

  const renderDay = (items: typeof allEntries, heading: string) =>
    items.length === 0 ? null : (
      <>
        <SectionHeader>{heading}</SectionHeader>
        <GroupedList>
          {items.map((item, i) => (
            <GroupedRow
              key={item.id}
              title={item.employeeName}
              subtitle={
                [
                  item.id.startsWith("local-") ? "Syncing…" : null,
                  item.payType.replace(/_/g, " "),
                  item.craftLabel,
                ]
                  .filter(Boolean)
                  .slice(0, 2)
                  .join(" · ") || undefined
              }
              detail={
                item.clockStartedAt && item.clockEndedAt
                  ? `${formatClockTime(item.clockStartedAt)}–${formatClockTime(item.clockEndedAt)}${
                      item.clockBreakMinutes ? ` · ${item.clockBreakMinutes} min break` : ""
                    }`
                  : undefined
              }
              note={[item.lineItemDescription, item.note].filter(Boolean).join(" · ") || undefined}
              value={`${item.hours}h`}
              trailing={
                signedByDate.get(item.date) ? (
                  <Text style={styles.signed}>
                    {signedByDate.get(item.date)!.state === "APPROVED" ? "Approved" : "Signed"} · locked
                  </Text>
                ) : undefined
              }
              divider={i > 0}
            />
          ))}
        </GroupedList>
      </>
    );

  return (
    <View style={styles.screen}>
      <JobSections jobId={jobId} active="time" />
      <View style={styles.chipWrap}>
        <JobContextChip />
      </View>
      <SyncStatus
        pending={pending}
        state={offline}
        refused={refused}
        onDismiss={dismissRefused}
        onRetry={retrySetAside}
      />

      {ratioWarnings.length > 0 ? (
        <View style={styles.ratioBanner}>
          <Text style={styles.ratioTitle}>Apprentice ratio — over today</Text>
          {ratioWarnings.map((w, i) => (
            <Text key={i} style={styles.ratioLine}>{ratioWarningText(w)}</Text>
          ))}
        </View>
      ) : null}

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

      {/* The hours, grouped by the day they belong to — "Today" is the
          row a foreman opens this screen for, and everything else can
          wait below the fold. */}
      <ScrollView style={styles.listScroll} contentContainerStyle={styles.listContent}>
        {allEntries.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{empty.emptyTitle}</Text>
            {empty.emptyDescription ? <Text style={styles.emptyBody}>{empty.emptyDescription}</Text> : null}
          </View>
        ) : (
          <>
            {renderDay(todayEntries, "Today")}
            {renderDay(earlierEntries, "Earlier")}
          </>
        )}
      </ScrollView>

      <View style={[styles.footer, styles.footerRow]}>
        <Button variant="secondary" onPress={openSign}>
          Sign the day
        </Button>
        <Button variant="secondary" onPress={() => setShowHandover(true)}>
          Hand phone over
        </Button>
        <View style={styles.footerMain}>
          <Button fullWidth onPress={openForm}>
            Log time
          </Button>
        </View>
      </View>

      {/* Handing the phone to a crew member so they put their OWN hours
          in and sign for them, rather than the foreman typing what he
          remembers at the end of the day. */}
      <Sheet
        visible={showHandover}
        onClose={() => setShowHandover(false)}
        title="Hand the phone over"
        primaryLabel="Hand it over"
        onPrimary={handOver}
        primaryDisabled={!handTo}
      >
        <Text style={styles.handoverNote}>
          They will see one screen — their own hours for today on this job, and a place to sign.
          Nothing else on the phone is open while they have it.
        </Text>
        <View style={styles.handoverList}>
          {crew.map((member) => (
            <Pressable
              key={member.id}
              onPress={() => setHandTo(member.id)}
              style={[styles.handoverPick, handTo === member.id && styles.handoverPicked]}
              accessibilityRole="button"
            >
              <Text style={handTo === member.id ? styles.handoverPickedText : styles.handoverPickText}>
                {member.name}
              </Text>
            </Pressable>
          ))}
          {crew.length === 0 ? (
            <Text style={styles.handoverNote}>
              No crew members on this company yet. They are added on the web, under Team.
            </Text>
          ) : null}
        </View>
        <Field
          label="PIN to get the phone back (optional)"
          value={handPin}
          onChangeText={setHandPin}
          keyboardType="number-pad"
          maxLength={4}
          placeholder="4 digits"
        />
        <Text style={styles.handoverNote}>
          Without a PIN, anyone holding the phone can hand it back — which is usually fine, because
          you are standing there. With one, it does not come back until you type it.
        </Text>
      </Sheet>

      {/* Clock in / Switch — pick craft + cost code together */}
      <Sheet
        visible={showClockIn || showSwitch}
        onClose={() => { setShowClockIn(false); setShowSwitch(false); }}
        title={showClockIn ? "Clock in" : switchLabel}
        primaryLabel={showClockIn ? "Start" : switchLabel}
        onPrimary={showClockIn ? onClockIn : onSwitch}
        primaryDisabled={(craftRequired && !clockCraftId) || (costCodeRequired && !clockLineItemId)}
      >
        <Text style={styles.chipLabel}>Cost code</Text>
        <Text style={styles.hint}>
          {costCodeRequired ? "Required." : "This job has no cost codes yet, so these hours go on no specific line."}
        </Text>
        <View style={styles.chips}>
          {costCodeRequired ? null : (
            <Chip label="No specific line" selected={clockLineItemId === null} onPress={() => setClockLineItemId(null)} />
          )}
          {lineItems.map((l) => (
            <Chip key={l.id} label={l.description} selected={clockLineItemId === l.id} onPress={() => setClockLineItemId(l.id)} />
          ))}
        </View>

        <Text style={styles.chipLabel}>Craft</Text>
        <CraftHint required={craftRequired} fallback={myCrafts.fallback} who="you" />
        <View style={styles.chips}>
          {myCrafts.options.map((c) => (
            <Chip key={c.id} label={c.name} selected={clockCraftId === c.id} onPress={() => setClockCraftId(c.id)} />
          ))}
        </View>
      </Sheet>

      {/* "Log time" — the crew sheet */}
      <Sheet
        visible={showForm}
        onClose={() => setShowForm(false)}
        title="Log time"
        primaryLabel={saveLabel}
        onPrimary={submit}
        primaryDisabled={!canSave}
      >
        {lastDay ? (
          <Button variant="secondary" onPress={copyLastDay}>
            {`Copy crew from ${lastDay.date}`}
          </Button>
        ) : null}
        <DateField label="Date" value={date} onChange={setDate} max={today} />
        {dateSigned ? (
          <Text style={styles.rowProblem}>
            {date} is signed{dateSigned.state === "APPROVED" ? " and approved" : ""}, so its hours are locked. The
            office can reopen it on the web.
          </Text>
        ) : null}
        <Field
          label="Hours for everyone"
          placeholder="e.g. 8 or 8.5"
          value={sharedHours}
          onChangeText={setSharedHours}
          keyboardType="decimal-pad"
        />

        <Text style={styles.chipLabel}>Who</Text>
        <View style={styles.chips}>
          <Chip label="Me" selected={rows.some((r) => r.worker === "me")} onPress={() => toggleWorker("me")} />
          {crew.map((c) => (
            <Chip
              key={c.id}
              label={c.name}
              selected={rows.some((r) => r.worker === crewKey(c.id))}
              onPress={() => toggleWorker(crewKey(c.id))}
            />
          ))}
        </View>

        {rows.map((r) => {
          const options = craftOptionsFor(r.worker);
          const problem = rowProblem(r);
          return (
            <View key={r.worker} style={styles.crewRow}>
              <Text style={styles.crewName}>{nameOf(r.worker)}</Text>
              <Field
                label="Hours (if different)"
                placeholder={`${sharedHours || "—"} — same as everyone`}
                value={r.hours ?? ""}
                onChangeText={(text) => setRowHours(r.worker, text)}
                keyboardType="decimal-pad"
              />
              <CraftHint
                required={craftRequired}
                fallback={options.fallback}
                who={r.worker === "me" ? "you" : nameOf(r.worker)}
              />
              <View style={styles.chips}>
                {options.options.map((c) => (
                  <Chip key={c.id} label={c.name} selected={r.craftId === c.id} onPress={() => setRowCraft(r.worker, c.id)} />
                ))}
              </View>
              {problem ? <Text style={styles.rowProblem}>{problem}</Text> : null}
            </View>
          );
        })}

        <Text style={styles.chipLabel}>Pay type</Text>
        <View style={styles.chips}>
          {PAY_TYPES.map((p) => (
            <Chip key={p} label={p.replace(/_/g, " ")} selected={payType === p} onPress={() => setPayType(p)} />
          ))}
        </View>

        <Text style={styles.chipLabel}>Cost code</Text>
        <Text style={styles.hint}>
          {costCodeRequired ? "Required." : "This job has no cost codes yet, so these hours go on no specific line."}
        </Text>
        <View style={styles.chips}>
          {costCodeRequired ? null : (
            <Chip label="No specific line" selected={lineItemId === null} onPress={() => setLineItemId(null)} />
          )}
          {lineItems.map((l) => (
            <Chip key={l.id} label={l.description} selected={lineItemId === l.id} onPress={() => setLineItemId(l.id)} />
          ))}
        </View>

        <Field label="Note" placeholder="Optional — goes on every entry" value={note} onChangeText={setNote} />
      </Sheet>

      {/* "Sign the day" — one signature for everyone's hours on this job */}
      <Sheet
        visible={showSign}
        onClose={() => setShowSign(false)}
        title="Sign the day"
        primaryLabel="Sign and lock"
        onPrimary={submitSignoff}
        primaryDisabled={!canSign}
      >
        <DateField label="Date" value={signDate} onChange={setSignDate} max={today} />
        {signDateSigned ? (
          <Text style={styles.rowProblem}>
            {signDate} is already signed by {signDateSigned.signerName}.
          </Text>
        ) : signEntries.length === 0 ? (
          <Text style={styles.rowProblem}>No hours on {signDate || "that day"} to sign.</Text>
        ) : (
          <View style={styles.crewRow}>
            <Text style={styles.crewName}>
              {signEntries.length} {signEntries.length === 1 ? "entry" : "entries"} · {Math.round(signHours * 100) / 100}h
            </Text>
            {signEntries.map((e) => (
              <Text key={e.id} style={styles.meta}>
                {e.employeeName} · {e.hours}h · {e.payType.replace(/_/g, " ")}
                {e.craftLabel ? ` · ${e.craftLabel}` : ""}
              </Text>
            ))}
          </View>
        )}
        <Text style={styles.meta}>
          Daily report: {reportDates.has(signDate) ? "filed" : "not filed yet"}
          {delayCounts.get(signDate) ? ` · ${delayCounts.get(signDate)} delay${delayCounts.get(signDate) === 1 ? "" : "s"}` : ""}
        </Text>
        <Text style={styles.hint}>
          Signing locks these hours{reportDates.has(signDate) || delayCounts.get(signDate) ? ", the daily report and its delays" : ""}.
          Anything still waiting to sync goes up first. If something is wrong later, the office reopens the day on
          the web.
        </Text>
        <Field label="Your name" placeholder="Printed under the signature" value={signerName} onChangeText={setSignerName} />
        <Text style={styles.chipLabel}>Signature</Text>
        <SignaturePad key={showSign ? "open" : "closed"} onChange={setSignaturePath} />
      </Sheet>
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    // The handover sheet — who is taking the phone, and the PIN that
    // brings it back. Picked = the brand fill with the DARK label, the
    // one-yellow rule; the pre-rebase version put canvas-coloured text on
    // it, which is light-on-yellow in light mode.
    handoverNote: { color: p.colors.inkBody, fontSize: typography.size.sm, lineHeight: 20 },
    handoverList: { gap: 8 },
    handoverPick: {
      borderWidth: 1,
      borderColor: p.colors.lineCard,
      borderRadius: radius.field,
      paddingVertical: 12,
      paddingHorizontal: 14,
    },
    handoverPicked: { backgroundColor: p.colors.brand, borderColor: p.colors.brand },
    handoverPickText: { color: p.colors.ink, fontSize: typography.size.md },
    handoverPickedText: {
      color: p.colors.brandInk,
      fontSize: typography.size.md,
      fontWeight: typography.weight.semibold,
    },
    screen: { flex: 1, backgroundColor: p.colors.canvas },
    chipWrap: { padding: space.md, paddingBottom: 0 },
    clockCard: { padding: space.md, paddingBottom: space.xxs },
    clockElapsed: { color: p.colors.ink, fontSize: typography.size.lg, fontWeight: typography.weight.bold },
    clockContext: { color: p.colors.inkBody, fontSize: typography.size.md, marginTop: 4 },
    clockJob: { color: p.colors.inkBody, fontSize: typography.size.md, marginTop: 4 },
    clockOtherJob: {
      color: p.colors.tagRoseInk,
      fontSize: typography.size.md,
      fontWeight: typography.weight.semibold,
      marginTop: 4,
    },
    clockBreak: { color: p.colors.inkBody, fontSize: typography.size.md, fontWeight: typography.weight.semibold },
    clockErrorText: { color: p.colors.tagRoseInk, fontSize: typography.size.sm, marginTop: 8 },
    clockIdle: { color: p.colors.ink, fontSize: typography.size.md, fontWeight: typography.weight.semibold },
    breakRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8 },
    clockActions: { gap: 8, marginTop: 8 },
    listScroll: { flex: 1 },
    listContent: { padding: space.md, paddingTop: 0, gap: space.xs },
    empty: { gap: space.xs, paddingTop: space.xl, alignItems: "center" },
    emptyTitle: {
      color: p.colors.ink,
      fontSize: typography.size.lg,
      fontWeight: typography.weight.semibold,
      textAlign: "center",
    },
    emptyBody: {
      color: p.colors.inkBody,
      fontSize: typography.size.md,
      lineHeight: leadingFor(typography.size.md),
      textAlign: "center",
    },
    meta: { color: p.colors.inkMuted, fontSize: typography.size.sm },
    chipLabel: { color: p.colors.inkLabel, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    hint: { color: p.colors.inkMuted, fontSize: typography.size.sm },
    crewRow: {
      gap: 8,
      padding: 12,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: p.colors.lineCard,
    },
    crewName: { color: p.colors.ink, fontSize: typography.size.md, fontWeight: typography.weight.semibold },
    rowProblem: { color: p.colors.tagRoseInk, fontSize: typography.size.sm },
    ratioBanner: {
      margin: space.md,
      marginBottom: 0,
      padding: 12,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: p.colors.tagRoseInk,
      gap: 4,
    },
    ratioTitle: { color: p.colors.tagRoseInk, fontSize: typography.size.md, fontWeight: typography.weight.bold },
    ratioLine: { color: p.colors.inkBody, fontSize: typography.size.sm },
    footer: {
      padding: space.md,
      paddingTop: space.xs,
      borderTopWidth: 1,
      borderTopColor: p.colors.lineRow,
    },
    footerRow: { flexDirection: "row", gap: 8, alignItems: "center" },
    footerMain: { flex: 1 },
    signed: { color: p.colors.link, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
  });
}
