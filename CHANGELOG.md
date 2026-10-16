# Release notes

Newest first. Each release says what changed for the people who use Pratibimb.

## 2.0 · A building you can walk into, run anywhere

**3D twin**
- The building is drawn as a real building: facade with glass bands and mullions, columns, roof with parapet and AC condensers, entrance canopy, and grounds with paving, lawn, trees, a path and parking.
- Rooms show their own wall and floor colours and furniture laid out for their type; ACs are drawn as split units. Cutaway lifts the facade and roof.
- Edit everything with Undo: rename, retype, resize, turn, duplicate, move or remove rooms; add rooms and floors; place, add and remove devices; recolour; add or rearrange furniture.
- **Design with AI:** describe a change, or paste a photo of a room ("make the Library look like this"), and tick the changes to apply.
- Generate a whole building from its real OpenStreetMap outline and floor count.
- Orbit, walk and fly; full screen; `.glb` export; the 3D and 2D plans always match.

**Cameras**
- Lights, fans and screens found automatically on the device; coverage per room ("2 of 4 lights watched"); health per camera.
- Devices a camera cannot see take the state of those it sees, marked Inferred, with a manual override.
- Fixed: a first visit could not start a camera; cameras did not come back after a reload; a frozen camera kept reporting as live; two phones could overwrite each other's zones; two tabs could run the same camera; several cameras slowed a laptop; daylight confused light zones.

**AI**
- Each workspace brings its own keys: Groq, Gemini, OpenAI, Anthropic, OpenRouter or any OpenAI-compatible service, chosen per task (chat, reports, photos, voice) with a fallback order. Keys are encrypted on the server and never shown again.
- The Assistant answers anything about the building, explains every number, guides connecting rooms, runs what-ifs and proposes changes you approve, with a natural voice that runs on the device.
- Fixed: alert advice that contradicted the rule, duplicate cards for one room, raw JSON in reports, monthly savings called weekly, measured CO₂ missing from reports.

**Always on**
- The server works out every room once a minute, so alerts, Telegram, automatic switch-off and hourly history continue with every browser closed.
- Shelly smart plugs and Home Assistant entities are mapped to rooms, read every minute and switched off on command; Telegram connects per workspace with one button.
- Connection doctor checks every key, plug, bot and camera and says what to fix.

**Runs anywhere**
- A fresh clone needs no account and no key: the server keeps its data in a local file and runs the minute tick itself. Online deployments use Supabase.

**App**
- New app shell with a sidebar, phone tab bar and command palette; new Overview, Rooms, Alerts, Trends, Connections, Keys and AI, and Team pages; roles for owners, managers and viewers.
- Accessibility audit fixes across every page in both themes.

**Repository**
- Moved to `rishushaurya/Code_clash_2.0`. Internal tooling files are no longer tracked.

## 1.3 · Workspaces and going live

- Workspaces: each team signs in with a name and password and sees only its own building, cameras, data and reports.
- A camera station that runs several cameras per device and per room, keeps them running across pages and reloads, and adds phones by QR code.
- Set up with AI: describe the building in plain words, by typing or speaking in English, Hindi or Kannada.
- The whole API became one server function, so it fits Vercel's free plan.
- Fixed: AI routes unreachable on Vercel, a dead session leaving the app stuck, AI reports falling back to templates.

## 1.2 · A product for any building

- Real data only: a fresh install has no rooms and no numbers; unknown is shown as unknown.
- Any site, currency, tariff and grid factor; campuses with several buildings; country presets with sources.
- Automatic switch-off with exempt rooms; staff reports; visitor "lights left on" reports from the public view.
- Indoor air from room sensors; AC advice for mild weather and overcooled rooms; rooftop solar from measured sunshine.
- Activity log with CSV export, weekly Telegram digest, learned opening hours, camera-offline alerts, an installable app.
- Warm light theme and design system; accessibility audit of every page.

## 1.0 · The twin

- Cameras in the browser count people and read light and fan zones; only numbers leave the device.
- The live twin with energy, cost and CO₂; the Scenario Lab with Monte Carlo ranges; grounded AI recommendations and reports; commands to a USB relay, a signed webhook and Telegram; a Python edge worker for CCTV.
