import { StyleSheet, TextInput, View } from "react-native";
import { Icon } from "@/components/Icon";
import { hitTarget, radius, space, typography, type Palette } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

/**
 * THE FILTER FIELD AT THE TOP OF A LIST, from the reference design: a
 * sunken rounded field with a glyph and placeholder text.
 *
 * The reference's is a static mock — a `div` that cannot be typed into.
 * This one filters, because a search bar that does not search is the same
 * class of thing as its donut that does not measure.
 *
 * Sunken rather than outlined: `railHover` is the palette's pressed/inset
 * tone, so this reads as a well cut into the page rather than another card
 * sitting on it. On a page of cards that distinction is what stops the
 * field looking like the first row of the list.
 */
export function SearchBar({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
}) {
  const p = usePalette();
  const s = makeStyles(p);

  return (
    <View style={s.bar}>
      <Icon name="jobs" size={18} color={p.colors.inkMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={p.colors.inkMuted}
        style={s.input}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
        returnKeyType="search"
        accessibilityLabel={placeholder}
      />
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    bar: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.xs,
      minHeight: hitTarget,
      paddingHorizontal: space.controlX,
      borderRadius: radius.field,
      backgroundColor: p.colors.railHover,
    },
    input: {
      flex: 1,
      color: p.colors.ink,
      fontSize: typography.size.md,
      paddingVertical: space.control,
    },
  });
}
