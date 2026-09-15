import { useAuth } from "@clerk/expo";
import { useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import { FlatList, Image, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { colors } from "@/lib/theme";
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
    load();
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
    <View style={{ flex: 1, backgroundColor: colors.canvas, padding: 16, gap: 12 }}>
      <Button variant="primary" onPress={pick}>
        Add photo
      </Button>
      {error ? <Text style={{ color: colors.tagRoseInk }}>{error}</Text> : null}
      <FlatList
        data={media}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ gap: 12 }}
        renderItem={({ item }) => (
          <Card>
            {item.blobUrl ? (
              <Image
                source={{ uri: item.blobUrl }}
                style={{ width: "100%", height: 200, borderRadius: 6, marginBottom: 8 }}
              />
            ) : null}
            {item.caption ? <Text style={{ color: colors.ink, marginBottom: 4 }}>{item.caption}</Text> : null}
            <Text style={{ color: colors.inkMuted }}>
              {new Date(item.capturedAt).toLocaleString()}
            </Text>
          </Card>
        )}
      />
    </View>
  );
}
