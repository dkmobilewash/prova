import type { ListRenderItem } from "react-native";
import { FlatList, RefreshControl, StyleSheet } from "react-native";
import { colors } from "@/lib/theme";
import { EmptyState } from "./EmptyState";

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
  return (
    <FlatList
      data={data}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      style={styles.list}
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.inkMuted} />
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

const styles = StyleSheet.create({
  list: { flex: 1 },
  content: { gap: 12, padding: 16 },
  empty: { flexGrow: 1, justifyContent: "center" },
});
