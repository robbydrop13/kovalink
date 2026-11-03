# Targets set aside

`watch-widget` (the watch complication) is out of the build until the App ID
`io.claap.kovalink.watch.widget` is assigned the `group.io.claap.kovalink` App Group on the
Apple developer portal (only the Account Holder or an Admin can do it; the API cannot).
Without it, the AppStore profile lacks the group and Xcode refuses to sign the target.

To bring it back: `git mv app/targets-off/watch-widget app/targets/watch-widget`, point
`SWIFT_WIDGET_TARGET` in `packages/protocol/scripts/gen-tokens.mjs` back to `targets/`,
then build.
