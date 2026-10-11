# Pratibimb Build Spec

Version 3.0 · Status: built and verified · Product: a digital twin any building can adopt

This is the engineering contract for Pratibimb: data rules, folder ownership, shared shapes, numbers, module checks, security and how to run it. Read [RESEARCH_MASTER_PLAN.md](RESEARCH_MASTER_PLAN.md) for the why, [INTEGRATIONS.md](INTEGRATIONS.md) for connecting other systems.

---

## 1. Principles

1. **Real data only.** Live figures come from cameras, sensors through the ingest API, or staff reports. A room nobody watches is "No data"; a device nobody observes draws nothing. Nothing is invented to fill a screen.
2. **Modelled is labelled.** The Scenario Lab models a week from the customer's own rooms and assumptions and labels every result "Modelled".
3. **Code computes every number, the AI only writes words.** The server rejects AI text that quotes a figure missing from its facts.
4. **Any site.** No building, currency, tariff or language is hardcoded. Setup and the site JSON file describe the customer's building; presets exist only where a source is cited.
5. **Only numbers leave a camera.** No frame is uploaded or stored, ever.
6. **Savings need confirmation.** A switch-off saves money only once a camera, sensor or person sees the devices off.
7. **One owner per folder**, so parallel AI sessions never edit the same file.

## 2. Stack

| Layer | Choice | Why |
| --- | --- | --- |
| App | React 19, Vite 8, TypeScript 6 (strict) | One language for the team |
| Styling | Tailwind CSS 4, shadcn/ui (Radix), lucide-react; warm light theme ([DESIGN_SYSTEM](DESIGN_SYSTEM.md)) | Polished components on our tokens |
| State | Zustand 5: `useSite` (configuration), `useTwin` (live state) | Small, no boilerplate |
| Computer vision | `@mediapipe/tasks-vision`: EfficientDet-Lite0 (person), BlazeFace (faces), CPU delegate, every 500 ms; brightness and motion zones on canvas | Apache-2.0; local model files work offline; the int8 model misclassifies on the WebGL GPU delegate |
| Charts | Recharts through shadcn `chart`, including `Sankey` | One chart library |
| Realtime | Supabase broadcast when keys exist; `BroadcastChannel` always | Devices over the internet; tabs of one browser with no setup |
| Event log | Supabase Postgres, one table | Action-taken record for audits |
| Server | One Vercel function, `api/[...route].ts`, routing to Web-standard handlers in `api/_routes`; the same router serves `npm run dev` | Secrets stay server-side; fits Vercel Hobby's 12-function limit |
| Workspaces | Name and password; scrypt hash in Supabase; HMAC-signed 30-day sessions; channel names and sensor keys derived from `WORKSPACE_SECRET`; a browser-only workspace (PBKDF2) without server storage | Many customers on one deployment, no auth vendor |
| AI | Plain `fetch` to Groq, then Gemini (OpenAI-compatible APIs); Zod; grounding retry | No SDK needed |
| Integrations | Ingest API with key, HMAC-signed command webhook, Telegram Bot API, MediaMTX, Python edge worker | Fits whatever the building already has |
| Tests | Vitest (79 tests), Python self-test, axe-core accessibility audit of every page | |

## 3. Folder map and ownership

| Initials | Member | Owns |
| --- | --- | --- |
| **PS** | Priyanshu Shaurya | `src/shared`, `src/twin`, `src/sim`, `src/ai`, `api/[...route].ts`, `api/_lib`, `api/_routes/ai`, `api/_routes/{workspace,site,events,status,health,digest}.ts`, `supabase` |
| **AR** | Aditya Raj | `src/cv`, `src/relay`, `firmware`, `edge`, `api/_routes/{cameras,command,alert,telegram,ingest,report}.ts` |
| **NP** | Neev Pujari | `src/ui`, `src/App.tsx`, `src/index.css`, design system, pitch |

```
api/
  [...route].ts            the one function: /api/<path> -> api/_routes/<path>.ts (folders starting with _ are not functions)
  _lib/auth.ts             workspaces: scrypt passwords, signed sessions, derived channel names and sensor keys
  _lib/grounding.ts        rejects AI figures not in the facts (+ test)
  _lib/llm.ts              Groq then Gemini, JSON, text or image, retry once (+ test)
  _lib/http.ts             responses, validation, workspace auth, rate limit per route and address, broadcast, signed command webhook
  _lib/db.ts               Supabase REST: tables, workspace documents (site, cameras), events, Telegram chat
  _lib/schemas.ts          Zod shapes for facts, commands, sensor readings
  _routes/workspace.ts     create or open a workspace (name, password) -> session; GET -> channels and sensor key
  _routes/ai/recommend.ts  facts -> recommendation card
  _routes/ai/report.ts     facts -> audit report sections
  _routes/ai/copilot.ts    question -> tool; tool result -> spoken answer
  _routes/ai/surveyor.ts   ceiling photo -> device boxes
  _routes/ai/setup.ts      a description of the building -> setup draft; numbers not in the text are dropped
  _routes/site.ts          the workspace's site file: GET and PUT
  _routes/cameras.ts       the workspace's camera settings, saved one camera at a time
  _routes/ingest.ts        sensor readings -> the workspace's twin (its sensor key)
  _routes/command.ts       command -> twin + customer webhook (body names the workspace)
  _routes/alert.ts         Telegram alert to the chat stored in the workspace's site
  _routes/telegram.ts      Telegram button tap -> command, only from the linked chat; /chatid replies with the chat id
  _routes/status.ts        which integrations are configured (booleans)
  _routes/report.ts        public "lights left on" report with the public view key -> a check for staff, rate-limited
  _routes/events.ts        the workspace's event log: POST batches, GET a 30-day summary for the report
  _routes/health.ts        uptime check: server and storage reachability
  _routes/digest.ts        weekly Telegram digest per workspace, run by Vercel Cron (CRON_SECRET)
  _routes/handlers.test.ts every route through the router, called like Vercel does
src/
  shared/site.ts           the customer's site store, templates, presets, layout, JSON schema
  shared/types.ts          contracts (section 4)
  shared/config.ts         engineering constants only
  shared/workspace.ts      the signed-in workspace: session, channels, storage keys, join and public links, local workspaces
  shared/timer.ts          a worker-driven interval that keeps pace in background tabs
  shared/openMeteo.ts      measured sunshine at the site (solar card and report)
  twin/store.ts            the live twin (+ store.test.ts: the whole loop)
  twin/energy.ts, co2.ts, merge.ts, rules.ts, realtime.ts
  twin/usage.ts            observed utilization, left-on share, opening hours and waste patterns
  sim/engine.ts            what-if engine (+ test)
  ai/                      client, offline templates, Copilot tools, report facts, waste-pattern facts
  cv/                      CameraStation (several cameras per device, all cameras of the workspace, QR for phones),
                           CameraFeed (one camera), cameras.ts (saved settings, live status), station.ts (this device's
                           cameras), detector, device zones (+ test), camera sources
  relay/webSerial.ts       USB relay
  ui/                      Layout, pages (LiveTwin, RoomDetail, ScenarioLab, Reports, Setup, JudgeView), components
  test/fixture.ts          a small site for tests only
edge/edge.py               Python edge worker (+ --selftest)
firmware/relay/relay.ino   relay sketch
supabase/schema.sql        events table
```

## 4. Shared contracts

All shapes live in [`src/shared/types.ts`](../src/shared/types.ts).

| Type | Meaning |
| --- | --- |
| `Site` | The customer's configuration: organization, building, location, currency, tariff, grid factor, empty delay, left-on assumption, alert languages, floors, rooms. Exported and imported as JSON |
| `Room`, `Device` | Rooms with capacity, area, volume, devices with ratings, camera zones (`L*` lights, `F*` fans, `S*` screens) and Brick Schema classes |
| `CvReading` | A camera's message every 2 s: head-count, zone states, confidence. Nothing else |
| `SensorReading` | Any other input: occupancy, device states by id or type, metered power, with its source |
| `RoomState` | Live room: occupancy known or not, devices on or off where observed, watts (metered or observed), CO2, status (`occupied`, `idle`, `waste`, `unknown`), input sources, energy and money |
| `FactsPack` | The only numbers the AI may quote, with the currency |
| `Command`, `CommandAck` | A switch-off and its result: relay or not, confirmed by camera, sensor or staff |
| `ScenarioComparison` | A policy against the baseline: p10/p50/p90 savings on shared seeds |
| `Snapshot` | What phones receive every 2 s, including the layout, so they need no setup |

## 5. How a room's state is decided

| Field | Taken from, in order |
| --- | --- |
| Occupancy | Fresh camera (6 s), then sensor occupancy (15 min), else unknown |
| Each device | Sensor by device id, then camera zone, then sensor or staff report by device type, else not observed |
| Watts | Metered room power (15 min), else the sum of observed-on device ratings |
| Indoor CO2 | A room air sensor (15 min), else the estimate from the head-count; temperature and humidity shown when a sensor reports them |
| Status | Unknown without occupancy; occupied while people are present or within the empty delay; then waste above 10 W, else idle |
| Staff reports | Count until people come back into the room |
| Savings | While a command holds: load at the moment of the command minus the observed load, counted only as devices are seen off |

## 6. Realtime and storage

Two channels per workspace, on `BroadcastChannel` and, with keys, Supabase. The private channel `twin:<id>:<secret>` carries everything below; only members of the workspace receive its name. The public channel `pub:<id>:<key>` carries snapshots only and is named in the public view's link. Every message is also delivered in the tab that sent it, so a camera running beside the twin feeds it directly.

| Message | From | To |
| --- | --- | --- |
| `reading` | camera page, edge worker | twin |
| `sensor` | `/api/ingest`, staff reports | twin |
| `tip` | `/api/report` (public view link's key) | twin: a 10-minute "Reported by a visitor" check unless people are seen |
| `snapshot` | twin | public view (public channel), other screens |
| `command` | `/api/command`, `/api/telegram` | twin |
| `ack` | twin | everyone |
| `camera` | any device that saves a camera's settings | every open Cameras page |
| `site` | Setup after a save | every screen, which fetches the site again |

Tables: `workspaces` (name, scrypt hash), `sites` (each workspace's site under its id, camera settings under `<id>/cameras`) and `events` (the action log, `payload.site` names the workspace); row-level security on, no public policies. Messages from the public channel are validated before they touch the twin. Recorded utilization is an hour-of-week summary per room kept in the operator's browser.

## 7. Numbers

Customer settings (`Site`): currency, tariff per kWh, grid kg CO2 per kWh, empty delay (default 300 s), left-on probability (default 40 %). India preset: ₹8.73 (BESCOM LT-2 ₹8.17 + ₹0.56 true-up) and 0.727 (CEA).

Engineering constants (`src/shared/config.ts`): default ratings (light 20 W, fan 75, AC 1500, projector 300, PC 120), person score 0.4, median of 5, fan motion threshold 6, CO2 0.005 L/s per person, 420 ppm outdoors, 1000 ppm alert, 2 air changes per hour, AI cooldown 300 s.

Formulas: `kWh = W × s / 3,600,000`; `cost = kWh × tariff`; `CO2 = kWh × factor`; `dC/dt = N·G·10⁶/V − (Q/V)(C − C_out)`; EPI = weekly kWh × 52 / floor area.

## 8. Modules and checks

| Module | Check | Status |
| --- | --- | --- |
| Site and setup | Location search fills presets; templates add rooms with unique ids; save validates; automatic layout re-packs floors and keeps drawn shapes | Tested and verified in browser |
| Twin | Camera loop (empty delay, waste, alert, offline card, switch-off, camera confirmation, release); unknown rooms draw nothing; sensor occupancy, device states and metered power; staff confirmation credited to staff | Tested |
| Camera | Person detection 0.98 and 0.95 on sample photos; face found; light zones by brightness; fan zones by motion; privacy inspector | Tested and verified |
| Edge worker | Self-test; lamp video toggles its zone in real time; same detections as the browser | Tested |
| What-if engine | Deterministic; no policy worse than baseline; fast; payback and EPI shown | Tested |
| AI | Grounding rejects invented figures in any currency; retry then Gemini; 503 without keys; templates offline; Surveyor clamps boxes | Tested |
| Integrations | Ingest key and validation; signed webhook; Telegram secret; languages | Tested |
| UI | Every page at 375 px without sideways scroll; light and dark; empty states lead to Setup; axe-core finds no violations on any of the seven pages | Verified in browser |
| Campuses | Floors carry an optional building label; floor switcher, league and 3D view show it | Verified by type check and build |
| Overcooling advice | "AC set too cold" when an AC is on and a room sensor measures more than 1 °C below 24 °C; code computes the saving at 6 % per degree (BEE) | Tested |
| Cooling advice | "AC on in mild weather" when an AC is seen on in an occupied room and Open-Meteo reports 24 °C or less (the BEE default setting) | Tested |
| Energy League | Ranks only floors with watched rooms; AI shout-out with offline fallback | Verified in browser |
| Rooftop solar | Generation, bill saved, CO2 and payback from the site's measured sunshine (Open-Meteo, last 92 days) and a 0.75 performance ratio | Tested and verified in browser |
| Opening hours | The what-if engine models sessions inside the site's own hours and days; closed days model no load | Tested |
| Activity log | Reports page: every event of the session, filter by kind, CSV download (formula injection defused), stored 30-day summary when available | Tested |
| Automatic switch-off | Setup option (off by default; rooms can be marked "Never auto-off"): a watched room empty with power on for the empty delay plus N minutes gets one switch-off command, origin `policy`, until people return; commands are issued after the tick saves its state | Tested |
| Waste patterns | Room-hours (weekday and hour) when empty rooms are most often left on, from observed data only; Patterns card with AI explanation; Copilot tool; report section | Tested |
| Camera health | "Camera offline" alert when a room's camera has been silent 1 to 60 minutes; per-room camera list with live or silent, source and confidence | Tested and verified in browser |
| Phone cameras | Screen wake lock while running (re-taken when the page returns to the front); installable web-app manifest | Verified |
| Learned hours | Setup suggests opening hours and days from observed occupancy (10 % busy threshold, after 5 occupied hours) | Tested |
| Weekly digest | Mondays via Vercel Cron: wasteful rooms, commands and confirmations from the real event log, sent to Telegram | Tested |
| Audit trail | The twin uploads its events every 30 s; the report includes the stored 30-day action log | Tested |
| Workspaces | Create and open with name and password; wrong name and wrong password answer alike; forged, expired and other-secret tokens refused; every private route reads and writes only the token's workspace; browser and server derive the same ids; storage keys namespaced per workspace | Tested and verified in browser |
| Camera station | Several cameras per device and per room; stable ids `<room>/cam-<n>`; zones saved per camera to the workspace; cameras keep running on other pages of the tab and resume after a reload; same-tab readings reach the twin; worker timers keep pace in background tabs; QR adds a phone | Tested and verified in browser |
| Set up with AI | Fixed draft shape; numbers not in the text dropped and listed; template values listed; closing tag cannot be smuggled; nothing saved until Save | Tested and verified in browser |
| Free hosting | One function for the whole API (Vercel Hobby allows 12) | Tested |

## 9. Security

- Secrets only in environment variables; `.env.example` lists them with no values.
- Workspaces: scrypt password hashes with a random salt; HMAC-signed sessions (`Authorization: Bearer`), 30 days; one answer for unknown name and wrong password; login rate-limited. Every private route acts only on the token's workspace.
- Per-workspace sensor key on ingest; the public view key on visitor tips; Telegram's secret header on its webhook, and button taps accepted only from the workspace's linked chat; all compared in constant time.
- Outgoing commands signed with HMAC-SHA256 (`x-pratibimb-signature`).
- Every request body validated with Zod and size-limited; AI and ingest rate-limited per IP.
- Realtime: the private channel's name carries a secret derived on the server, so only members can read or send on it; visitors get a separate snapshot-only channel. Messages are still validated before they touch the twin. Known ceiling: the names are bearer secrets; Supabase private channels with Realtime Authorization are the upgrade path.
- Set up with AI: the description is data inside delimiters, the answer is a fixed Zod shape, numbers not in the text are dropped, and only a person's Save stores anything.
- `vercel.json` sets CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, and a `Permissions-Policy` allowing only camera, microphone and serial.
- AI receives numbers and room names only. The AI Surveyor is the one feature that sends a photo, and its screen says so.
- CCTV credentials stay in the local MediaMTX config.

## 10. Roadmap

| Item | Why |
| --- | --- |
| Organization id on the stored site, and per-organization access | Multi-tenant hosting; a deployment shares one site today |
| Utilization and event history in the database | Month-long evidence for audits |
| Learn the left-on probability from observed history | Replace the last modelling assumption with data |
| More grid factor presets (India, UK, US and Singapore are in, each with its source) | Faster onboarding elsewhere |
| Photoreal room scans | Investor and judge appeal; not needed for savings |

## 11. Run, test, deploy

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

Deploy: import the repository in Vercel and add the keys from `.env.example`. Run `supabase/schema.sql` once. Register the Telegram webhook:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<app>.vercel.app/api/telegram&secret_token=<SECRET>"
```
