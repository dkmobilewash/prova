import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { FlatList, Text, TextInput, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { colors } from "@/lib/theme";
import { useFieldReports } from "@/lib/use-field-reports";

export default function ReportsScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { reports, pending, error, create } = useFieldReports(jobId ?? "");
  const [reportDate, setReportDate] = useState("");
  const [workPerformed, setWorkPerformed] = useState("");

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, padding: 16, gap: 12 }}>
      <Text style={{ color: colors.inkMuted }}>Pending sync: {pending}</Text>
      {error ? <Text style={{ color: colors.tagRoseInk }}>{error}</Text> : null}

      <TextInput
        placeholder="Date (YYYY-MM-DD)"
        placeholderTextColor={colors.inkMuted}
        value={reportDate}
        onChangeText={setReportDate}
        style={inputStyle}
      />
      <TextInput
        placeholder="Work performed"
        placeholderTextColor={colors.inkMuted}
        value={workPerformed}
        onChangeText={setWorkPerformed}
        multiline
        style={[inputStyle, { minHeight: 60, textAlignVertical: "top" }]}
      />
      <Button
        variant="primary"
        onPress={() => {
          if (!reportDate || !workPerformed) return;
          create({ reportDate, workPerformed, crewPresent: null, weather: null, delays: null });
          setWorkPerformed("");
        }}
      >
        Add report
      </Button>

      <FlatList
        data={reports}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ gap: 12 }}
        renderItem={({ item }) => (
          <Card>
            <Text style={{ fontWeight: "600", color: colors.ink, marginBottom: 4 }}>{item.reportDate}</Text>
            <Text style={{ color: colors.inkBody }}>{item.workPerformed}</Text>
            {item.crewPresent ? <Text style={{ color: colors.inkBody }}>Crew: {item.crewPresent}</Text> : null}
          </Card>
        )}
      />
    </View>
  );
}

const inputStyle = {
  borderWidth: 1,
  borderColor: colors.lineCard,
  backgroundColor: colors.surface,
  borderRadius: 6,
  padding: 10,
  color: colors.ink,
};
