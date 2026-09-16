import { useAuth } from "@clerk/expo";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { colors } from "@/lib/theme";
import * as api from "@/lib/api";
import type { MaterialOrder, Vendor } from "@/lib/types";

export default function MaterialsScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { getToken } = useAuth();
  const [orders, setOrders] = useState<MaterialOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState("");
  const [orderedOn, setOrderedOn] = useState("");
  const [promisedFor, setPromisedFor] = useState("");
  const [vendorId, setVendorId] = useState<string | null>(null);

  const load = async () => {
    const token = await getToken();
    if (!token || !jobId) return;
    try {
      const [os, vs] = await Promise.all([api.listMaterialOrders(jobId, token), api.listVendors(token)]);
      setOrders(os);
      setVendors(vs);
      if (!vendorId && vs.length > 0) setVendorId(vs[0].id);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load orders");
    }
  };

  useEffect(() => {
    (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const submit = async () => {
    const token = await getToken();
    if (!token || !jobId || !description || !orderedOn || !vendorId) return;
    try {
      await api.createMaterialOrder(
        jobId,
        {
          description,
          orderedOn,
          vendorId,
          ...(promisedFor ? { promisedFor } : {}),
        },
        token,
      );
      setDescription("");
      setOrderedOn("");
      setPromisedFor("");
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add order");
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.canvas, padding: 16 }}>
      {error ? <Text style={{ color: colors.tagRoseInk, marginBottom: 12 }}>{error}</Text> : null}

      <Button variant="secondary" onPress={() => setShowForm((v) => !v)}>
        {showForm ? "Cancel" : "Add order"}
      </Button>
      {showForm ? (
        <View style={{ gap: 8, marginBottom: 12 }}>
          <TextInput placeholder="What was ordered" placeholderTextColor={colors.inkMuted} value={description} onChangeText={setDescription} style={inputStyle} />
          <TextInput placeholder="Date ordered (YYYY-MM-DD)" placeholderTextColor={colors.inkMuted} value={orderedOn} onChangeText={setOrderedOn} style={inputStyle} />
          <TextInput placeholder="Promised for (YYYY-MM-DD)" placeholderTextColor={colors.inkMuted} value={promisedFor} onChangeText={setPromisedFor} style={inputStyle} />
          <Text style={{ color: colors.inkLabel }}>Vendor</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {vendors.map((v) => (
              <Pressable
                key={v.id}
                onPress={() => setVendorId(v.id)}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 6,
                  backgroundColor: vendorId === v.id ? colors.brand : colors.surface,
                  borderWidth: 1,
                  borderColor: colors.lineCard,
                }}
              >
                <Text style={{ color: vendorId === v.id ? "#ffffff" : colors.inkBody }}>{v.name}</Text>
              </Pressable>
            ))}
          </View>
          <Button variant="primary" onPress={submit}>Save order</Button>
        </View>
      ) : null}

      {orders.map((o) => (
        <Card key={o.id} style={{ marginBottom: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: colors.ink, fontWeight: "600" }}>#{o.number}</Text>
            <Text style={{ color: colors.inkMuted }}>{o.vendorName}</Text>
          </View>
          <Text style={{ color: colors.ink }}>{o.description}</Text>
          <Text style={{ color: colors.inkMuted }}>
            Ordered {o.orderedOn}
            {o.promisedFor ? ` · due ${o.promisedFor}` : ""}
          </Text>
        </Card>
      ))}
    </ScrollView>
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
