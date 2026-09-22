import { useState, type ReactNode } from "react";
import {
  Animated,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

/**
 * A Pressable that scales down 3% on press-in and springs back on release —
 * the app's whole pressed-feedback system, replacing opacity (which washes
 * the label out instead of answering the tap). Core `Animated` only: no
 * reanimated, no new dependency.
 *
 * `style` applies to the inner Animated view, so layout props (width,
 * alignSelf) go on the style you pass, exactly as they did on Pressable —
 * but as a plain StyleProp, not Pressable's function form (an Animated
 * view cannot consume a press-state function).
 */
export function PressableScale({
  children,
  style,
  disabled,
  onPress,
  onPressIn,
  onPressOut,
  ...rest
}: Omit<PressableProps, "style"> & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  // useState's lazy initialiser, not useRef(...).current: the value is made
  // once and never replaced, and reading a ref's `current` during render is
  // what react-hooks/refs refuses — CI's lint went red on exactly that.
  const [scale] = useState(() => new Animated.Value(1));

  const spring = (toValue: number) => {
    Animated.spring(scale, {
      toValue,
      useNativeDriver: true,
      speed: 40,
      bounciness: 0,
    }).start();
  };

  return (
    <Pressable
      {...rest}
      disabled={disabled}
      onPress={onPress}
      onPressIn={(e) => {
        if (!disabled) spring(0.97);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (!disabled) spring(1);
        onPressOut?.(e);
      }}
    >
      <Animated.View style={[{ transform: [{ scale }] }, style]}>{children}</Animated.View>
    </Pressable>
  );
}
