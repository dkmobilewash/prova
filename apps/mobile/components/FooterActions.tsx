import { useMemo, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { hitTargetPrimary, type Palette, space } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

/**
 * THE ROW OF ACTIONS AT THE BOTTOM OF A SCREEN, AND THE REASON IT IS A
 * COMPONENT RATHER THAN THREE COPIES OF A STYLE.
 *
 * Found on a real iPhone on 2026-09-26, the first night the app was on one.
 * `app/time/[jobId].tsx` laid its footer out by hand:
 *
 *     <View style={[styles.footer, styles.footerRow]}>   // row, gap 8
 *       <Button variant="secondary">Sign the day</Button>
 *       <Button variant="secondary">Hand phone over</Button>
 *       <View style={styles.footerMain}>                 // flex: 1
 *         <Button fullWidth>Log time</Button>
 *       </View>
 *     </View>
 *
 * React Native defaults `flexShrink` to 0, so the two secondaries hold their
 * intrinsic width and the `flex: 1` primary — which is `flexBasis: 0,
 * flexShrink: 1` — absorbs the whole deficit. "Log time", the action the
 * screen exists for, rendered **40pt wide with no visible label**, against a
 * 48pt floor this repo enforces everywhere else. The empty state on that same
 * screen reads "Tap 'Log time' to record the day's hours", naming a button it
 * had clipped out of existence.
 *
 * THE PATTERN WAS NOT WRONG — IT WAS UNGUARDED AT A CAPACITY NOBODY NAMED.
 * `photos` and `reports` use the identical three styles and are fine, which
 * was confirmed on the device the same night: they pass ONE secondary. It
 * works at one and fails at two, silently, with nothing in between to say so.
 * That is why this is a component: the capacity is now the component's
 * problem instead of each caller's, and `footerActionsCensus.test.ts` keeps
 * it the only implementation.
 *
 * WHAT IT DOES. One secondary or none: a single row, primary taking the rest.
 * Two or more: the secondaries get their own row and the primary gets a full
 * width of its own underneath. That is the same rule read at two capacities —
 * the primary is never the control that pays for somebody else's label.
 *
 * NO TEST IN THIS REPO CAN SEE THIS. The screen suite renders in happy-dom,
 * which does no layout and returns zeros from `getBoundingClientRect` — the
 * same blindness that shipped a 1.35-POINT line height on five screens. The
 * 40pt above was measured off a real phone, and the fix was measured in real
 * Chromium against that number as its control. The census is a COUNT standing
 * in for a width, exactly as `rowActionsCensus.test.ts` caps a delete label at
 * 12 characters for the same reason.
 */
export function FooterActions({
  secondary = [],
  children,
}: {
  /** The lesser actions. Pass them as an array so the count is a fact the
   *  component can act on rather than something a caller has to remember. */
  secondary?: ReactNode[];
  /** The one action the screen exists for. Always full width of its row. */
  children: ReactNode;
}) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  // Two or more secondaries cannot share a row with the primary at any phone
  // width — that is the defect this file exists for. Stack instead.
  const stacked = secondary.length > 1;

  return (
    <View style={styles.footer}>
      {stacked ? (
        <View style={styles.stack}>
          <View style={styles.row}>
            {secondary.map((node, i) => (
              <View key={i} style={styles.share}>
                {node}
              </View>
            ))}
          </View>
          <View style={styles.main}>{children}</View>
        </View>
      ) : (
        <View style={styles.row}>
          {secondary.map((node, i) => (
            <View key={i}>{node}</View>
          ))}
          <View style={styles.main}>{children}</View>
        </View>
      )}
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    footer: {
      padding: space.md,
      paddingTop: space.xs,
      borderTopWidth: 1,
      borderTopColor: p.colors.lineRow,
    },
    stack: { gap: space.xs },
    row: { flexDirection: "row", gap: space.xs, alignItems: "center" },
    /** Equal thirds among the stacked secondaries, so one long label cannot
     *  crowd its neighbour the way both crowded the primary. */
    share: { flex: 1 },
    /** The primary takes the rest of its row — and on the stacked layout that
     *  row holds nothing else, so `flex: 1` is a full width rather than a
     *  leftover. `minHeight` belongs to Button; the floor that was missing
     *  here was the horizontal one. */
    main: { flex: 1, minHeight: hitTargetPrimary, justifyContent: "center" },
  });
}
