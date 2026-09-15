import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { useFieldReports } from "@/lib/use-field-reports";

export default function ReportsScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { reports, pending, error, create } = useFieldReports(jobId ?? "");
  const [reportDate, setReportDate] = useState("");
  const [workPerformed, setWorkPerformed] = useState("");

  return (
    <View style={{ padding: 16, gap: 12, flex: 1 }}>
      <Text>Pending sync: {pending}</Text>
      {error ? <Text style={{ color: "#b00" }}>{error}</Text> : null}

      <TextInput
        placeholder="Date (YYYY-MM-DD)"
        value={reportDate}
        onChangeText={setReportDate}
        style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 6, padding: 10 }}
      />
      <TextInput
        placeholder="Work performed"
        value={workPerformed}
        onChangeText={setWorkPerformed}
        multiline
        style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 6, padding: 10, minHeight: 60 }}
      />
      <Pressable
        onPress={() => {
          if (!reportDate || !workPerformed) return;
          create({
            reportDate,
            workPerformed,
            crewPresent: null,
            weather: null,
            delays: null,
          });
          setWorkPerformed("");
        }}
        style={{ backgroundColor: "#111", borderRadius: 6, padding: 12 }}
      >
        <Text style={{ color: "#fff", textAlign: "center" }}>Add report</Text>
      </Pressable>

      <FlatList
        data={reports}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#eee" }}>
            <Text style={{ fontWeight: "600" }}>{item.reportDate}</Text>
            <Text>{item.workPerformed}</Text>
            {item.crewPresent ? <Text>Crew: {item.crewPresent}</Text> : null}
          </View>
        )}
      />
    </View>
  );
}
