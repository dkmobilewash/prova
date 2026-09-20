import { useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Chip } from "@/components/Chip";
import { DateField } from "@/components/DateField";
import { Field } from "@/components/Field";
import { List } from "@/components/List";
import { RefusedBanner } from "@/components/RefusedBanner";
import { Sheet } from "@/components/Sheet";
import * as api from "@/lib/api";
import { dayFromClockIn } from "@/lib/clock-session";
import { uuid } from "@/lib/id";
import { enqueue, queuedOperationIds } from "@/lib/sync-queue";
import { JobSections } from "@/components/JobSections";
import { colors, typography } from "@/lib/theme";
import type { DelayRow, FieldReportRow } from "@/lib/types";
import { useFieldReports } from "@/lib/use-field-reports";
import { useStableGetToken } from "@/lib/use-stable-get-token";
import { useSync } from "@/lib/use-sync";

// The same choices the server accepts (lib/delays-core.ts on the web).
const CAUSES = [
  ["WEATHER", "Weather"],
  ["GC_SCHEDULE", "GC schedule"],
  ["OTHER_TRADE", "Other trade"],
  ["MATERIAL", "Material"],
  ["INSPECTION", "Inspection"],
  ["DESIGN_RFI", "Design / RFI"],
  ["SITE_ACCESS", "Site access"],
  ["EQUIPMENT", "Equipment"],
  ["OTHER", "Other"],
] as const;
const PARTIES = [
  ["GC", "GC"],
  ["OWNER", "Owner"],
  ["OTHER_TRADE", "Another trade"],
  ["SUPPLIER", "Supplier"],
  ["OURSELVES", "Us"],
  ["NOBODY", "Nobody"],
] as const;
const METHODS = [
  ["PHONE", "Phone"],
  ["EMAIL", "Email"],
  ["TEXT", "Text"],
  ["IN_PERSON", "In person"],
  ["MEETING", "Meeting"],
] as const;

type Day = { date: string; report: FieldReportRow | null; delays: DelayRow[] };

/** One card per day: its report (if filed) and its delays together, newest
 * day first — a day with delays but no report still shows. */
function daysOf(reports: FieldReportRow[], delays: DelayRow[]): Day[] {
  const byDate = new Map<string, Day>();
  for (const r of reports) byDate.set(r.reportDate, { date: r.reportDate, report: r, delays: [] });
  for (const d of delays) {
    const day = byDate.get(d.date) ?? { date: d.date, report: null, delays: [] };
    day.delays.push(d);
    byDate.set(d.date, day);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}

export default function ReportsScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const getToken = useStableGetToken();
  const { reports, pending, error, create, refresh } = useFieldReports(jobId ?? "");
  const [delays, setDelays] = useState<DelayRow[]>([]);
  // Delays logged on this phone that the server hasn't returned yet — shown
  // at once as "Syncing…" rather than appearing seconds after Save.
  const [optimisticDelays, setOptimisticDelays] = useState<(DelayRow & { clientOperationId: string })[]>([]);
  const today = dayFromClockIn(new Date().toISOString());

  const loadDelays = useCallback(async () => {
    const token = await getToken();
    if (!token || !jobId) return;
    try {
      setDelays(await api.listDelays(jobId, token));
      const queued = await queuedOperationIds();
      setOptimisticDelays((rows) => rows.filter((r) => queued.has(r.clientOperationId)));
    } catch {
      // Offline or an older server: reports still show.
    }
  }, [getToken, jobId]);

  const reloadAll = useCallback(async () => {
    await refresh();
    await loadDelays();
  }, [refresh, loadDelays]);
  const { sync, refused, dismissRefused, retrySetAside } = useSync(reloadAll);

  // New report
  const [showReport, setShowReport] = useState(false);
  const [reportDate, setReportDate] = useState(today);
  const [workPerformed, setWorkPerformed] = useState("");
  const [otherTrades, setOtherTrades] = useState("");
  const [conditions, setConditions] = useState("");
  const existing = reports.find((r) => r.reportDate === reportDate);
  const reportProblem = existing
    ? existing.lockState
      ? `${reportDate} is signed, so its report is locked.`
      : `There's already a report for ${reportDate}. Edit it on the web.`
    : null;
  const canFile = workPerformed.trim().length > 0 && reportProblem === null;

  const submitReport = async () => {
    if (!canFile) return;
    const fields = {
      reportDate,
      workPerformed: workPerformed.trim(),
      crewPresent: otherTrades.trim() || null,
      weather: conditions.trim() || null,
      delays: null,
    };
    setWorkPerformed("");
    setOtherTrades("");
    setConditions("");
    setShowReport(false);
    await create(fields);
    await loadDelays();
  };

  // Log a delay
  const [showDelay, setShowDelay] = useState(false);
  const [delayDate, setDelayDate] = useState(today);
  const [cause, setCause] = useState<string | null>(null);
  const [party, setParty] = useState<string | null>(null);
  const [partyName, setPartyName] = useState("");
  const [what, setWhat] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [workers, setWorkers] = useState("");
  const [hoursLost, setHoursLost] = useState("");
  const [told, setTold] = useState<string | null>(null);
  const [toldWho, setToldWho] = useState("");
  const delayDayLocked = reports.some((r) => r.reportDate === delayDate && r.lockState);
  const canLogDelay = cause !== null && party !== null && what.trim().length > 0 && !delayDayLocked;

  const openDelay = () => {
    setDelayDate(today);
    setShowDelay(true);
  };

  const submitDelay = async () => {
    if (!jobId || !canLogDelay) return;
    const op = {
      type: "delay:create" as const,
      jobId,
      clientOperationId: uuid(),
      date: delayDate,
      cause: cause!,
      responsibleParty: party!,
      responsibleName: partyName.trim() || undefined,
      startTime: from.trim() || undefined,
      endTime: to.trim() || undefined,
      workersAffected: workers.trim() || undefined,
      hoursLost: hoursLost.trim() || undefined,
      description: what.trim(),
      gcNotifiedHow: told ?? undefined,
      gcNotifiedWho: told ? toldWho.trim() || undefined : undefined,
      gcNotifiedAt: told ? new Date().toISOString() : undefined,
    };
    setCause(null);
    setParty(null);
    setPartyName("");
    setWhat("");
    setFrom("");
    setTo("");
    setWorkers("");
    setHoursLost("");
    setTold(null);
    setToldWho("");
    setShowDelay(false);
    const causeText = CAUSES.find(([v]) => v === op.cause)?.[1] ?? op.cause;
    const partyText = PARTIES.find(([v]) => v === op.responsibleParty)?.[1] ?? op.responsibleParty;
    setOptimisticDelays((rows) => [
      ...rows,
      {
        id: `local-${op.clientOperationId}`,
        clientOperationId: op.clientOperationId,
        date: op.date,
        cause: op.cause,
        causeLabel: causeText,
        responsibleParty: op.responsibleParty,
        responsibleLabel: partyText,
        responsibleName: op.responsibleName ?? null,
        start: op.startTime ?? null,
        end: op.endTime ?? null,
        workersAffected: op.workersAffected ? Number(op.workersAffected) : null,
        hoursLost: op.hoursLost ?? null,
        description: op.description,
        gcNotifiedHow: op.gcNotifiedHow ?? null,
        gcNotifiedWho: op.gcNotifiedWho ?? null,
        gcNotifiedAt: op.gcNotifiedAt ?? null,
        changeOrderId: null,
      },
    ]);
    await enqueue(op);
    await sync();
  };

  return (
    <View style={styles.screen}>
      <JobSections jobId={jobId} active="reports" />
      {pending > 0 ? <Text style={styles.pending}>Pending sync: {pending}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <RefusedBanner refused={refused} onDismiss={dismissRefused} onRetry={retrySetAside} />

      <List
        data={daysOf(reports, [...delays, ...optimisticDelays])}
        keyExtractor={(item) => item.date}
        renderItem={({ item }) => (
          <Card>
            <View style={styles.head}>
              <Text style={styles.date}>{item.date}</Text>
              {item.report?.lockState ? (
                <Text style={styles.locked}>{item.report.lockState === "APPROVED" ? "Approved" : "Signed"} · locked</Text>
              ) : null}
            </View>
            {item.report ? (
              <>
                {item.report.manpowerLine ? <Text style={styles.meta}>Crew: {item.report.manpowerLine}</Text> : null}
                <Text style={styles.work}>{item.report.workPerformed}</Text>
                {item.report.crewPresent ? <Text style={styles.meta}>Also on site: {item.report.crewPresent}</Text> : null}
                {item.report.weatherLine ? (
                  <Text style={styles.meta}>
                    Weather{item.report.weatherKind === "forecast" ? " (forecast)" : ""}: {item.report.weatherLine}
                  </Text>
                ) : null}
                {item.report.weather ? (
                  <Text style={styles.meta}>
                    {item.report.weatherLine ? "Site conditions" : "Weather"}: {item.report.weather}
                  </Text>
                ) : null}
                {item.report.delays ? <Text style={styles.delayText}>Delays: {item.report.delays}</Text> : null}
              </>
            ) : (
              <Text style={styles.meta}>No report filed for this day.</Text>
            )}
            {item.delays.map((d) => (
              <View key={d.id} style={styles.delay}>
                {d.id.startsWith("local-") ? <Text style={styles.syncing}>Syncing…</Text> : null}
                <Text style={styles.delayTitle}>
                  Delay · {d.causeLabel} · {d.responsibleLabel}
                  {d.responsibleName ? ` (${d.responsibleName})` : ""}
                </Text>
                <Text style={styles.meta}>{d.description}</Text>
                {d.hoursLost || d.start ? (
                  <Text style={styles.meta}>
                    {[d.start || d.end ? `${d.start ?? "?"}–${d.end ?? "?"}` : null, d.hoursLost ? `${d.hoursLost} crew-hours` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                ) : null}
                <Text style={d.gcNotifiedHow ? styles.meta : styles.delayText}>
                  {d.gcNotifiedHow ? `GC told by ${d.gcNotifiedHow.toLowerCase().replace("_", " ")}${d.gcNotifiedWho ? ` (${d.gcNotifiedWho})` : ""}` : "GC not told yet"}
                </Text>
              </View>
            ))}
          </Card>
        )}
        emptyTitle="No reports yet"
        emptyDescription="Tap “New report” to file the day's work. The crew and the weather fill in on their own."
      />

      <View style={[styles.footer, styles.footerRow]}>
        <Button variant="secondary" onPress={openDelay}>
          Log a delay
        </Button>
        <View style={styles.footerMain}>
          <Button
            fullWidth
            onPress={() => {
              setReportDate(today);
              setShowReport(true);
            }}
          >
            New report
          </Button>
        </View>
      </View>

      <Sheet
        visible={showReport}
        onClose={() => setShowReport(false)}
        title="New daily report"
        primaryLabel="File report"
        onPrimary={submitReport}
        primaryDisabled={!canFile}
      >
        <DateField label="Date" value={reportDate} onChange={setReportDate} max={today} />
        {reportProblem ? <Text style={styles.problem}>{reportProblem}</Text> : null}
        <Field label="Work performed" placeholder="What got done" value={workPerformed} onChangeText={setWorkPerformed} multiline />
        <Field
          label="Other trades / visitors on site"
          placeholder="Optional — e.g. electricians on L3, inspector at 10"
          value={otherTrades}
          onChangeText={setOtherTrades}
        />
        <Field
          label="Site conditions"
          placeholder="Optional — the weather fills in on its own"
          value={conditions}
          onChangeText={setConditions}
        />
        <Text style={styles.hint}>
          The crew comes from the day&rsquo;s logged hours and the weather from the job&rsquo;s site address. Log delays
          separately so each has a cause and crew-hours.
        </Text>
      </Sheet>

      <Sheet
        visible={showDelay}
        onClose={() => setShowDelay(false)}
        title="Log a delay"
        primaryLabel="Save delay"
        onPrimary={submitDelay}
        primaryDisabled={!canLogDelay}
      >
        <DateField label="Date" value={delayDate} onChange={setDelayDate} max={today} />
        {delayDayLocked ? <Text style={styles.problem}>{delayDate} is signed, so its delays are locked.</Text> : null}
        <Text style={styles.label}>Cause</Text>
        <View style={styles.chips}>
          {CAUSES.map(([value, label]) => (
            <Chip key={value} label={label} selected={cause === value} onPress={() => setCause(value)} />
          ))}
        </View>
        <Text style={styles.label}>Caused by</Text>
        <View style={styles.chips}>
          {PARTIES.map(([value, label]) => (
            <Chip key={value} label={label} selected={party === value} onPress={() => setParty(value)} />
          ))}
        </View>
        <Field label="Who, by name" placeholder="Optional — e.g. Acme Electric" value={partyName} onChangeText={setPartyName} />
        <Field label="What happened" placeholder="What stopped the work" value={what} onChangeText={setWhat} multiline />
        <View style={styles.row}>
          <View style={styles.half}>
            <Field label="From" placeholder="7:30" value={from} onChangeText={setFrom} />
          </View>
          <View style={styles.half}>
            <Field label="To" placeholder="10:00" value={to} onChangeText={setTo} />
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.half}>
            <Field label="Workers affected" placeholder="4" value={workers} onChangeText={setWorkers} keyboardType="number-pad" />
          </View>
          <View style={styles.half}>
            <Field
              label="Crew-hours lost"
              placeholder="Worked out"
              value={hoursLost}
              onChangeText={setHoursLost}
              keyboardType="decimal-pad"
            />
          </View>
        </View>
        <Text style={styles.label}>GC told?</Text>
        <View style={styles.chips}>
          <Chip label="Not yet" selected={told === null} onPress={() => setTold(null)} />
          {METHODS.map(([value, label]) => (
            <Chip key={value} label={label} selected={told === value} onPress={() => setTold(value)} />
          ))}
        </View>
        {told ? <Field label="Told who" placeholder="e.g. Sam, the super" value={toldWho} onChangeText={setToldWho} /> : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  pending: { color: colors.link, padding: 16, paddingBottom: 0, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
  error: { color: colors.tagRoseInk, padding: 16, paddingBottom: 0, fontSize: typography.size.sm },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  date: { color: colors.ink, fontSize: typography.size.md, fontWeight: typography.weight.semibold },
  locked: { color: colors.link, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
  work: { color: colors.inkBody, fontSize: typography.size.md, marginTop: 2 },
  meta: { color: colors.inkMuted, fontSize: typography.size.sm, marginTop: 2 },
  delay: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.lineRow },
  syncing: { color: colors.inkMuted, fontSize: typography.size.sm, fontStyle: "italic" },
  delayTitle: { color: colors.ink, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
  delayText: { color: colors.tagRoseInk, fontSize: typography.size.sm, marginTop: 2 },
  label: { color: colors.inkLabel, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
  hint: { color: colors.inkMuted, fontSize: typography.size.sm },
  problem: { color: colors.tagRoseInk, fontSize: typography.size.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  row: { flexDirection: "row", gap: 8 },
  half: { flex: 1 },
  footer: { padding: 16, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.lineRow },
  footerRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  footerMain: { flex: 1 },
});
