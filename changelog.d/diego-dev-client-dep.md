### The phone project declares expo-dev-client (Diego)
`diego/dev-client-dep`

`eas build --profile development` refuses to build a development client for a
project that does not depend on `expo-dev-client`, and this one never did —
the dependency that makes the installed app connect to Metro was missing from
`package.json`. Found when building the new client that #354's native modules
(location, file system, view-shot) need.

No app code changes.
