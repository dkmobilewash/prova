### Push notifications to the phone (Diego)
`diego/push-notifications`

The phone could write to the office, but the office couldn't reach the phone
— a foreman learned they'd been put on a job by opening the schedule.
Real-time push closes that loop: the app registers its Expo push token per
signed-in user (`DeviceToken`, upserted on every open), and `assignCrewMember`
now pushes "You're assigned to …" the moment the assignment lands.

The send half is a new `expo-push` sender in `@prova/integrations` (the same
never-throw-for-a-missing-key contract as email), and a `pushToUser` helper
that best-effort pushes to every device a user has. Wiring `EXPO_ACCESS_TOKEN`
and a native build (push does not work in Expo Go) is the remaining
deployment step. Checked by typecheck/lint; delivery is not exercised here
without the token.
