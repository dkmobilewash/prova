import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * The screens, rendered — the suite that would have caught three rounds
 * of "the offline note doesn't show up".
 *
 * `vitest.config.mts` beside this one is deliberately pure logic in node,
 * and every offline defect so far slipped past it for the same reason:
 * the logic was right and the SCREEN still showed nothing. A cached read
 * that resolves correctly into a component nobody mounted proves the read,
 * not the page.
 *
 * So this project mounts the real screen files with react-native-web and
 * react-dom, in happy-dom, with the API rejecting the way a phone with no
 * signal does — and asserts the sentence a foreman is supposed to see is
 * on the page. No simulator, no device, ~1s.
 *
 * It is NOT a substitute for the phone. It cannot see native modules,
 * layout, the keyboard, or anything Metro does differently. It answers
 * exactly one question, which is the one that kept being answered wrong:
 * does this screen say what it knows.
 */
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "happy-dom",
    include: ["screens/**/*.test.tsx"],
    setupFiles: ["./screens/setup.tsx"],
    exclude: ["node_modules/**"],
  },
  resolve: {
    alias: [
      // The screens import "react-native"; react-native-web is the same
      // component API over the DOM, and is already a dependency here
      // (expo's web target uses it).
      { find: /^react-native$/, replacement: "react-native-web" },
      { find: "@", replacement: fileURLToPath(new URL("./", import.meta.url)) },
    ],
  },
});
