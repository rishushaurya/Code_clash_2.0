# Pratibimb test report

Owner: Tester session. Scope: [PLAN.md](PLAN.md) sections 1, 2 and 10, on `build/plan` in the main checkout, on localhost with the real Supabase, Groq and Gemini keys. Every test workspace is named `test-tester-<n>` and is deleted afterwards with `node tests/journey.mjs --cleanup <id>`.

Status words: **Pass**, **Fail**, **Confirmed** (a Phase 0 bug still reproduces), **Refuted** (it does not), **Blocked** (cannot run yet, with the reason), **Manual** (needs a real device; see section 8).

---

## 1. Rounds

| Round | Code tested | Result |
| --- | --- | --- |
| Baseline | `ee9cecd` (Gate 1), nothing merged yet | Checks green when scoped (see 2.1). Features: 11 pass, 5 fail, 2 blocked. Phase 0 (23 reachable): 21 confirmed, 1 partly fixed (A5), 1 not reproduced (A3); C9 manual; C15, C16, D1, I1 blocked. 6 new defects (N1 to N6). axe: 3 violations |

---

## 2. Baseline

### 2.1 Checks

| Check | Result | Note |
| --- | --- | --- |
| `npm test` | **Fail** in this checkout, 16 of 48 files | Vitest also collects `.claude/worktrees/**` (the builders' worktrees live inside this folder), so their in-progress tests run here and time out. See N1 |
| `npx vitest run --exclude ".claude/**"` | **Pass**, 90 of 90, three runs in a row | The real baseline for this branch |
| `npx tsc -b` | **Pass** | |
| `npm run build` | **Pass** | Largest chunk `index` 457 kB (148 kB gzip) |
| `npm run lint` | **Pass**, 0 errors, 6 warnings | All `react(only-export-components)`: `status.tsx`, `badge.tsx`, `ActivityLog.tsx`, `tabs.tsx`, `AiSetup.tsx`, `button.tsx` |
| `GET /api/health` | **Pass** | server, storage, workspaces ok; service-role key |
| `GET /api/status` | **Pass** | ai, aiVision, workspaces, realtime, telegram, ingest on; commandWebhook off |
| `node tests/journey.mjs` | 23 pass, 1 fail (A6), 6 skip (routes not built) | A1 AC check fails about one run in three (AI wording varies) |

### 2.2 Features from PLAN.md section 1

Browser steps ran in the Claude Browser pane at 1024 px with workspace `test-tester-bmv9ksy5q` (deleted). Sensor readings were posted to `/api/ingest` with that workspace's sensor key.

| Id | Feature | Steps | Expected | Actual | Result | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | Workspaces: create, open, sign out | Create; sign out from the workspace menu; open with the same name and password | Live twin opens each time; sign out returns to the sign-in page and removes the session | As expected. API: second create 409, wrong password 401, forged token 401 | Pass | server |
| F2 | Set up with AI (text) | Setup, Set up with AI, type a 4-room description with seats, lights, fans, ACs, PCs, hours and tariff; Read it into the form | Every room, count, hour and the tariff read; template values listed | All 4 rooms and every count read; 9 to 17 Mon to Fri; INR 8.73; areas listed as template values | Pass | ai |
| F3 | Setup save, server sync | Fill the form, Save; sign out; open again | "Site saved"; the rooms come back from the server | As expected | Pass | shell |
| F4 | Sensor ingest | POST two readings (LH-1 12 people 230 W 1250 ppm; CR-1 0 people 120 W) | Rooms change within about 2 s | Both rooms updated within 3 s; `delivered: 2` | Pass | server |
| F5 | Live twin, floor plan, metrics, Sankey | Open Live twin after F4 | Power 0.35 kW, cost, rooms coloured, Sankey by type | As expected | Pass | shell |
| F6 | Scenario Lab, payback, EPI, solar | Scenario Lab, Run 20 simulated weeks | Ranges, payback, EPI, solar from Open-Meteo, all "Modelled" | ₹687 to ₹2,507 a month; payback 3.2 to 11.6 months; EPI 27.4 to 22.7; solar from 58 days of measured sunshine | Pass | shell |
| F7 | Room page, CO2 from a sensor | Click LH-1 | Measured CO2, temperature, humidity, sensor source | 1250 ppm "measured", 23.0 °C, 55 %, "Sensor" badge | Pass | shell |
| F8 | Reports | Reports, Generate report | Grounded report, right units, measured CO2, stored actions | Generated, no raw JSON; but A4 and A5 still wrong in places, and N4 doubles the command count | Fail | ai, server |
| F9 | AI alert cards | Wait for the cards after F4 | One card per room, right advice | Two cards for LH-1 repeating 230 W and ₹2.01 (A2); CO2 card said "Turn off one fan" on the first pass (A1) | Fail | ai |
| F10 | Copilot | Ask "Which room uses the most power right now?" | Names LH-1 at 230 W | "I can't tell ... no power readings are included" (A6) | Fail | ai |
| F11 | 3D view | Live twin, 3D | Today: CSS-tilted floor plans (PLAN says "Basic") | As documented; no WebGL canvas yet | Pass (as documented) | twin-3d |
| F12 | Switch-off and confirmation | Wait out the 300 s empty delay on CR-1; Apply; post CR-1 lights off | Red, card with Apply, command, "confirmed by sensor" | Red at 300 s; Apply sent; "switch-off confirmed by sensor"; room Empty, off | Pass | server, shell |
| F13 | Public view | Public view from the header | Live building, no sign-in needed | Works; LH-1 shows "–" lights although the sensor reports 4 lights on (N5) | Pass with N5 | shell |
| F14 | Activity log | Reports, Activity log | Session events and the stored 30-day summary | Works; stored summary counts 2 commands for one click (N4) | Fail | server |
| F15 | Cameras | Cameras, Add a camera on this device | Start opens the camera | The pane has no usable camera; Start disabled, "No camera found" (C1) | Fail (C1); rest Manual | cameras |
| F16 | Telegram | | | Not configured per workspace yet (I1) | Blocked: Phase 6 | server |
| F17 | Twin with no browser open | `POST /api/reading`, `/api/state`, `/api/tick` | | 404: routes not built; tables missing | Blocked: not built, SQL not run | server |
| F18 | `/api/health`, `/api/status` | `GET` both | ok | ok | Pass | server |

### 2.3 Phase 0 bugs from PLAN.md section 2

| Id | Steps | Expected after the fix | Actual now | Result | Owner |
| --- | --- | --- | --- | --- | --- |
| C1 | Fresh profile, Cameras, Add a camera on this device | Start asks for permission | `enumerateDevices` returns one `videoinput` with an empty id; UI says "No camera found", Start disabled, no reason (`CameraStation.tsx:174`) | Confirmed | cameras |
| C2 | Code read | Fallback on `OverconstrainedError` | `sources.ts:69` uses `deviceId: { exact }` with no fallback | Confirmed (code) | cameras |
| C3 | Code read | Stop publishing when detection stops | No `ended` or `mute` listener; publish timer runs regardless (`CameraFeed.tsx:189`) | Confirmed (code) | cameras |
| C4 | Code read | No reading before the first detection | `median([])` returns 0 (`lightZones.ts:50`) and is published | Confirmed (code) | cameras |
| C5 | Code read | `http://` WHEP on https explained | CSP `connect-src` allows only https, wss, `http://localhost:*`; no message in the UI | Confirmed (code) | cameras |
| C6 | Code read | Reconnect with back-off | No `connectionState` handling in `src/cv` | Confirmed (code) | cameras |
| C7 | Code read | One shared detector set | Each `CameraFeed` loads its own (`CameraFeed.tsx:81`) | Confirmed (code) | cameras |
| C8 | Code read | No face detection while hidden | Face detection runs every cycle | Confirmed (code) | cameras |
| C9 | Two times of day, real camera | Ratio classifier | | Manual | cameras |
| C10 | Code read | One constant | UI "too close" below 8 (`CameraFeed.tsx:264`), classifier above 4 (`lightZones.ts:35`); `CALIBRATION_MIN_GAP` unused | Confirmed (code) | cameras |
| C11 | Code read of `PUT /api/cameras` | 409 for an existing new id | No check; read-modify-write overwrites | Confirmed (code) | cameras |
| C12 | Code read | `navigator.locks` per camera | Not used | Confirmed (code) | cameras |
| C13 | Code read | Video 1 px, not hidden | `<video className="hidden">` (`CameraFeed.tsx:288`) | Confirmed (code) | cameras |
| C14 | Code read | No confidence without detections | Confidence 1 when nobody is seen (`CameraFeed.tsx:201`) | Confirmed (code) | cameras |
| C15 | Phase 1 | Readings stored | Routes and tables missing | Blocked: not built, SQL not run | server |
| C16 | Unit test | Coverage per room | `coverage.ts` first version exists with a test; UI notice not built | Blocked: Phase 4 | cameras |
| A1 | API: `ai/recommend` with `co2_high` and `ac_overcooling` facts, 3 runs; browser: CO2 card | CO2 card advises ventilation; AC card targets 24 °C | Browser first pass: CO2 card "Turn off one fan" (the opposite of ventilation); AC card missed 24 °C in 1 of 3 runs; both AC cards called the room's ₹13.1/h cost a saving | Confirmed (intermittent) | ai |
| A2 | Browser, LH-1 with 12 people and 1250 ppm | One card per room | Two cards for LH-1 ("Indoor CO2 high", "Room underused"), both repeating 230 W and ₹2.01; the "underused" card says "wasting 230 W" in an occupied room | Confirmed | ai |
| A3 | Browser report; API report | No raw JSON | None found in browser or in 3 API runs | Refuted (not reproduced) | ai |
| A4 | Browser report | Period words match the figure | Summary: "reduce weekly consumption by up to 325 kWh"; 325 kWh is the monthly p90 and exceeds the 224 kWh weekly p90 baseline | Confirmed | ai |
| A5 | Browser report with a 1250 ppm sensor reading | Measured CO2 in the report, no field names | LH-1 1,250 ppm is present now; but CR-1 "420 ppm" (no sensor, an estimate) is called "measured by indoor sensors" | Partly fixed | ai |
| A6 | Browser Copilot; API `ai/copilot` plan step | Ranks rooms by power | Plan picks `topWasters`; answer "no power readings are included" | Confirmed | ai |
| T1 | CR-1 posted with 0 people and 120 W, never occupied | "Emptying (n s)" | "CR-1, Occupied, 0 people, 120 watts" for 300 s; event "CR-1 is now occupied" | Confirmed | shell, server |
| T2 | Reload the Live twin after F4 | Last state loads | 0.00 kW and "Bring the building to life" until a new reading | Confirmed | server |
| U1 | Live twin at 1024 px | One-row header, labelled icons | Header wraps to two rows (97 px); relay, public view, theme are icon-only (they have `aria-label`, no visible label or tooltip) | Confirmed | shell |
| U2 | New workspace, browser `en-US`, Setup | Currency from the searched location only | USD before any location is set | Confirmed; see N2 for the knock-on | shell |
| D1 | Docs | Updated in Phase 9 | Not checked this round | Blocked: Phase 9 | main |
| I1 | Telegram per workspace | Connect button | Not built | Blocked: Phase 6 | server |

### 2.4 New defects

| Id | Defect | Steps | Expected | Actual | Owner |
| --- | --- | --- | --- | --- | --- |
| N1 | `npm test` runs the builders' worktrees | `npm test` in the main checkout | 90 tests of this branch | 48 files, 16 failing, all under `.claude/worktrees/**` | main (`vite.config.ts`: add `test.exclude` for `.claude/**`) |
| N2 | Grid factor stays at the US value for an Indian site | Browser `en-US`; Set up with AI with "Bengaluru ... rupees"; Fill the form; Save | 0.727 (CEA) | 0.35 (US eGRID), while the hint under it says "Grid: CEA CO2 Baseline Database"; the report's CO2 uses 0.35 (134 kWh gives 47 kg). Cause: `emptySite()` seeds the locale preset, and `AiSetup.tsx:132` and `Setup.tsx:354` apply a preset only when the value is empty. Fixing U2 fixes it | shell (U2), ai (`AiSetup.tsx`) |
| N3 | Saving figure misattributed in AI cards | `ai/recommend` with `ac_overcooling`, `costPerHourNow` 13.1 | Saving from `monthlySavingCost` only | "save ₹13.1 per hour" (the current cost), in 3 of 3 runs; grounding passes because the number exists in the facts | ai |
| N4 | One switch-off is stored twice | Apply on a red room; query `events` | One command row | Two rows: `/api/command` stores the raw command with no `text`, then the twin uploads its own; Activity log says "2 switch-off commands"; the report's action list gets a blank row | server |
| N5 | Public view shows "–" lights for a sensor room | Sensor reports `{ type: 'light', on: true }` for LH-1; open Public view | Lights on | "–" lights | shell |
| N6 | Setup fields overflow their card at 375 px | Setup at 375 px | Fields inside the card padding | Inputs end at x 364, card at 359; right border clipped | shell |

### 2.5 Accessibility (axe-core 4.10.2 from cdnjs) and layout

| Page | Light | Dark | Owner |
| --- | --- | --- | --- |
| Sign-in | 0 | 0 | |
| Live twin | 0 | 1: legend "Empty, off" `#8a8178` on `#29251f`, 3.98:1 | shell |
| Room | 1: "Sensor" badge `#ad4f2b` on `#eedfd6`, 4.11:1 | 0 | shell |
| Scenario Lab, Reports, Setup, Public view | 0 | 0 | |
| Cameras | 1: `heading-order` (h3 under the floor section) | not run | cameras |

Layout: no sideways page scroll at 375, 768, 1024, 1440 on Live twin, Scenario Lab, Reports, Setup. The header is 97 px (two rows) at 375 and 1024, 133 px (three rows) at 768, 53 px at 1440. At 375 the top navigation scrolls sideways inside the header. N6 at 375.

---

## 3. Scripted API journey

`tests/journey.mjs` (no dependencies). Needs `npm run dev` and `.env`.

```bash
node tests/journey.mjs
```

```bash
node tests/journey.mjs --cleanup test-tester-<n>
```

It checks health and status; workspace create, duplicate, wrong password, open, refresh, forged token; site empty, save, read back; ingest with a wrong and a right key; events store and summary; `reading`, `state`, `tick` (with and without `CRON_SECRET`), `history`, `keys` (store, list never shows the value, delete), `doctor` (SKIP while they answer 404); Set up with AI; A1 cards; A6 and an off-topic Copilot question; report checks for A3, A4, A5. It then deletes the workspace's rows from `events`, `sites` (`<id>` and `<id>/cameras`), `workspaces`, and from `room_inputs`, `twin_state`, `room_hourly`, `secrets`, `settings_log` when those tables exist ("not set up yet (SQL not run)" otherwise), and checks nothing is left. It never prints a key or token. `--cleanup` accepts only `test-tester-*` ids.

---

## 4. Browser journey (PLAN.md section 10), run at the end of every phase

Run on localhost with a fresh `test-tester-<n>` workspace; delete it afterwards. Record pass or fail and the owner for each step.

| Step | Do | Pass when | Owner |
| --- | --- | --- | --- |
| 1 | Create a workspace | Overview opens with the workspace name in the menu | shell, server |
| 2 | Settings, Site, Set up with AI, Speak; describe 2 floors and 4 rooms aloud | Every room and count read; Fill the form; Save says "Site saved" | ai |
| 3 | Building 3D | Floors and rooms extruded from Setup; orbit, walk, full screen | twin-3d |
| 4 | In 3D edit mode, place two lights in LH-1; reload | Positions survive the reload and show on a second device | twin-3d |
| 5 | Cameras, start a camera on LH-1; auto-find the lights | Zones proposed for both lights; room leaves "No data" within 4 s | cameras |
| 6 | Walk out with the lights on | "Emptying (n s)", then red after the empty delay; Telegram alert arrives | shell, server |
| 7 | Tap Switch off in Telegram | Smart plug or relay switches; camera sees dark; "confirmed by camera"; saving grows; one command row stored | server, cameras |
| 8 | Assistant: "why was LH-1 red?" | Answer names the empty time, the load and the switch-off, with figures from the twin only | ai |
| 9 | Scenario Lab, run each policy | Ranges labelled Modelled; payback, EPI, solar shown | shell |
| 10 | Reports, Generate report, Download PDF | No raw JSON; units right; measured CO2 present; stored actions listed once; PDF opens | ai, shell |
| 11 | Open the public view QR on a phone, not signed in | Live building; "Lights left on here?" raises a check on the twin | shell |
| 12 | Close every browser; post a sensor reading of an empty room with lights on | Within the empty delay plus one minute: alert in the Activity log and on Telegram | server |

Also on every round: axe on every page, light and dark; 375, 768, 1024, 1440 px with no sideways scroll; keyboard reaches every control; status never by colour alone; Assistant declines an off-topic question.

---

## 5. Real-device camera matrix (run by hand)

Use a throwaway workspace on the deployed https site (phones need https) or on localhost for the laptop. Mark each cell Pass, Fail (with what you saw) or n/a.

| Check | Chrome desktop (USB or built-in camera) | Android Chrome (rear camera) | iPhone Safari (rear camera) |
| --- | --- | --- | --- |
| Start from a fresh profile: one click asks for permission and opens the camera (C1) | | | |
| Reading reaches the twin within 4 s; room leaves "No data" | | | |
| Reload the camera page: the camera starts again by itself (C2) | | | |
| Clear site data, reload: the camera falls back to the same camera or the default, with a plain message (C2) | | | |
| Put the tab in the background for 2 minutes: readings keep arriving (worker timer, wake lock) | | | |
| iPhone only: the hidden video keeps sending fresh frames for 5 minutes (C13) | | | |
| Unplug the USB camera or cover and lock the phone: readings stop within 3 s; "Camera stopped" and Try again; "Camera offline" alert (C3) | | | |
| No reading shows 0 people before the first detection (C4) | | | |
| Two cameras on one room (laptop plus phone): both Live; overlap uses the larger count, "split" adds them | | | |
| Two tabs on the same camera: only one runs, the other says "running in another tab" (C12) | | | |
| Two phones scan "Add a phone" for the same room together: two different camera ids, no lost zones (C11) | | | |
| Mark a light zone, record On and Off; switching the light changes the twin within 4 s | | | |
| Four feeds on one laptop stay under 50 % CPU (C7) | | | |
| CCTV: an `http://` WHEP address on the https site shows the explanation (C5); kill and restart MediaMTX: the feed resumes (C6) | | | |
| Privacy inspector shows 0 images stored and 0 sent | | | |

---

## 6. Open questions for the main session

- N1 needs a one-line `test.exclude` in `vite.config.ts`; no session owns that file.
- `room_inputs`, `twin_state`, `room_hourly`, `secrets`, `settings_log` are not in Supabase yet. Every check that needs them is marked Blocked: SQL not run.
