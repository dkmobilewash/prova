import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Field } from "@/components/Field";
import { List } from "@/components/List";
import { Sheet } from "@/components/Sheet";
import { colors, typography } from "@/lib/theme";
import { useFieldReports } from "@/lib/use-field-reports";

export default function ReportsScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { reports, pending, error, create } = useFieldReports(jobId ?? "");
  const [showForm, setShowForm] = useState(false);
  const [reportDate, setReportDate] = useState("");
  const [workPerformed, setWorkPerformed] = useState("");

  const submit = () => {
    if (!reportDate || !workPerformed) return;
    create({ reportDate, workPerformed, crewPresent: null, weather: null, delays: null });
    setWorkPerformed("");
    setShowForm(false);
  };

  return (
    <View style={styles.screen}>
      {pending > 0 ? <Text style={styles.pending}>Pending sync: {pending}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <List
        data={reports}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Card>
            <Text style={styles.date}>{item.reportDate}</Text>
            <Text style={styles.work}>{item.workPerformed}</Text>
            {item.crewPresent ? <Text style={styles.crew}>Crew: {item.crewPresent}</Text> : null}
          </Card>
        )}
        emptyTitle="No reports yet"
        emptyDescription="Tap “Add report” to file the day's work."
      />

      <View style={styles.footer}>
        <Button fullWidth onPress={() => setShowForm(true)}>
          Add report
        </Button>
      </View>

      <Sheet
        visible={showForm}
        onClose={() => setShowForm(false)}
        title="Add field report"
        primaryLabel="Add report"
        onPrimary={submit}
      >
        <Field label="Date" placeholder="YYYY-MM-DD" value={reportDate} onChangeText={setReportDate} />
        <Field
          label="Work performed"
          placeholder="What got done"
          value={workPerformed}
          onChangeText={setWorkPerformed}
          multiline
        />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  pending: { color: colors.link, padding: 16, paddingBottom: 0, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
  error: { color: colors.tagRoseInk, padding: 16, paddingBottom: 0, fontSize: typography.size.sm },
  date: { color: colors.ink, fontSize: typography.size.md, fontWeight: typography.weight.semibold, marginBottom: 4 },
  work: { color: colors.inkBody, fontSize: typography.size.md },
  crew: { color: colors.inkBody, fontSize: typography.size.sm, marginTop: 4 },
  footer: { padding: 16, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.lineRow },
});
