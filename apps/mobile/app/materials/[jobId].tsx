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
import { cacheKeys } from "@/lib/cache-keys";
import { cachedRead, staleNote, withToken } from "@/lib/cached-read";
import { emptyFor } from "@/lib/empty-state";
import { OfflineNote } from "@/components/OfflineNote";
import { colors, typography } from "@/lib/theme";
import * as api from "@/lib/api";
import { uuid } from "@/lib/id";
import { enqueue } from "@/lib/sync-queue";
import { useSync } from "@/lib/use-sync";
import type { MaterialOrder, Vendor } from "@/lib/types";

export default function MaterialsScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { getToken } = useAuth();
  const [orders, setOrders] = useState<MaterialOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState<string | "nothing" | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState("");
  const [orderedOn, setOrderedOn] = useState("");
  const [promisedFor, setPromisedFor] = useState("");
  const [vendorId, setVendorId] = useState<string | null>(null);

  const load = async () => {
    if (!jobId) return;
    // The vendor list is cached with the orders rather than separately:
    // an order row is unreadable without the vendor names beside it.
    const result = await cachedRead(
      cacheKeys.materials(jobId),
      withToken(getToken, async (token) => ({
        orders: await api.listMaterialOrders(jobId, token),
        vendors: await api.listVendors(token),
      })),
    );
    setError(null);
    if (result.from === "nothing") {
      setOffline("nothing");
      return;
    }
    setOrders(result.value.orders);
    setVendors(result.value.vendors);
    if (!vendorId && result.value.vendors.length > 0) setVendorId(result.value.vendors[0].id);
    setOffline(staleNote(result));
  };

  useEffect(() => {
    (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const { pending, sync } = useSync(load);

  const submit = async () => {
    if (!jobId || !description || !orderedOn || !vendorId) return;
    setDescription("");
    setOrderedOn("");
    setPromisedFor("");
    setShowForm(false);
    await enqueue({
      type: "material:create",
      jobId,
      clientOperationId: uuid(),
      description,
      orderedOn,
      promisedFor: promisedFor || undefined,
      vendorId,
    });
    await sync();
  };

  return (
    <View style={styles.screen}>
      {pending > 0 ? <Text style={styles.pending}>Pending sync: {pending}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <OfflineNote state={offline} />
      <List
        data={orders}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Card>
            <View style={styles.orderHead}>
              <Text style={styles.number}>#{item.number}</Text>
              <Text style={styles.vendor}>{item.vendorName}</Text>
            </View>
            <Text style={styles.description}>{item.description}</Text>
            <Text style={styles.meta}>
              Ordered {item.orderedOn}
              {item.promisedFor ? ` · due ${item.promisedFor}` : ""}
            </Text>
          </Card>
        )}
        {...emptyFor(offline, "the material orders", {
          title: "Nothing on order",
          description: "Tap “Add order” to log a material delivery.",
        })}
      />

      <View style={styles.footer}>
        <Button fullWidth onPress={() => setShowForm(true)}>
          Add order
        </Button>
      </View>

      <Sheet
        visible={showForm}
        onClose={() => setShowForm(false)}
        title="Add material order"
        primaryLabel="Save order"
        onPrimary={submit}
      >
        <Field label="What was ordered" placeholder="e.g. 2x4 lumber" value={description} onChangeText={setDescription} />
        <Field label="Date ordered" placeholder="YYYY-MM-DD" value={orderedOn} onChangeText={setOrderedOn} />
        <Field label="Promised for" placeholder="YYYY-MM-DD (optional)" value={promisedFor} onChangeText={setPromisedFor} />
        <Text style={styles.vendorLabel}>Vendor</Text>
        <View style={styles.chips}>
          {vendors.map((v) => (
            <Chip key={v.id} label={v.name} selected={vendorId === v.id} onPress={() => setVendorId(v.id)} />
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
  orderHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  number: { color: colors.ink, fontSize: typography.size.md, fontWeight: typography.weight.bold },
  vendor: { color: colors.inkMuted, fontSize: typography.size.sm },
  description: { color: colors.ink, fontSize: typography.size.md, marginTop: 4 },
  meta: { color: colors.inkBody, fontSize: typography.size.sm, marginTop: 4 },
  vendorLabel: { color: colors.inkLabel, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  footer: { padding: 16, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.lineRow },
});
