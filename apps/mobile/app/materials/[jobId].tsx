import { useAuth } from "@clerk/expo";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
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
import { cacheKeys } from "@/lib/cache-keys";
import { cachedRead, staleNote, withToken } from "@/lib/cached-read";
import { emptyFor } from "@/lib/empty-state";
import { useT } from "@/lib/i18n";
import { NotYourJobFunction } from "@/components/NotYourJobFunction";
import { SCREEN_CAPABILITY, SCREEN_NOUN } from "@/lib/screen-capabilities";
import { holds } from "@/lib/capabilities";
import { useMe } from "@/lib/use-me";
import { localToday } from "@/lib/local-today";
import { type Palette, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";
import * as api from "@/lib/api";
import { uuid } from "@/lib/id";
import { saveQueued } from "@/lib/save-queued";
import { useSync } from "@/lib/use-sync";
import type { MaterialOrder, Vendor } from "@/lib/types";

export default function MaterialsScreen() {
  const { t } = useT();
  const { me } = useMe();
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { getToken } = useAuth();
  const [orders, setOrders] = useState<MaterialOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState<string | "nothing" | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState("");
  const [orderedOn, setOrderedOn] = useState(localToday());
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

  const { pending, sync, refused, dismissRefused, retrySetAside } = useSync(load);

  const submit = async () => {
    if (!jobId || !description || !orderedOn || !vendorId) return;
    // Queued BEFORE the form is cleared — see lib/save-queued.ts.
    const saved = await saveQueued({
      type: "material:create",
      jobId,
      clientOperationId: uuid(),
      description,
      orderedOn,
      promisedFor: promisedFor || undefined,
      vendorId,
    });
    if (!saved.ok) {
      setError(saved.error);
      return;
    }
    setError(null);
    setDescription("");
    setOrderedOn(localToday());
    setPromisedFor("");
    setShowForm(false);
    await sync();
  };

  // The server refuses this route to anybody without the
  // capability (see lib/screen-capabilities.ts, checked against the
  // route itself in its test). Saying so beats a 403 rendering as
  // an empty screen with no explanation.
  if (!holds(me, SCREEN_CAPABILITY["materials/[jobId]"])) return <NotYourJobFunction what={SCREEN_NOUN["materials/[jobId]"]} />;

  return (
    <View style={styles.screen}>
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
              {t("materials.ordered", { date: item.orderedOn })}
              {item.promisedFor ? ` · ${t("materials.due", { date: item.promisedFor })}` : ""}
            </Text>
          </Card>
        )}
        {...emptyFor(offline, "thing.materials", {
          title: "materials.empty.title",
          description: "materials.empty.body",
        })}
      />

      <View style={styles.footer}>
        <Button fullWidth onPress={() => setShowForm(true)}>
          {t("materials.add")}
        </Button>
      </View>

      <Sheet
        visible={showForm}
        onClose={() => setShowForm(false)}
        title={t("materials.sheet.title")}
        primaryLabel={t("materials.sheet.save")}
        onPrimary={submit}
      >
        <Field
          label={t("materials.field.what")}
          placeholder={t("materials.field.whatHint")}
          value={description}
          onChangeText={setDescription}
        />
        <DateField label={t("materials.field.orderedOn")} value={orderedOn} onChange={setOrderedOn} max={localToday()} />
        <DateField
          label={t("materials.field.promisedFor")}
          value={promisedFor}
          onChange={setPromisedFor}
          max={localToday()}
          allowFuture
        />
        <Text style={styles.vendorLabel}>{t("materials.field.vendor")}</Text>
        <View style={styles.chips}>
          {vendors.map((v) => (
            <Chip key={v.id} label={v.name} selected={vendorId === v.id} onPress={() => setVendorId(v.id)} />
          ))}
        </View>
      </Sheet>
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.colors.canvas },
    chipWrap: { padding: space.md, paddingBottom: 0 },
    error: { color: p.colors.tagRoseInk, padding: space.md, paddingBottom: 0, fontSize: typography.size.sm },
    orderHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    number: { color: p.colors.ink, fontSize: typography.size.md, fontWeight: typography.weight.bold },
    vendor: { color: p.colors.inkMuted, fontSize: typography.size.sm },
    description: { color: p.colors.ink, fontSize: typography.size.md, marginTop: space.xxs },
    meta: { color: p.colors.inkBody, fontSize: typography.size.sm, marginTop: space.xxs },
    vendorLabel: { color: p.colors.inkLabel, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    footer: { padding: space.md, paddingTop: space.xs, borderTopWidth: 1, borderTopColor: p.colors.lineRow },
  });
}
