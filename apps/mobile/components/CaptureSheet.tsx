import { useMemo } from "react";
import { StyleSheet, Text } from "react-native";
import { router } from "expo-router";
import { Button } from "@/components/Button";
import { GroupedList } from "@/components/GroupedList";
import { GroupedRow } from "@/components/GroupedRow";
import { Icon } from "@/components/Icon";
import { Sheet } from "@/components/Sheet";
import type { CurrentJob } from "@/lib/current-job";
import { useT, type StringKey } from "@/lib/i18n";
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
// Keys rather than sentences: this table is module-level, so a literal
// here would be frozen in whatever language the app started in.
const THINGS: { icon: IconName; title: StringKey; subtitle: StringKey; path: string }[] = [
  { icon: "photos", title: "capture.photo", subtitle: "capture.photo.sub", path: "photos" },
  { icon: "report", title: "capture.report", subtitle: "capture.report.sub", path: "reports" },
  { icon: "time", title: "capture.time", subtitle: "capture.time.sub", path: "time" },
  { icon: "punch", title: "capture.punch", subtitle: "capture.punch.sub", path: "punch-list" },
  { icon: "safety", title: "capture.safety", subtitle: "capture.safety.sub", path: "safety" },
  { icon: "materials", title: "capture.materials", subtitle: "capture.materials.sub", path: "materials" },
  { icon: "ticket", title: "capture.ticket", subtitle: "capture.ticket.sub", path: "ticket" },
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
  const { t } = useT();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  const open = (path: string) => {
    onClose();
    if (!job) return;
    if (path === "photos") router.push(`/photos/${job.id}?open=camera`);
    else router.push(`/${path}/${job.id}`);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t("capture.title")}>
      {!job ? (
        <>
          <Text style={styles.empty}>{t("capture.pickFirst")}</Text>
          <Button
            fullWidth
            onPress={() => {
              onClose();
              router.navigate("/(tabs)/jobs");
            }}
          >
            {t("capture.pickJob")}
          </Button>
        </>
      ) : (
        <GroupedList>
          {THINGS.map((thing, i) => (
            <GroupedRow
              key={thing.path}
              icon={<Icon name={thing.icon} />}
              title={t(thing.title)}
              subtitle={t(thing.subtitle)}
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
