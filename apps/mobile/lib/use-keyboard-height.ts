import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/**
 * How much of the screen the keyboard is covering right now, in points.
 *
 * The sheet is positioned against the bottom of the screen, which is the
 * right place for a thumb and the wrong place for a keyboard: on a real
 * phone the keyboard came up over the fields and you could not see what you
 * were typing. Reported from the site, 2026-09-20, on the punch list's
 * "Add item" form — but the sheet is shared, so it was every form on the
 * phone.
 *
 * `KeyboardAvoidingView` is the usual answer and does not apply here: it
 * pads a flex child, and the sheet is `position: absolute; bottom: 0`
 * inside a Modal. Lifting it by the keyboard's own height is the same idea
 * without the layout it assumes.
 *
 * iOS gets the `will` events so the sheet travels with the keyboard rather
 * than after it; Android only has the `did` pair.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const show = Keyboard.addListener(showEvent, (event) => {
      setHeight(event.endCoordinates?.height ?? 0);
    });
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}
