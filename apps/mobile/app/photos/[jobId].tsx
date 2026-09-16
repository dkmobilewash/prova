import { useAuth } from "@clerk/expo";
import { useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { List } from "@/components/List";
import { colors, typography } from "@/lib/theme";
import * as api from "@/lib/api";
import type { Media } from "@/lib/types";

export default function PhotosScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { getToken } = useAuth();
  const [media, setMedia] = useState<Media[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const token = await getToken();
    if (!token || !jobId) return;
    try {
      setMedia(await api.listMedia(jobId, token));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load photos");
    }
  };

  useEffect(() => {
    (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const pick = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    const token = await getToken();
    if (!token || !jobId) return;

    const formData = new FormData();
    formData.append(
      "file",
      {
        uri: asset.uri,
        name: asset.fileName ?? "photo.jpg",
        type: asset.mimeType ?? "image/jpeg",
      } as unknown as Blob,
    );
    formData.append("capturedAt", new Date().toISOString());

    try {
      await api.uploadMedia(jobId, formData, token);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    }
  };

  return (
    <View style={styles.screen}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <List
        data={media}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Card>
            {item.blobUrl ? (
              <Image source={{ uri: item.blobUrl }} style={styles.image} />
            ) : null}
            {item.caption ? <Text style={styles.caption}>{item.caption}</Text> : null}
            <Text style={styles.timestamp}>
              {new Date(item.capturedAt).toLocaleString()}
            </Text>
          </Card>
        )}
        emptyTitle="No photos yet"
        emptyDescription="Tap “Add photo” to capture or upload one."
      />

      <View style={styles.footer}>
        <Button fullWidth onPress={pick}>
          Add photo
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  error: { color: colors.tagRoseInk, padding: 16, paddingBottom: 0, fontSize: typography.size.sm },
  image: { width: "100%", height: 200, borderRadius: 8, marginBottom: 8 },
  caption: { color: colors.ink, fontSize: typography.size.md, marginBottom: 4 },
  timestamp: { color: colors.inkMuted, fontSize: typography.size.sm },
  footer: { padding: 16, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.lineRow },
});
