import { useMemo } from "react";
import { FlatList, RefreshControl, StyleSheet, type ListRenderItem } from "react-native";
import { EmptyState } from "@/components/EmptyState";
import { type Palette, space } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

/**
 * The one way this app renders a list: consistent spacing, pull-to-refresh
 * when `onRefresh` is given, and an `EmptyState` instead of a blank screen.
 * Screens stop hand-rolling `FlatList` + a stray "nothing here" paragraph.
 */
export function List<T>({
  data,
  renderItem,
  keyExtractor,
  refreshing,
  onRefresh,
  emptyTitle,
  emptyDescription,
  contentContainerStyle,
}: {
  data: readonly T[];
  renderItem: ListRenderItem<T>;
  keyExtractor: (item: T, index: number) => string;
  refreshing?: boolean;
  onRefresh?: () => void;
  emptyTitle: string;
  emptyDescription?: string;
  contentContainerStyle?: object;
}) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  return (
    <FlatList
      data={data}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      style={styles.list}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={!!refreshing}
            onRefresh={onRefresh}
            tintColor={palette.colors.inkMuted}
          />
        ) : undefined
      }
      contentContainerStyle={[
        styles.content,
        data.length === 0 && styles.empty,
        contentContainerStyle,
      ]}
      ListEmptyComponent={<EmptyState title={emptyTitle} description={emptyDescription} />}
    />
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    list: { flex: 1 },
    content: { gap: space.sm, padding: space.md },
    empty: { flexGrow: 1, justifyContent: "center" },
  });
}
