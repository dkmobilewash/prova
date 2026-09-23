import { useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Chip } from "@/components/Chip";
import { DateField } from "@/components/DateField";
import { Field } from "@/components/Field";
import { JobContextChip } from "@/components/JobContextChip";
import { List } from "@/components/List";
import { Sheet } from "@/components/Sheet";
import { SyncStatus } from "@/components/SyncStatus";
import * as api from "@/lib/api";
import { tokenOrNull } from "@/lib/clerk-token";
import { dayFromClockIn } from "@/lib/clock-session";
import { useT } from "@/lib/i18n";
import { uuid } from "@/lib/id";
import { enqueue, queuedOperationIds } from "@/lib/sync-queue";
import { JobSections } from "@/components/JobSections";
import { emptyFor } from "@/lib/empty-state";
import { NotYourJobFunction } from "@/components/NotYourJobFunction";
import { SCREEN_CAPABILITY, SCREEN_NOUN } from "@/lib/screen-capabilities";
import { holds } from "@/lib/capabilities";
import { useMe } from "@/lib/use-me";
import { type Palette, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";
import type { DelayRow, FieldReportRow } from "@/lib/types";
import { useFieldReports } from "@/lib/use-field-reports";
import { useStableGetToken } from "@/lib/use-stable-get-token";
import { useSync } from "@/lib/use-sync";

// The same choices the server accepts (lib/delays-core.ts on the web). The
// value is the server's; the second element is the KEY of what the chip
// says, so the choices read in the language the phone is set to while the
// value that goes up stays the enum the server takes.
const CAUSES = [
  ["WEATHER", "reports.cause.weather"],
  ["GC_SCHEDULE", "reports.cause.gcSchedule"],
  ["OTHER_TRADE", "reports.cause.otherTrade"],
  ["MATERIAL", "reports.cause.material"],
  ["INSPECTION", "reports.cause.inspection"],
  ["DESIGN_RFI", "reports.cause.designRfi"],
  ["SITE_ACCESS", "reports.cause.siteAccess"],
  ["EQUIPMENT", "reports.cause.equipment"],
  ["OTHER", "reports.cause.other"],
] as const;
const PARTIES = [
  ["GC", "reports.party.gc"],
  ["OWNER", "reports.party.owner"],
  ["OTHER_TRADE", "reports.party.otherTrade"],
  ["SUPPLIER", "reports.party.supplier"],
  ["OURSELVES", "reports.party.us"],
  ["NOBODY", "reports.party.nobody"],
] as const;
const METHODS = [
  ["PHONE", "reports.method.phone"],
  ["EMAIL", "reports.method.email"],
  ["TEXT", "reports.method.text"],
  ["IN_PERSON", "reports.method.inPerson"],
  ["MEETING", "reports.method.meeting"],
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
  const { t } = useT();
  const { me } = useMe();
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const getToken = useStableGetToken();
  const { reports, pending, error, offline, create, refresh } = useFieldReports(jobId ?? "");
  const [delays, setDelays] = useState<DelayRow[]>([]);
  // Delays logged on this phone that the server hasn't returned yet — shown
  // at once as "Syncing…" rather than appearing seconds after Save.
  const [optimisticDelays, setOptimisticDelays] = useState<(DelayRow & { clientOperationId: string })[]>([]);
  const today = dayFromClockIn(new Date().toISOString());

  const loadDelays = useCallback(async () => {
    // Delays are not cached, so this one genuinely has nothing to show
    // without a token — but it still must not sit on Clerk for two and a
    // half minutes offline (lib/clerk-token.ts).
    const token = await tokenOrNull(getToken);
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
      ? t("reports.problem.daySigned", { date: reportDate })
      : t("reports.problem.exists", { date: reportDate })
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
    const causeKey = CAUSES.find(([v]) => v === op.cause)?.[1];
    const causeText = causeKey ? t(causeKey) : op.cause;
    const partyKey = PARTIES.find(([v]) => v === op.responsibleParty)?.[1];
    const partyText = partyKey ? t(partyKey) : op.responsibleParty;
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

  // The server refuses this route to anybody without the
  // capability (see lib/screen-capabilities.ts, checked against the
  // route itself in its test). Saying so beats a 403 rendering as
  // an empty screen with no explanation.
  if (!holds(me, SCREEN_CAPABILITY["reports/[jobId]"])) return <NotYourJobFunction what={SCREEN_NOUN["reports/[jobId]"]} />;

  return (
    <View style={styles.screen}>
      <JobSections jobId={jobId} active="reports" />
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
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <List
        data={daysOf(reports, [...delays, ...optimisticDelays])}
        keyExtractor={(item) => item.date}
        renderItem={({ item }) => (
          <Card>
            <View style={styles.head}>
              <Text style={styles.date}>{item.date}</Text>
              {item.report?.lockState ? (
                <Text style={styles.locked}>
                  {t(item.report.lockState === "APPROVED" ? "reports.locked.approved" : "reports.locked.signed")}
                </Text>
              ) : null}
            </View>
            {item.report ? (
              <>
                {item.report.manpowerLine ? (
                  <Text style={styles.meta}>{t("reports.crew", { crew: item.report.manpowerLine })}</Text>
                ) : null}
                <Text style={styles.work}>{item.report.workPerformed}</Text>
                {item.report.crewPresent ? (
                  <Text style={styles.meta}>{t("reports.alsoOnSite", { who: item.report.crewPresent })}</Text>
                ) : null}
                {item.report.weatherLine ? (
                  <Text style={styles.meta}>
                    {item.report.weatherKind === "forecast"
                      ? t("reports.weatherForecast", { weather: item.report.weatherLine })
                      : t("reports.weather", { weather: item.report.weatherLine })}
                  </Text>
                ) : null}
                {item.report.weather ? (
                  <Text style={styles.meta}>
                    {item.report.weatherLine
                      ? t("reports.siteConditions", { conditions: item.report.weather })
                      : t("reports.weather", { weather: item.report.weather })}
                  </Text>
                ) : null}
                {item.report.delays ? (
                  <Text style={styles.delayText}>{t("reports.delays", { delays: item.report.delays })}</Text>
                ) : null}
              </>
            ) : (
              <Text style={styles.meta}>{t("reports.noReportForDay")}</Text>
            )}
            {item.delays.map((d) => (
              <View key={d.id} style={styles.delay}>
                {d.id.startsWith("local-") ? <Text style={styles.syncing}>{t("common.syncing")}</Text> : null}
                <Text style={styles.delayTitle}>
                  {t("reports.delay.headline", { cause: d.causeLabel, party: d.responsibleLabel })}
                  {d.responsibleName ? ` (${d.responsibleName})` : ""}
                </Text>
                <Text style={styles.meta}>{d.description}</Text>
                {d.hoursLost || d.start ? (
                  <Text style={styles.meta}>
                    {[
                      d.start || d.end ? `${d.start ?? "?"}–${d.end ?? "?"}` : null,
                      d.hoursLost ? t("reports.delay.crewHours", { count: d.hoursLost }) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                ) : null}
                <Text style={d.gcNotifiedHow ? styles.meta : styles.delayText}>
                  {d.gcNotifiedHow ? `${t("reports.delay.gcTold", { how: d.gcNotifiedHow.toLowerCase().replace("_", " ") })}${d.gcNotifiedWho ? ` (${d.gcNotifiedWho})` : ""}` : t("reports.delay.gcNotTold")}
                </Text>
              </View>
            ))}
          </Card>
        )}
        {...emptyFor(offline, "thing.reports", {
          title: "reports.empty.title",
          description: "reports.empty.body",
        })}
      />

      <View style={[styles.footer, styles.footerRow]}>
        <Button variant="secondary" onPress={openDelay}>
          {t("reports.delay.log")}
        </Button>
        <View style={styles.footerMain}>
          <Button
            fullWidth
            onPress={() => {
              setReportDate(today);
              setShowReport(true);
            }}
          >
            {t("reports.new")}
          </Button>
        </View>
      </View>

      <Sheet
        visible={showReport}
        onClose={() => setShowReport(false)}
        title={t("reports.sheet.title")}
        primaryLabel={t("reports.sheet.save")}
        onPrimary={submitReport}
        primaryDisabled={!canFile}
      >
        <DateField label={t("common.date")} value={reportDate} onChange={setReportDate} max={today} />
        {reportProblem ? <Text style={styles.problem}>{reportProblem}</Text> : null}
        <Field
          label={t("reports.field.work")}
          placeholder={t("reports.field.workHint")}
          value={workPerformed}
          onChangeText={setWorkPerformed}
          multiline
        />
        <Field
          label={t("reports.field.others")}
          placeholder={t("reports.field.othersHint")}
          value={otherTrades}
          onChangeText={setOtherTrades}
        />
        <Field
          label={t("reports.field.conditions")}
          placeholder={t("reports.field.conditionsHint")}
          value={conditions}
          onChangeText={setConditions}
        />
        <Text style={styles.hint}>{t("reports.sheet.hint")}</Text>
      </Sheet>

      <Sheet
        visible={showDelay}
        onClose={() => setShowDelay(false)}
        title={t("reports.delay.sheetTitle")}
        primaryLabel={t("reports.delay.save")}
        onPrimary={submitDelay}
        primaryDisabled={!canLogDelay}
      >
        <DateField label={t("common.date")} value={delayDate} onChange={setDelayDate} max={today} />
        {delayDayLocked ? (
          <Text style={styles.problem}>{t("reports.problem.delaysLocked", { date: delayDate })}</Text>
        ) : null}
        <Text style={styles.label}>{t("reports.field.cause")}</Text>
        <View style={styles.chips}>
          {CAUSES.map(([value, labelKey]) => (
            <Chip key={value} label={t(labelKey)} selected={cause === value} onPress={() => setCause(value)} />
          ))}
        </View>
        <Text style={styles.label}>{t("reports.field.causedBy")}</Text>
        <View style={styles.chips}>
          {PARTIES.map(([value, labelKey]) => (
            <Chip key={value} label={t(labelKey)} selected={party === value} onPress={() => setParty(value)} />
          ))}
        </View>
        <Field
          label={t("reports.field.who")}
          placeholder={t("reports.field.whoHint")}
          value={partyName}
          onChangeText={setPartyName}
        />
        <Field
          label={t("reports.field.what")}
          placeholder={t("reports.field.whatHint")}
          value={what}
          onChangeText={setWhat}
          multiline
        />
        <View style={styles.row}>
          <View style={styles.half}>
            <Field label={t("reports.field.from")} placeholder="7:30" value={from} onChangeText={setFrom} />
          </View>
          <View style={styles.half}>
            <Field label={t("reports.field.to")} placeholder="10:00" value={to} onChangeText={setTo} />
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.half}>
            <Field
              label={t("reports.field.workers")}
              placeholder="4"
              value={workers}
              onChangeText={setWorkers}
              keyboardType="number-pad"
            />
          </View>
          <View style={styles.half}>
            <Field
              label={t("reports.field.hoursLost")}
              placeholder={t("reports.field.hoursLostHint")}
              value={hoursLost}
              onChangeText={setHoursLost}
              keyboardType="decimal-pad"
            />
          </View>
        </View>
        <Text style={styles.label}>{t("reports.field.gcTold")}</Text>
        <View style={styles.chips}>
          <Chip label={t("reports.gcTold.notYet")} selected={told === null} onPress={() => setTold(null)} />
          {METHODS.map(([value, labelKey]) => (
            <Chip key={value} label={t(labelKey)} selected={told === value} onPress={() => setTold(value)} />
          ))}
        </View>
        {told ? (
          <Field
            label={t("reports.field.toldWho")}
            placeholder={t("reports.field.toldWhoHint")}
            value={toldWho}
            onChangeText={setToldWho}
          />
        ) : null}
      </Sheet>
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.colors.canvas },
    chipWrap: { padding: space.md, paddingBottom: 0 },
    error: { color: p.colors.tagRoseInk, padding: space.md, paddingBottom: 0, fontSize: typography.size.sm },
    head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
    date: { color: p.colors.ink, fontSize: typography.size.md, fontWeight: typography.weight.semibold },
    locked: { color: p.colors.link, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
    work: { color: p.colors.inkBody, fontSize: typography.size.md, marginTop: 2 },
    meta: { color: p.colors.inkMuted, fontSize: typography.size.sm, marginTop: 2 },
    delay: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: p.colors.lineRow },
    syncing: { color: p.colors.inkMuted, fontSize: typography.size.sm, fontStyle: "italic" },
    delayTitle: { color: p.colors.ink, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
    delayText: { color: p.colors.tagRoseInk, fontSize: typography.size.sm, marginTop: 2 },
    label: { color: p.colors.inkLabel, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
    hint: { color: p.colors.inkMuted, fontSize: typography.size.sm },
    problem: { color: p.colors.tagRoseInk, fontSize: typography.size.sm },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    row: { flexDirection: "row", gap: 8 },
    half: { flex: 1 },
    footer: { padding: space.md, paddingTop: space.xs, borderTopWidth: 1, borderTopColor: p.colors.lineRow },
    footerRow: { flexDirection: "row", gap: 8, alignItems: "center" },
    footerMain: { flex: 1 },
  });
}
