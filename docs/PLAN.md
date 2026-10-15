# Pratibimb: the plan to finish it

How we take Pratibimb from a working hackathon build to a product a facility team can run for real, and that judges can understand from the repository alone. Two days of build, done in phases. Each phase ends with every check green on localhost. Nothing is pushed by an assistant: the team reviews and pushes.

Read with: [BUILD_SPEC.md](BUILD_SPEC.md) (contracts), [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) (look and feel), [INTEGRATIONS.md](INTEGRATIONS.md), [DEPLOY.md](DEPLOY.md).

---

## 0. Rules for every build session

Every session, human or AI, follows these before writing a line:

1. **Skills first, every session, before any other step.** Invoke all four with the Skill tool: `seniordev` (the lead skill: it decides what gets built and how little), `cleancode`, `ui-ux-designer`, `less-token` (chat replies only). A session that has not loaded them does not start work. Follow the lazy ladder: does it need to exist, is it already in the repo, does the platform do it, does an installed library do it, then the least code.
2. **Search before building.** For every feature, search the web and GitHub for a maintained library or a reference implementation first. Use it when it fits the licence (MIT, Apache-2.0, BSD). Writing from scratch is the last option. Check current docs; never guess an API.
3. **Stay in your folder** (section 9). Shared types change only at a gate.
4. **Real data only.** Unknown is shown as unknown, modelled is labelled "Modelled", inferred is labelled "Inferred". Code computes numbers; the AI writes words.
5. **Only numbers leave a camera.** No frame is uploaded or stored.
6. **Green before done:** `npm test`, `npx tsc -b`, `npm run build`, `npm run lint`, and the phase's browser checks on `npm run dev`.
7. **No pushes.** Commit only when the team asks. Add a `CHANGELOG.md` entry per session.
8. No emojis anywhere. Icons from `lucide-react`.

---

## 1. What works today, and what does not

Tested on localhost against the real Supabase, Groq and Gemini with a throwaway workspace (deleted afterwards), plus a code read of every camera file.

| Feature | Status | Note |
| --- | --- | --- |
| Workspaces: create, open, sign out | Works | |
| Set up with AI (text) | Works | 4 rooms, all counts, hours and tariff read correctly from a plain description |
| Setup save, server sync | Works | |
| Sensor ingest `/api/ingest` | Works | Readings reach the twin in about 2 s |
| Live twin, floor plan, metrics, Sankey | Works | |
| Scenario Lab, payback, EPI, solar | Works | |
| Room page, CO2 from a sensor | Works | |
| Reports | Partly | AI report has defects (section 2, A3 to A5) |
| AI alert cards | Partly | Wrong advice and duplicates (A1, A2) |
| Copilot | Partly | Cannot answer "which room uses most power" (A6) |
| 3D view | Basic | CSS-tilted floor plans, not a 3D model |
| Cameras | Works on the happy path | 16 issues found in code (section 2, C1 to C16) |
| Telegram | Not live | Not configured on the deployed site |
| Twin when no browser is open | Missing | Alerts, Telegram, auto-off and history stop when the operator tab closes |
| `/api/health`, `/api/status` on Vercel | Works | AI, vision, workspaces, realtime, ingest on; Telegram and webhook off |

---

## 2. Phase 0: fix what is broken (first, before anything new)

Each fix leaves one test that fails if the bug comes back.

### Cameras (`src/cv/`)

| Id | Problem | Why it matters | Fix | Check |
| --- | --- | --- | --- | --- |
| C1 | **Start is disabled on a first visit.** Before camera permission, browsers return empty device ids, so the device list has no usable id and Start stays grey with no reason given. | The first thing a new user tries fails silently | Start asks for permission when needed, then uses the default camera; show "Allow the camera to see its name" instead of a dead button | Fresh browser profile: one click on Start opens the camera |
| C2 | **Saved device ids go stale.** Feeds resume with `deviceId: { exact }`; Safari rotates ids and Chrome changes them after site data is cleared, so a resume fails with `OverconstrainedError` shown raw. | Cameras do not come back after a reload | On `OverconstrainedError`, fall back to the same label, then the default camera; plain message | Unit test of the fallback; manual reload test |
| C3 | **Frozen or unplugged camera still reports as live.** The publish timer keeps sending the last head-count every 2 s even when detection has stopped (track ended, USB pulled, frozen stream). | A room looks occupied forever; "Camera offline" never fires | Listen to the track's `ended` and `mute` events; stop publishing when no detection ran in the last 3 s; show "Camera stopped" with Try again | Test: stop detection, readings stop, offline alert fires |
| C4 | **Zero people sent before the first detection.** The first readings carry the median of an empty list, 0. | A full room flickers to empty when a camera starts | Publish only after the first detection | Unit test |
| C5 | **CCTV in the deployed app is blocked.** WHEP addresses are `http://` on the campus network; the site is `https://`, so the browser blocks mixed content, and the CSP `connect-src` allows only `https:`, `wss:` and localhost. | CCTV works only on localhost | Document HTTPS for MediaMTX (its built-in TLS or a reverse proxy), say so in the UI when an `http://` address is typed on an `https` page, and keep the Python edge worker as the CCTV path | Typing an `http://` WHEP address on the live site shows the explanation |
| C6 | **No reconnect for CCTV streams.** When the WebRTC connection fails, the feed dies. | A 24/7 CCTV feed stops at the first network blip | Watch `connectionState`; retry with back-off | Kill MediaMTX and restart it: the feed resumes |
| C7 | **Every camera loads its own models.** Two models per feed; four cameras load eight copies and run detection on the main thread. | Laptops running several cameras stutter | One shared detector set for all feeds on a device (timestamps stay increasing because calls are sequential); faces detected only while the picture is on screen | Four feeds on one laptop stay under 50 % CPU |
| C8 | **Face detection runs when nobody looks.** Faces are only needed to blur the picture on screen. | Wasted CPU on phones | Skip face detection while hidden | Covered by C7 |
| C9 | **Calibration drifts with daylight and auto-exposure.** Light zones compare raw brightness with on/off references. | Lights read wrong as the day changes | Compare each zone against a reference wall patch (ratio), and lock exposure where `applyConstraints({ exposureMode })` is supported | Unit test of the ratio classifier; manual test at two times of day |
| C10 | **Two thresholds disagree.** The UI calls a zone ready above a gap of 8; the classifier accepts above 4. | A zone marked "not ready" still drives the twin | One constant in `src/shared/config.ts` | Unit test |
| C11 | **Two devices can create the same camera.** New ids come from the local list; two phones scanning "Add a phone" together both create `cam-1` and overwrite each other's zones. | Lost calibration | The server refuses a new camera id that already exists (409) and the client takes the next free number | API test |
| C12 | **Two tabs run the same camera.** Both resume the saved feeds. | Duplicate readings | `navigator.locks.request(camId)`: only the lock holder runs the feed | Two tabs: one runs, the other says "running in another tab" |
| C13 | **Hidden video may stop on iPhone.** The `<video>` is `display: none`; iOS Safari can stop painting frames for hidden video. | Phone cameras send stale frames | Keep the video 1 px and transparent instead of hidden | Test on a real iPhone |
| C14 | **Confidence is 1 when nobody is seen.** | Misleading in the privacy inspector and merge | Report the detector's actual state; omit confidence when there are no detections | Unit test |
| C15 | **Readings are lost when no twin is open.** Cameras broadcast only; nothing stores them. | No history, no alerts at night | Phase 1 stores the latest reading per camera on the server | Phase 1 checks |
| C16 | **Camera coverage is invisible.** If Setup says 4 lights and the camera has zones for 2, nobody is told. | Wrong totals | Coverage check per room: "2 of 4 lights watched"; notice to the admin with the fix (Phase 4) | Unit test of coverage |

### AI (`src/ai/`, `api/_routes/ai/`, `api/_lib/`)

| Id | Problem | Fix | Check |
| --- | --- | --- | --- |
| A1 | **Advice contradicts the rule.** The "AC set too cold" card said "set the thermostat to 21 °C" (the current temperature), and the "Indoor CO2 high" card talked about ACs instead of ventilation. | Code writes the action (target 24 °C, open windows or run fans, from the rule); the AI only phrases the reason. Grounding also checks temperatures and ppm, not only money and energy | Test: CO2 alert text mentions ventilation; AC alert says 24 °C |
| A2 | **Three cards for one room at once**, each repeating the same load figure. | Group alerts per room into one card with several findings, ordered by saving | Store test |
| A3 | **Raw JSON leaks into the report** (`"]`, `bullets`, `:` printed in the Summary). | Parse the model output as JSON with a schema first; the lenient path strips structure characters; never render raw text | Test with the captured bad output |
| A4 | **Units mixed up.** The report called a monthly saving "weekly". | Facts carry the period in each key name and value (`monthlySavingKwh`); grounding checks figure plus unit word nearby | Test |
| A5 | **Measured CO2 missing from the report** ("the indoorAir array is empty") although a sensor sent 1250 ppm; the AI also leaked a field name. | `co2History` records measured values too; the prompt forbids field names | Test |
| A6 | **Copilot cannot rank rooms by power.** Its tools list only wasting rooms, so "which room uses the most power" gets "no data". | Add a `liveSummary` tool: every watched room with people, watts, status | Copilot test with the same question |

### Twin, UI and docs

| Id | Problem | Fix |
| --- | --- | --- |
| T1 | A room that has never had anyone in it shows **"Occupied, 0 people"** during the empty delay. | New status label "Emptying (n s)" for the grace period; "Occupied" only with people seen |
| T2 | **Reloading the twin forgets the live state** until every input reports again (up to 5 minutes for sensors). | Phase 1: the twin loads the last stored state on start |
| U1 | At 1024 px the top navigation wraps into two rows and the header icons have no labels. | Phase 2 app shell |
| U2 | Setup defaults the currency from the browser locale (USD on an Indian laptop set to en-US). | Default from the searched location only; ask when unknown |
| D1 | README and BUILD_SPEC say 79 tests (there are 89); BUILD_SPEC's roadmap still says "a deployment shares one site"; LAUNCH_PLAN names the old `api/[...route].ts`. | Rewrite in Phase 9; LAUNCH_PLAN's content folds into the changelog and the file goes |
| I1 | Telegram is not configured on the live site. | Phase 6 makes it a per-workspace setting with a Connect button |

**Phase 0 done when:** every row above has its test, all checks pass, and a camera started from a fresh browser profile reaches the twin.

---

## 3. Phase 1: the twin runs 24/7

Today the twin only thinks while a browser tab is open. A real building needs it to run all night.

**Design (lazy path, no new host):**
1. **Store readings.** A new table `room_inputs` keeps the latest reading per camera and per sensor (upsert, one row each). Cameras post to `/api/reading` every 10 s (in addition to the live channel every 2 s), so a dropped tab costs at most 10 s. `/api/ingest` writes the same table.
2. **One pure function.** Move the room-state maths out of the Zustand store into `src/twin/compute.ts`: `(room, inputs, previous, now) -> RoomState`. The browser store and the server both call it, so they never disagree. Existing store tests move with it.
3. **A minute tick.** Supabase `pg_cron` calls `/api/tick` every minute through `pg_net`, with `CRON_SECRET`. The tick, per workspace with recent inputs: computes room states, raises alerts (stored in `events`), sends Telegram, issues auto-off commands, and writes an hourly roll-up for history.
4. **Browser loads the last state** from `/api/state` on start (fixes T2).
5. **Duplicates:** the server is the single sender of Telegram and auto-off; the browser stops sending them when the server tick is healthy (it says so in `/api/status`).

**Check:** close every browser; post a sensor reading of an empty room with lights on; within the empty delay plus a minute, Telegram receives the alert and the event appears in the Activity log.

---

## 4. Phase 2: an app that feels made by a product team

Built with the `ui-ux-designer` skill and [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md). The warm light theme stays: it is our identity and avoids the generic dark-glass look of most AI-made dashboards.

**App shell**
- Left sidebar on desktop (collapsible to icons), bottom tab bar on phones with the five most used items.
- Top bar: building switcher, live status (time of last reading, "stale" when old), alerts bell with count, Assistant button, workspace menu.
- Command palette (Ctrl+K) to jump to any room, page or action (shadcn `Command`).
- Breadcrumbs on deep pages (Building > Floor > Room > Device).
- Fullscreen mode for the 3D view and the lobby display.

**Navigation**

| Group | Page | What it holds |
| --- | --- | --- |
| Monitor | **Overview** | Building health score, power now, cost per hour, waste now, saved this month, top three actions, live mini 3D |
| Monitor | **Building 3D** | The immersive twin (Phase 3) |
| Monitor | **Rooms** | Table and grid of every room: status, people, watts, inputs, coverage; filters; bulk actions |
| Monitor | **Alerts** | Open, acknowledged, resolved; each with its evidence and fix |
| Analyse | **Scenario Lab** | As today, cleaner layout |
| Analyse | **Reports** | Audit report, activity log, NAAC evidence pack |
| Analyse | **Trends** | Day, week, month history from Phase 1 roll-ups |
| Connect | **Cameras** | Station, coverage, auto-detect (Phase 4) |
| Connect | **Devices and integrations** | Smart plugs, Home Assistant, relays, Telegram, webhook, sensor API, each with a status light and a Test button |
| Connect | **Connection doctor** | One page that tests every link end to end |
| Settings | **Site** | Building, floors, rooms, tariff, hours |
| Settings | **Keys and AI** | Bring your own keys (Phase 6) |
| Settings | **Team and access** | Members, roles, invite links, sessions |
| — | **Assistant** | Side panel, open from anywhere (Phase 5) |
| — | **Public view** | As today, linked from the workspace menu |

**Onboarding:** a "Get your building live" checklist on Overview (building, rooms, first camera or sensor, alerts channel, AI key), each step linking to where it is done, with progress.

**Quality bar:** loading, empty, error and success states on every panel; 375, 768, 1024, 1440 px with no sideways scroll; keyboard reaches everything; axe finds nothing; status never by colour alone.

---

## 5. Phase 3: the immersive 3D twin

Researched options, chosen for licence (MIT/Apache) and for the least code we own.

| Need | Use | Why |
| --- | --- | --- |
| 3D engine | `three`, `@react-three/fiber`, `@react-three/drei` (MIT) | Standard React 3D stack; lazy-loaded so other pages stay light |
| Building from Setup | Our own extrusion: each room polygon becomes floor, walls (with door gaps), glass on window sides; floors stacked | Automatic: every customer gets a 3D model with no extra input |
| Orbit, fly, walk | drei `OrbitControls`, `PointerLockControls`, `KeyboardControls`; wall collision with `three-mesh-bvh` (MIT) | Walk through corridors at head height; WASD and touch joystick |
| Fullscreen | Browser Fullscreen API | One button, Esc leaves |
| Real outline | OpenStreetMap through the Overpass API: footprint and `building:levels` at the searched location (free, no key, ODbL attribution) | The model takes the real building's shape |
| Floor plan photo | Photograph the evacuation map; the AI vision model returns room rectangles; the person reviews before saving (same pattern as Set up with AI) | Minutes instead of drawing |
| City context (optional) | `3d-tiles-renderer` (NASA-AMMOS, Apache-2.0) with Google Photorealistic 3D Tiles, using the customer's own key | Looks like Google Earth; Google's terms forbid copying its mesh, so it is shown only as context, never as our model |
| Photoreal room (optional) | `@sparkjsdev/spark` (MIT) for a Gaussian-splat scan from Scaniverse | Showpiece for one hall |
| Export | three's `GLTFExporter` to `.glb` | Customers keep their model |
| Studied, not used | Pascal Editor (MIT, WebGPU, three 0.183+), react-planner, That Open Engine (IFC) | Heavier than we need now; IFC import goes on the roadmap |

**What a user can do in 3D**
- See every room coloured by live status, people counts floating above rooms, lights glowing when on, fans turning, waste rooms pulsing red.
- Click a room or device: side panel with its live data and actions (switch off, report, open cameras).
- **Edit mode:** draw or drag rooms on a floor grid; place each light, fan, AC, projector and camera at its exact spot by walking into the room and clicking the ceiling or wall. Positions are saved per device (`position: [x, y, z]` in room metres) and used by the camera auto-detect to match fixtures to devices.
- Time-travel slider replays the day in 3D.
- Lobby mode: slow camera tour, full screen, no controls.

**Data change (gate):** `Room` gains optional `size: [w, d]` in metres and `doors`; `Device` gains optional `position`. Old site files stay valid.

**Check:** a site with 3 floors and 12 rooms renders at 60 fps on a mid laptop; walking cannot pass through walls; editing a device position survives a reload and appears on another device.

---

## 6. Phase 4: cameras that understand the room

| Feature | How | Privacy |
| --- | --- | --- |
| **Auto-find lights** | "Switch the lights off, then on": the camera diffs the two frames, finds bright blobs, proposes one zone per fixture | On device |
| **Auto-find fans** | Ten seconds of the fan running: the motion map finds spinning regions | On device |
| **Screens and projectors** | The person detector's COCO classes include `tv` and `laptop`; plus the brightness method | On device |
| **Optional open-vocabulary detector** | OWLv2 through Transformers.js (Apache-2.0), quantized, WebGPU; finds "ceiling fan", "ceiling light" by name. YOLO-World is GPL or AGPL, so it is not used | On device, downloaded once |
| **Coverage check** | Setup says 4 lights, cameras watch 2: notice "2 of 4 lights watched in LH-1", with steps to add a zone or a camera | |
| **Inferred states** | In a watched room, a device no camera sees takes the state of the same type the camera does see (lights usually share a switch), labelled "Inferred"; anyone can override it on the room page or in 3D | |
| **Manual state** | Per device: "On", "Off", "Not sure"; staff reports already do this per type | |
| **Health** | Frame rate, last detection, lighting quality ("too dark to count") shown per camera | |

**Check:** in a test room, auto-find proposes the right zones for 2 lights and 1 fan; switching one light off changes the twin within 4 s; an unwatched light shows "Inferred" and follows a manual override.

---

## 7. Phase 5: the building Assistant

One assistant, in a side panel on every page, that knows only this building and this app.

**It can**
- Explain any number on screen and where it came from (camera, sensor, staff, modelled, inferred).
- Explain alerts and walk through the fix.
- Find rooms with no inputs and guide connecting them, step by step: which camera to use, where to mount it, how to mark zones, or how to post from a smart plug.
- Propose changes (add a room, change a device count, set hours, turn on auto-off). Every change shows as a diff the person approves; the Assistant never saves on its own.
- Run what-ifs on the real engine and compare policies.
- Teach: kWh, EPI, BEE star ratings, the CO2 model, NAAC 7.1.6 evidence, in plain words.
- Answer by voice (existing Whisper route) in English, Hindi or Kannada.

**It cannot** answer unrelated questions (it says what it can help with), invent numbers (grounding check stays and extends to every unit), or change anything without approval.

**Build:** extend the existing Copilot tools (`src/ai/tools.ts`) with `liveSummary`, `coverage`, `explainMetric`, `proposeSiteChange`, `connectionGuide`; keep code-computed facts; conversation kept per workspace for the session.

**Check:** ten scripted questions (in the test plan) answered correctly; an off-topic question is declined; a proposed change applies only after Approve.

---

## 8. Phase 6: bring your own keys, and real connections

**Keys and AI (Settings)**
- Each workspace adds its own keys: AI providers (Groq, Google Gemini, OpenAI, Anthropic, OpenRouter, any OpenAI-compatible URL), Telegram bot token, Google Maps key, command webhook secret.
- Pick the provider and model for chat, for reports, and for photos, and the fallback order. A Test button checks each key.
- **Security:** keys are encrypted on the server with AES-256-GCM (Node `crypto`), the key derived from `WORKSPACE_SECRET` per workspace; stored in a `secrets` table with row-level security and no public policy; never sent back to the browser (only the last four characters); never logged; used only by server routes for that workspace. Changing or deleting a key is written to the audit log.
- The deployment's own keys become an optional fallback the operator can switch off, so the team's quota is never spent by customers.

**Connections that really work**

| Connection | Plan | Test |
| --- | --- | --- |
| Telegram | Per-workspace bot: paste the token, press Connect; the server calls `setWebhook` with a secret, the bot replies in the group, `/chatid` is no longer needed (the first message links the chat) | Alert arrives; Switch off tap reaches the twin; weekly digest |
| Smart plugs | Shelly (Gen2 local RPC and cloud), Tasmota (HTTP): read power, switch off | Plug's watts appear on the room; switch-off turns it off |
| Home Assistant | Inbound REST (documented), outbound webhook, plus a ready-made HA package file to copy | Round trip |
| USB relay | Web Serial as today; ESP32 firmware also gets a Wi-Fi HTTP mode | Lamp switches |
| Any system | Signed command webhook as today | Signature verified |
| Sensors | `/api/ingest` as today | |

**Connection doctor:** one page runs every check (keys, storage, live channel, Telegram, webhook, each plug, each camera) and says exactly what to fix.

---

## 9. Phase 7: security

- Encrypted keys (above); per-workspace audit log of settings changes.
- Roles: Owner, Manager, Viewer; invite links per role; list and revoke active sessions; change the workspace password.
- Rate limits move from memory to a Supabase table so they hold across function instances.
- Supabase private channels with Realtime Authorization replace bearer channel names (the known ceiling in BUILD_SPEC).
- CSP: allow only the hosts each feature needs; keep `frame-ancestors 'none'`.
- Data export and delete for a workspace.
- Run the `security-review` skill on the branch before handing over.

---

## 10. Phase 8: testing

| Layer | What | Tool |
| --- | --- | --- |
| Unit | Every fix in Phase 0, compute function, coverage, inferred states, key encryption | Vitest |
| API | Every route through the router: auth, isolation, BYOK, tick, reading, Telegram connect | Vitest (existing handler tests) |
| Browser | The full user journey below on localhost with real services and a throwaway workspace, deleted after | Claude Browser pane |
| Real devices | Camera on Chrome desktop, Android Chrome, iPhone Safari; two cameras one room; reload; background tab; unplug | Manual checklist |
| Accessibility | Every page, light and dark | axe-core |
| Performance | Lighthouse on Overview and 3D; 3D at 60 fps | Lighthouse, DevTools |
| Security | Forged sessions, other workspace's ids, key never returned, CSP | API tests, `security-review` |

**The user journey test (run at the end of every phase):**
1. Create a workspace. 2. Set up with AI by voice. 3. See the 3D model appear. 4. Place two lights in 3D. 5. Start a camera; auto-find the lights. 6. Walk out; the room turns red; Telegram alert. 7. Tap Switch off; the smart plug or relay switches; the camera confirms; saving counted. 8. Ask the Assistant "why was LH-1 red?". 9. Run the Scenario Lab. 10. Generate the report and download the PDF. 11. Open the public view on a phone. 12. Close every browser; post a sensor reading; the server tick sends the alert.

---

## 11. Phase 9: the repository judges will read

- **README**, rewritten in plain words: one-paragraph pitch; a 20-second GIF and three screenshots; "Try it in 2 minutes" with the live link; how it meets each part of PS04 (table); feature tour; architecture diagram; how to run; how we tested; team and who built what; honest "How we built it" (AI assistants used, contracts in BUILD_SPEC, every file run and explained by its owner).
- **docs/JUDGES.md**: a ten-minute guided tour of the live app and the code, with links to the exact files for each pillar (CV, twin, AI).
- **docs/** trimmed: README links to each doc with one line on what it is for. LAUNCH_PLAN and this plan fold into the changelog once done.
- **CHANGELOG** read as release notes (what changed for users), newest first.
- Screenshots in `docs/images/`.
- Commit messages stay small and conventional, per module, by the person who owns the module.

---

## 12. More ideas

Grouped by when. "Now" fits the two days; the rest is the roadmap in the README.

**Now**
1. Building health score (0 to 100) on Overview, from waste share, coverage, CO2 and open alerts, with what moves it.
2. "Today's three actions" card: the biggest savings available right now.
3. Shift handover note: the Assistant writes what happened since the last shift.
4. Lobby display mode: full-screen 3D tour with live savings, for a reception TV.
5. QR sticker sheet: print a page of room QR codes for the public view.
6. Bill check: enter last month's bill; compare with the twin's measured and modelled energy.
7. Dark-hours watch: anything on after closing time raises an alert even without people data.

**Next**
8. Trends page with day, week and month history.
9. Occupancy forecast per room from observed hours.
10. Timetable import (CSV or ICS) so the Scenario Lab models real classes.
11. Tariff time-of-day and demand charges.
12. Water: metered taps and leak alerts through the sensor API.
13. Solar and battery live data from an inverter API.
14. Comfort: temperature and humidity per room with ASHRAE comfort bands.
15. Maintenance: a light that flickers or a fan that slows becomes a ticket.
16. Carbon budget per month with progress.
17. Leaderboard across buildings of a campus, shared weekly on Telegram.
18. Hindi and Kannada for the whole interface, not only alerts.
19. Offline-first installable app for the camera phones.

**Later**
20. IFC import for buildings with a BIM model (That Open Engine).
21. BACnet and Modbus gateways for large building systems.
22. Auto-generated monthly NAAC evidence pack, signed.
23. Benchmarks against similar buildings (anonymised).
24. Multi-language voice Assistant that calls staff by phone.
25. Public API with keys for third-party apps.

---

## 13. Two-day schedule and who touches what

Six sessions run in parallel, each in its own git worktree on a branch cut from `build/plan`, so no two edit the same files. Each session loads the four skills first (section 0), with `seniordev` leading. The main session merges finished branches into `build/plan` on this machine; nothing is pushed. Shared files (`src/shared/types.ts`, `site.ts`, `config.ts`, `supabase/schema.sql`) changed at Gate 1 and change again only through the main session.

| Session | Owns (only these files) | Work | Dev server |
| --- | --- | --- | --- |
| Main | `src/shared/*`, `supabase/`, `docs/PLAN.md`, merges | Gate 1 contracts; merging; Gates 2 and 3 | 5173 |
| Cameras | `src/cv/**`, `edge/`, `firmware/`, `api/_routes/cameras.ts` | Phase 0 C1 to C16; Phase 4 auto-find, coverage, inferred-state input, camera health | 5174 |
| AI | `src/ai/**`, `src/ui/assistant/**`, `src/ui/components/{Copilot,AiSetup,Surveyor,Patterns,speech}.*`, `api/_routes/ai/**`, `api/_lib/{llm,grounding,schemas}.ts` | Phase 0 A1 to A6; Phase 5 Assistant; every AI route uses `aiCandidates()` so workspace keys work for every provider | 5175 |
| Server | `api/router.ts`, `api/_lib/{db,http,auth,keys}.ts`, `api/_routes/*.ts` except `cameras.ts`, `src/twin/**`, `src/shared/workspace.ts`, `vercel.json`, `scripts/` | Phase 1 (24/7 tick, inputs, state, hourly roll-up); T1, T2; BYOK storage, encryption, `/api/keys`; Telegram connect; smart plugs and Home Assistant dispatch; `/api/doctor`; Phase 7 server security | 5176 |
| 3D | `src/ui/3d/**` | Phase 3: model from Setup, orbit, walk, full screen, device placement, OpenStreetMap outline, floor plan photo (through the AI session's route), GLB export, optional city tiles | 5177 |
| Shell | `src/ui/**` except `3d/`, `assistant/` and the AI files above; `src/App.tsx`, `src/index.css`, `src/components/ui/**`, `docs/DESIGN_SYSTEM.md` | Phase 2: sidebar shell, Overview, Rooms, Alerts, Trends, Settings (Site, Keys and AI, Team), Connections and Connection doctor pages, onboarding checklist, Emptying label (T1), every key's form placed where it is used | 5178 |
| Tester | `docs/TEST_REPORT.md`, `tests/` (new) | Baseline test now; a scripted test of every feature in section 10; tests each branch the main session names, and `build/plan` after each merge; files every defect with steps, expected, actual, owner | 5173 |

Only the Cameras and 3D sessions may add npm packages; the main session settles `package-lock.json` on merge. A session that needs a file it does not own asks the main session.

| Block | Who | Work |
| --- | --- | --- |
| Gate 1 (done) | Main | Contracts below; 3D packages installed; schema tables; dev ports |
| Day 1 | All six | Phase 0 fixes first, then each session's phases |
| Gate 2 | Main and Tester | Merge, full checks, user journey test, fixes sent back to owners |
| Day 2 | All six | Phase 6 connections, Phase 7 security, 3D extras, Assistant polish |
| Gate 3 | Main and Tester | Phase 8 full test, Phase 9 README and docs, screenshots |

### Gate 1 contracts

**Types** (`src/shared/types.ts`): `Device.position` (metres in the room, `[x, height, z]`), `Room.heightM`, `RoomState.deviceSource` (`camera`, `sensor`, `manual`, `inferred`), and the bring-your-own-keys types `AiProvider`, `KeyName`, `AiTask`, `KeyStatus`, `AiChoice`, `AiSettings`. `CALIBRATION_MIN_GAP` in `src/shared/config.ts`.

**AI keys** (`api/_lib/keys.ts`, Server owns, AI calls): `aiCandidates(workspaceId, task)` returns the ordered list of `{ provider, url, apiKey, model, owner }` to try. Today it reads the deployment's environment; the Server session makes it read the workspace's keys and `AiSettings` first.

**Keys API** (Server builds, Shell calls; every route needs the workspace session):

| Route | Does |
| --- | --- |
| `GET /api/keys` | `{ keys: KeyStatus[], ai: AiSettings, deployment: Record<AiProvider, boolean> }`; never a value |
| `PUT /api/keys` | `{ name, value, baseUrl? }` stores one key encrypted; answers its `KeyStatus` |
| `DELETE /api/keys?name=` | Removes one key |
| `POST /api/keys/test` | `{ name }` calls the provider with the stored key; `{ ok, error?, models? }` |
| `PUT /api/keys/ai` | Saves `AiSettings` |
| `POST /api/telegram/connect` | Uses the stored `telegram` key: sets the webhook with a secret, answers the bot's name and the linked chat once someone writes to the bot |

**Inputs and state** (Server builds; Cameras and Shell call):

| Route | Does |
| --- | --- |
| `POST /api/reading` | `{ readings: CvReading[] }` from a camera every 10 s; upserts `room_inputs` |
| `GET /api/state` | The last `twin_state` and the open alerts, for a browser that just opened |
| `POST /api/tick` | `CRON_SECRET` only; the minute tick for every active workspace |
| `GET /api/history?room=&from=&to=` | Hourly roll-ups for Trends |
| `GET /api/doctor` | Every connection's check: `{ name, ok, detail, fix }[]` |

**Cross-session imports:** `coverage(room, cameras)` from `src/cv/coverage.ts` (Cameras owns); `<Building3DView rooms onSelect />` from `@/ui/3d` (3D owns); `<AssistantPanel />` from `@/ui/assistant` (AI owns). Each exists now as a working first version, so every branch builds on its own.

**Database** (`supabase/schema.sql`, run once in the Supabase SQL editor): `room_inputs`, `twin_state`, `room_hourly`, `secrets`, `settings_log`, and the commented `pg_cron` job.

**Cut list if time runs short, in order:** Photoreal scan; Google city context; OWLv2 detector; roles; Trends page. Never cut: Phase 0 fixes, the 24/7 tick, the 3D model from Setup, BYOK security, the user journey test, the README.

---

## 14. Decisions taken

| Question | Decision |
| --- | --- |
| Pre-event commits | Organisers allowed it; history stays as it is |
| Where the twin runs 24/7 | Supabase `pg_cron` calling `/api/tick` every minute |
| 3D | All of: automatic from Setup, real outline from OpenStreetMap, floor plan photo, walk-in with device placement, full screen; Google city view and photoreal scan optional |
| Unseen devices | In a watched room, inferred from the devices the camera sees, labelled "Inferred", with manual override |
| Fixture detection | On the device only; no frame leaves it |
| Google 3D | Optional, customer's own key; OpenStreetMap is the free default |
| AI keys | Each workspace brings its own, encrypted on the server |
| Pushing | The team pushes; assistants work on local branches and never push |
| Testing | A dedicated tester session runs alongside the builders |
| Deadline | Two days; cut list above |
