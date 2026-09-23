import { useMemo } from "react";
import { StyleSheet, Text } from "react-native";
import { router } from "expo-router";
import { Button } from "@/components/Button";
import { GroupedList } from "@/components/GroupedList";
import { GroupedRow } from "@/components/GroupedRow";
import { Icon } from "@/components/Icon";
import { Sheet } from "@/components/Sheet";
import type { CurrentJob } from "@/lib/current-job";
import type { IconName } from "@/lib/icon-glyphs";
import { type Palette, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

/**
 * The capture sheet — the old Create tab and Camera tab collapsed into one
 * quick action, Photo on top. Everything here gets filed against the
 * CURRENT job, so none of these ask which job first (same contract the
 * Create tab had). The Photo row carries `?open=camera`, so the shutter
 * is two taps from anywhere in the app.
 */
const THINGS: { icon: IconName; title: string; subtitle: string; path: string }[] = [
  { icon: "photos", title: "Photo", subtitle: "Stamped with time and place", path: "photos" },
  { icon: "report", title: "Field report", subtitle: "What got done today", path: "reports" },
  { icon: "time", title: "Time", subtitle: "Hours for the crew", path: "time" },
  { icon: "punch", title: "Punch item", subtitle: "Something that needs fixing", path: "punch-list" },
  { icon: "safety", title: "Safety", subtitle: "Toolbox talk or an incident", path: "safety" },
  { icon: "materials", title: "Material order", subtitle: "What to get on site", path: "materials" },
  { icon: "ticket", title: "T&M ticket", subtitle: "Signed time and materials", path: "ticket" },
];

export function CaptureSheet({
  visible,
  onClose,
  job,
}: {
  visible: boolean;
  onClose: () => void;
  job: CurrentJob | null;
}) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  const open = (path: string) => {
    onClose();
    if (!job) return;
    if (path === "photos") router.push(`/photos/${job.id}?open=camera`);
    else router.push(`/${path}/${job.id}`);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Capture">
      {!job ? (
        <>
          <Text style={styles.empty}>
            Pick a job first — everything here gets filed against one, and guessing which is how a
            photo ends up on the wrong site.
          </Text>
          <Button
            fullWidth
            onPress={() => {
              onClose();
              router.navigate("/(tabs)/jobs");
            }}
          >
            Pick a job
          </Button>
        </>
      ) : (
        <GroupedList>
          {THINGS.map((thing, i) => (
            <GroupedRow
              key={thing.path}
              icon={<Icon name={thing.icon} />}
              title={thing.title}
              subtitle={thing.subtitle}
              divider={i > 0}
              onPress={() => open(thing.path)}
            />
          ))}
        </GroupedList>
      )}
    </Sheet>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    empty: {
      color: p.colors.inkBody,
      fontSize: typography.size.md,
      lineHeight: 24,
      paddingVertical: space.xs,
    },
  });
}
