# App controls: toggle keys that follow an app

**Asked:** Discord's mute, deafen, camera and screen share as toggle buttons,
"so i can put my own stuff on and off states".

**Decided:** one general action, `{ kind: "app"; app: IntegrationId; control:
string }`, checked against the app's declared `controls`. The alternative was a
Discord-only action kind (`{ kind: "discord", control }`). The general one
lets OBS offer a "Record" toggle, or any later app its own controls, with no new
action kind.

- A toggle with one does not flip on a press. `AppControls` sets every such key
  to `service.controlState(control)` whenever the app says something changed,
  and the page shown gets `STATE`.
- The press goes to `service.press(control)` from `Workspace.runKey`, as pages
  go to navigation. The runner never sees it (`isStep`).
- Picking a control makes a toggle at once. OFF is the app at rest (Mic); ON
  is the control's `on` look (Muted, red).

**What it constrains:** profiles now hold `kind: "app"` actions. Renaming or
reshaping it after a release needs a `retire` migration. It is unreleased, so it
can still change freely.

No critic: the schema is unreleased and changes for free until the next push.
The StreamKit route was the user's call, made knowing it is unofficial
([[discord-mute-state]]).
