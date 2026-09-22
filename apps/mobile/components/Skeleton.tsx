import { useEffect, useState } from "react";
import { Animated, StyleSheet } from "react-native";
import { usePalette } from "@/lib/use-palette";
import { type Palette, radius } from "@/lib/theme";

/**
 * A loading block that keeps the layout's shape while data arrives, so a
 * list never collapses into a spinner and then pops open. Core Animated
 * opacity pulse — the one place a loop is justified, because it replaces
 * motion the user can feel, not motion for its own sake.
 */
export function Skeleton({
  style,
  height,
  width,
}: {
  style?: object;
  height?: number;
  width?: number | `${number}%`;
}) {
  const palette = usePalette();
  const styles = makeStyles(palette);
  // Made once, never replaced — useState rather than a ref read during
  // render, for the reason PressableScale gives.
  const [opacity] = useState(() => new Animated.Value(0.4));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.8, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return <Animated.View style={[styles.block, { height, width }, style, { opacity }]} />;
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    block: {
      backgroundColor: p.colors.lineCard,
      borderRadius: radius.card,
    },
  });
}
