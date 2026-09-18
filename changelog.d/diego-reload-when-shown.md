### The phone's Time and T&M screens reload when you come back to them (Diego)
`diego/reload-when-shown`

They loaded once, when first opened. So entries deleted on the web stayed on
the phone's Time screen until you left it and came back. Found clicking #340.

Both screens now reload when you return to them, and when the app comes back
from the background while they're open (`useReloadWhenShown`, using
`useFocusEffect` and `AppState`).

Mobile only; no server change and no migration.
