# Changelog

Newest entry first. Every session, human or AI, adds one entry.

## Session 26 · AI routes reach the server on Vercel; voice in every browser · Claude Opus 5.5

**What:**
- **Root cause of "The AI could not read it" on the live site.** Vercel matched the catch-all file `api/[...route].ts` for one path segment only. `/api/workspace` worked, but every `/api/ai/...` request ended at Vercel's own 404 before reaching the app.
  - The router is now `api/router.ts`, and `vercel.json` rewrites `/api/<path>` to `/api/router?path=<path>`.
  - Still one function. Files take priority over rewrites, so the router never loops.
- **Voice works in every browser.** Brave switches off the browser's speech service ("network" error) and Firefox has none.
  - Speak (Set up with AI) and the Copilot's microphone now record with MediaRecorder.
  - The new `/api/ai/transcribe` sends the recording to Groq Whisper (`whisper-large-v3-turbo`), with English, Hindi or Kannada.
  - The audio is passed through, never stored.
  - Microphone errors are explained in plain words.
- **Smaller fixes:**
  - "24-7" (how Whisper writes it) now counts as open all week;
  - Vercel's function type check gets the Node types (`tsconfig.json`).

**Created / Modified:**
- `api/router.ts` (renamed), `api/_routes/ai/transcribe.ts` (new), `vercel.json`, `vite.config.ts`, `tsconfig.json`;
- `api/_routes/ai/setup.ts`, `api/_routes/handlers.test.ts`;
- `src/ai/client.ts`, `src/ui/components/{speech.ts,AiSetup.tsx,Copilot.tsx}`;
- README, BUILD_SPEC, DEPLOY, USER_GUIDE.

**Checks:**
- 87 tests pass, including the router reached through `?path=` and the transcribe route; `npx tsc -b` and `npm run build` pass.
- Live on the team's keys through the local server:
  - a spoken WAV sample came back as "Main block in Bengaluru. Room 1 has two lights and one fan. The bathroom has one light. Open 24-7.";
  - wrong audio type answered 415 and no session 401;
  - the test workspace was removed afterwards.
- The live site showed the cause before the fix: `/api/ai/*` answered Vercel's NOT_FOUND while `/api/workspace` reached the app.

**Next:**
- Push.
- Check `https://<site>/api/ai/setup` answers 401 (reaches the app) instead of NOT_FOUND.
- Then try Set up with AI and Speak in Brave.

## Session 25 · Going live: key formats, models, storage errors, voice setup · Claude Opus 5.5

**What:**
- **Deploy fixes:** `vercel.json` pins the install and build commands (the project's install command had been set to `npm run build`).
- **New key formats:** Supabase `sb_secret_` keys go in the `apikey` header only. Gemini is called through its own API, which accepts `AQ.` and `AIza` keys.
- **Pasted settings:** a Supabase URL with `/rest/v1/`, or values with spaces, line breaks or quotes, now work. The public key in the secret's place is named.
- **Storage errors explained:** every storage error and `/api/health` now say what Supabase answered.
- **Current models:** defaults are `openai/gpt-oss-120b` (Groq) and `gemini-flash-latest`, checked against both providers' model lists with the team's keys. Groq handles photos only when `GROQ_VISION_MODEL` is set.
- **`npm run check:keys`** tests every key in `.env` without printing it.
- **Set up with AI reads informal descriptions** (a home with "room 1 (1 fan 1 light)", "bath room", "24/7"):
  - the server reads the answer leniently, so one odd field no longer loses the whole answer;
  - code makes room ids from names, maps home rooms to "other", fills floor names and reads numbers sent as text;
  - zero counts for devices never mentioned are left out quietly.
- **Voice:**
  - "Set up with AI" has **Speak** (English, Hindi, Kannada) through the browser's own speech recognition, and reads a short summary back;
  - Devanagari and Kannada digits become 0-9 so spoken numbers pass the server's check;
  - the Copilot and the setup dialog share `src/ui/components/speech.ts`.
- **Blue for AI:** the "Set up with AI" button uses a new `--ai` token (blue), so it stands out.

**Created / Modified:**
- `vercel.json`, `scripts/check-keys.mjs`, `package.json`;
- `api/_lib/{db,http,llm,auth}.ts`, `api/_routes/{workspace,site,cameras,events,health,status}.ts`, `api/_routes/ai/setup.ts`, the API tests;
- `src/twin/realtime.ts`, `src/ui/components/{AiSetup,Copilot}.tsx`, `src/ui/components/speech.ts` (new), `src/ui/pages/Setup.tsx`, `src/index.css`;
- `.env.example`, DEPLOY, DESIGN_SYSTEM, USER_GUIDE.

**Checks:**
- 85 tests pass; `npx tsc -b` and a clean-clone `npm install` and `npm run build` pass.
- `npm run check:keys` passes against the team's real Supabase, Groq, Gemini and Telegram.
- Against the real services on localhost:
  - workspace create, open, wrong password, site, camera and event writes, and an AI recommendation all work;
  - the team's own home description produced 5 rooms with their devices and 24/7 hours.
- The test workspaces were deleted afterwards.

**Known issues:**
- The deployed site sits behind Vercel Authentication; turn it off for production so phones and the public view can open it.
- Speech recognition needs Chrome, Edge or Safari.

**Next:**
- Set the Vercel environment variables (`VITE_` ones as Config, the rest as Secret).
- Push, then open `/api/health` and create the first workspace.

## Session 24 · Launch: workspaces, camera station, Set up with AI, free hosting · Claude Opus 5.5

**What:** The plan in `docs/LAUNCH_PLAN.md`, built and tested.
- **Workspaces.** The first page creates or opens a workspace with a name and a password. Passwords are scrypt-hashed in Supabase; sessions are HMAC-signed tokens; each workspace gets its own site, camera settings, events, live channels, sensor key and Telegram chat. Without server storage, a workspace is kept in the browser (PBKDF2). This replaces the operator token and the per-deployment site key.
- **Deployment blockers fixed.** The API is now one function (`api/[...route].ts` routing to `api/_routes`), because Vercel Hobby allows 12 and there were 15. The public read policy on `events` is gone. The live channel name now carries a server-derived secret, and the public view has its own snapshot-only channel; before, anyone with the public key could send commands on `twin:site`.
- **Camera bugs fixed (the "camera not saved, not sending, not calculating" report).**
  - A camera opened in the twin's own tab never reached the twin: `BroadcastChannel` does not deliver to its sender. `send()` now also delivers in the same tab.
  - Going back stopped the camera: the new camera station stays mounted at the app root.
  - Each visit made a new random camera id, leaving a false "camera offline": ids are now stable (`LH-1/cam-1`).
  - Zones were per room and per browser: they are now per camera and saved to the workspace.
  - Hidden tabs slowed timers to once a minute: detection and the twin tick now run on a worker timer.
  - The rate limiter shared one counter across routes.
- **Camera station.** Several cameras per device and per room; resume after reload; every camera of the workspace with live status by floor and room; QR codes that sign a phone in and open its camera; a warning when on and off calibrations look the same.
- **Set up with AI.** Describe the building (a format is offered); the AI returns a fixed draft shape, the server drops every number not in the text, code builds the rooms, and the person reviews before Save.
- **Setup** also has the Telegram chat id, the workspace's sensor key, the edge worker's channel, and "Cameras split the room".
- **Telegram:** one bot per deployment, a chat per workspace; `/chatid` replies with the id; taps only accepted from the linked chat; the weekly digest goes to every workspace.
- **Edge worker** takes the workspace channel (`PRATIBIMB_CHANNEL`) and a stable `--camera` number.

**Created:**
- `api/[...route].ts`, `api/_lib/auth.ts`;
- `api/_routes/{workspace,cameras}.ts`, `api/_routes/ai/setup.ts`;
- `src/shared/{workspace,timer}.ts`;
- `src/cv/{CameraStation,CameraFeed}.tsx`, `src/cv/{cameras,station}.ts`;
- `src/ui/pages/Workspace.tsx`, `src/ui/components/AiSetup.tsx`;
- `docs/DEPLOY.md`, `docs/LAUNCH_PLAN.md`.

**Modified:**
- every API handler, moved to `api/_routes`;
- `src/twin/{realtime,store,usage}.ts`, `src/shared/{site,types,config}.ts`, `src/ai/client.ts`;
- `src/App.tsx`, `src/ui/Layout.tsx`, `src/ui/pages/{Setup,JudgeView,RoomDetail}.tsx`, `src/ui/components/ConnectInputs.tsx`;
- `vite.config.ts`, `supabase/schema.sql`, `.env.example`, `edge/edge.py`;
- README, BUILD_SPEC, INTEGRATIONS, USER_GUIDE.

**Removed:** `src/cv/CameraPage.tsx`.

**Checks:**
- 79 tests pass; `npx tsc -b` and `npm run build` pass; lint clean apart from shadcn's notes; edge self-test passes.
- In the browser:
  - created and reopened a local workspace, with wrong password and taken name refused;
  - a camera in the twin's tab fed the twin and kept sending on other pages and in a hidden pane;
  - a reload resumed it;
  - the Set up with AI review filled the form without saving;
  - axe found no violations on the sign-in, Cameras, Setup and Live twin pages, at desktop and phone widths.

**Known issues:**
- Supabase, Groq, Gemini and Telegram are not exercised against the live services here, because there are no keys in this environment; their routes are covered by tests with mocked services.
- Rate limits are per server instance.
- Channel names are bearer secrets; Supabase private channels are the upgrade path.

**Next:**
- Deploy following `docs/DEPLOY.md` and run its section 8 checklist on the live address.
- Then: building-level totals for campuses; pitch deck from the docs.

## Session 23 · User guide · Claude Opus 5.5

**What:** A step-by-step user guide: how each part of Problem Statement 04 is met and what goes beyond it, running locally, building setup, connecting cameras, every screen, keys for the full product, deployment and troubleshooting. Re-checked localhost: the app starts on port 5173; the only console error is the expected 503 from `/api/site` without Supabase keys.
**Created / Modified:** `docs/USER_GUIDE.md` (new), `README.md` (documents table).
**Checks:** 65 tests pass, `npx tsc -b` and `npm run build` pass; every screen name and button label in the guide checked against the code.
**Known issues:** Supabase, AI keys and Telegram still untested against live services (no keys in this environment).
**Next:** Building-level totals for campuses; pitch deck from the docs; more country presets with sources.

## Session 22 · Code health · Claude Opus 5.5

**What:**
- **Cleared every React lint warning** (oxlint): state that follows a prop is set during render; the location search no longer sets state synchronously in an effect; the power line lives in the snapshot store; utilization and solar derive their values during render; the Room page uses the tick time instead of reading the clock while rendering.
- **What remains in the lint output** is shadcn's own fast-refresh notes on generated components.

**Checks:**
- 65 tests pass; the type check, build and Python self-test pass.
- No emojis anywhere.
- In the browser, location search ("London" returns three places), the solar card and the console were clean.

**Next:**
- Building-level totals for campuses.
- Pitch deck built from the docs.
- More country presets, with sources.

## Session 21 · Campuses: buildings as floor groups · Claude Opus 5.5

**What:**
- **Floors can carry an optional building name,** so one site covers several buildings of a campus without a new model.
- **Where it shows:** Setup's "Buildings and floors" editor, the twin's floor switcher, the room floor menus, the Energy League and the 3D view.

**Checks:** 65 tests pass; type check and build pass.

**Next:**
- Building-level totals.
- Pitch deck.

## Session 20 · Overcooling advice · Claude Opus 5.5

**What:**
- **"AC set too cold" alert:** fires when an AC is seen on and a room sensor measures more than 1 °C below 24 °C. Code computes the saving share at about 6 % per degree, as cited by BEE and in a government answer in the Rajya Sabha (20 °C to 24 °C is about 24 %). The card says what to do and why.
- **Grounding:** the AI may quote BEE's 6 % per degree, alongside the 1000 ppm guideline.

**Checks:** 65 tests pass; build passes.

**Next:**
- Multi-building sites.
- Pitch deck.
- Humidity advice once enough sites report humidity.

## Session 19 · Measured indoor air, docs refresh · Claude Opus 5.5

**What:**
- **The sensor API accepts `co2ppm`, `temperatureC` and `humidity`.** A measured CO2 value replaces the head-count estimate and drives the CO2 alert. The Room page labels the value "measured" or "estimated" and shows temperature and humidity.
- **Docs refresh:** BUILD_SPEC folder map and DESIGN_SYSTEM screens updated with the recent features. A stale-term search found nothing outdated.

**Checks:** 64 tests pass, including a measured 1,180 ppm raising the CO2 alert. Build passes. Bundle: core 135 KB gzipped, public view page 2.3 KB.

**Next:**
- Thermal-comfort advice from measured temperature and humidity.
- Multi-building sites.
- Pitch deck.

## Session 18 · Activity log with CSV export · Claude Opus 5.5

**What:**
- **Activity log card on the Reports page:** every event of the session, filtered by kind (alerts, commands, confirmations, status, AI cards). It downloads as CSV for auditors and shows the stored 30-day summary when server storage is configured.
- **Security:** the CSV export defuses spreadsheet formula injection, since room names are customer-typed. Any value starting with `=`, `+`, `-`, `@`, tab or carriage return gets an apostrophe prefix.

**Checks:** 63 tests pass, including the CSV quoting and the injection guard. Build passes.

**Next:**
- Low-confidence camera hint.
- Pitch deck from the docs.
- Review the docs end to end for consistency.

## Session 17 · Auto-off exceptions, live power on the public view · Claude Opus 5.5

**What:**
- **"Never auto-off" per room in Setup,** for labs with long runs or server rooms; the twin skips those rooms.
- **The public view shows building power for the last few minutes:** a hand-drawn SVG line, so the phone page loads no chart library.

**Checks:** 62 tests pass, including an exempt room never being switched. Build passes. In the browser, the public view at 375 px showed the live line.

**Next:**
- Operator view of the stored event log.
- Low-confidence camera hint.
- Pitch deck from the docs.

## Session 16 · Automatic switch-off · Claude Opus 5.5

**What:**
- **"Automatic switch-off" in Setup** (off by default, N minutes). A watched room left empty with power on for the empty delay plus N minutes gets one switch-off command (origin `policy`), sent to the USB relay or the command webhook, until people return. An "Auto-off" badge in the header shows it is on.
- **Bug found by the new test and fixed:** a command issued inside a tick was overwritten by the tick's final state write, so it was sent twice. Auto-off commands now go out after the tick saves its state.

**Checks:** 61 tests pass; build passes. In the browser, the Setup toggle saved and the header badge appeared.

**Next:**
- Live load chart in the public view.
- Operator view of the stored event log.
- Per-room auto-off exceptions (labs with long runs).

## Session 15 · The AI analyses patterns, not just alerts · Claude Opus 5.5

**What:**
- **Waste by hour of week:** empty-with-load time is now recorded per room and hour of week. `wastePatterns()` returns the room-hours where empty rooms are most often left on, counting only hours watched empty for 20 minutes or more.
- **Patterns card on the Live Twin,** with an "Explain" button. The AI writes two sentences from the observed patterns, or a template does offline.
- **Copilot tool `patterns`:** answers questions like "when do rooms usually get left on?".
- **Report section "When waste happens".**
- **Refactor:** pattern helpers live in `src/ai/patterns.ts`.

**Checks:** 60 tests pass; build passes.

**Next:**
- Turn a pattern into an auto-off schedule suggestion.
- Live load chart in the public view.
- Operator view of the stored event log.

## Session 14 · Camera health · Claude Opus 5.5

**What:**
- **"Camera offline" alert** when a room's camera has been silent for more than a minute and less than an hour (after that it counts as removed). The offline card says what to check: battery, Wi-Fi, page in front. The alert clears as soon as readings return.
- **Camera list on the Room page:** each reporting camera with its source, live or silent time, and confidence.

**Checks:** 59 tests pass, including the camera going silent and coming back. Build passes. In the browser, a phone camera showed as live with confidence 0.82.

**Next:**
- Operator view of the stored event log.
- Live load chart in the public view.
- Consider a confidence threshold for low-quality cameras.

## Session 13 · Phone cameras stay awake, installable app, health check · Claude Opus 5.5

**What:**
- **Screen wake lock on the camera page:** the browser's Screen Wake Lock API is held while running and re-taken when the page returns to the front, so a phone on a tripod keeps detecting.
- **`manifest.webmanifest`:** Pratibimb installs to a phone's home screen.
- **`/api/health`:** returns 200 when healthy and 503 when configured storage is unreachable.

**Checks:** 58 tests pass; type check passes; the health endpoint and the manifest respond on the dev server.

**Next:**
- Operator view of the stored event log.
- Per-room camera health: stale or low-confidence cameras.
- Live load chart in the public view.

## Session 12 · Weekly digest, learned opening hours · Claude Opus 5.5

**What:**
- **Weekly Telegram digest:** `/api/digest` runs on Mondays through Vercel Cron, authenticated with `CRON_SECRET`. It reports the week's empty-room alerts per room, commands and confirmed switch-offs, from the stored event log only.
- **Learned opening hours:** Setup suggests opening hours and days from observed occupancy, using hours busy at least 10 % of the time, once 5 occupied hours have been recorded.
- **Refactor:** a shared `api/_lib/db.ts` for Supabase access, used by the site, events and digest endpoints.

**Checks:** 57 tests pass; type check and build pass.

**Next:**
- A health endpoint that tests storage reachability.
- An operator view of the stored event log.
- PWA install for phone cameras.

## Session 11 · Opening hours, audit trail, solar in the report · Claude Opus 5.5

**What:**
- **Opening hours and open days in Setup** (default Monday to Friday, 9 to 17). The what-if engine models sessions only inside them, with the cleaner's round an hour after closing. Older site files load with the default.
- **`/api/events`:** the twin uploads its events every 30 seconds with the operator token and keeps the queue through failures. `GET` returns a 30-day summary, scoped to the site key.
- **Report additions:** the stored action log, and a "Rooftop solar (modelled)" section from the site's measured sunshine. A shared `src/shared/openMeteo.ts` serves both the solar card and the report.

**Checks:** 55 tests pass; build passes. In the browser, the report included the solar section with 5.78 kWh/m² per day measured at the site.

**Next:**
- Per-room overrides of opening hours.
- Learn session hours from observed occupancy.
- Monthly scheduled report.

## Session 10 · Tenant isolation, rooftop solar, keyboard zones · Claude Opus 5.5

**What:**
- **Fixed a cross-tenant leak:** every deployment used the same realtime channel. `VITE_SITE_KEY` now names the channel and the stored site row in the browser, the server and the edge worker.
- **Rooftop solar what-if** in the Scenario Lab, based on the site's measured daily sunshine (Open-Meteo, past 92 days) and a 0.75 performance ratio. It shows generation, bill saved, CO2 avoided, payback (with an installer quote) and share of modelled use.
- **Camera zones by keyboard:** Enter places a box, the arrow keys move it, Shift plus the arrows resizes it, and Escape finishes.

**Checks:** 52 tests pass; type check, build and the Python self-test pass. In the browser, the solar card showed 5.78 kWh/m² per day measured at the site.

**Next:**
- Event and usage history on the server for month-long reports.
- A per-room schedule input to sharpen the what-if baseline.
- A report section for solar.

## Session 9 · Accessibility, cooling advice, Energy League shout-outs · Claude Opus 5.5

**What:**
- **Accessibility audit with axe-core** (loaded only in the test browser) on all seven pages. Fixed:
  - slider handles without names;
  - floor tabs with no tab panels, replaced by a segmented control with `aria-pressed`;
  - a missing `<h1>` on several pages;
  - unlabelled room-id fields and the hidden import input;
  - missing `<main>` landmarks on the camera page and public view.
  - Contrast: the highlight darkened to `#AD4F2B` and the status colours deepened so every text passes 4.5:1. The audit now finds zero violations.
- **New rule, "AC on in mild weather":** when an AC is seen on in an occupied room and the outdoor temperature is at or below 24 °C, the BEE default for star-labelled ACs since January 2020. Outdoor temperature now comes from Open-Meteo and refreshes every 30 minutes; the advice switches to fan mode when the outdoor air is poor.
- **Energy League:**
  - ranks only floors with watched rooms;
  - a Shout-out button has the AI write a two-sentence nudge from the league numbers, with an offline template.

**Checks:** 51 tests pass; type check and build pass; axe-core clean; shout-out verified in the browser.

**Next:**
- Organization id for multi-tenant hosting.
- Store usage and event history on the server.
- Keyboard-only way to mark camera zones.

## Session 8 · Shared site, visitor reports, more countries · Claude Opus 5.5

**What:**
- **Shared site file:** `GET`/`PUT /api/site` with a `sites` table. Every device loads the shared site on start, and Setup saves push to it. A local edit that failed to upload is pushed first, so it is never overwritten.
- **Phone cameras:** a camera page with no site uses the operator's live room list. This fixes phone cameras on other devices.
- **Visitor reports:** a "Lights left on here?" button on the public view, backed by `POST /api/report`. It raises a 10-minute "Reported by a visitor" check unless people are seen, and never changes device states.
- **More countries:** grid-factor presets with sources for the UK (DESNZ 2024), US (EPA eGRID 2023) and Singapore (EMA 2024); Setup shows each preset's source.

**Checks:** 50 tests pass; type check and build pass. In the browser, a visitor report from the public view raised the check card on the twin.

**Next:**
- Organization id for multi-tenant hosting.
- Store usage and event history on the server.
- Weekly AI digest for the Energy League.
- Accessibility pass on the camera page.

## Session 7 · Learning from data, onboarding, accuracy · Claude Opus 5.5

**What:**
- The twin measures how often empty rooms stay on, and Setup offers "use the observed value" for the Scenario Lab.
- A "Bring the building to life" guide on the Live Twin while no room has live input.
- Room boundary drawing on the camera page: only people whose feet are inside count. The Python worker does the same and also reads fan zones by motion.

**Checks:** 45 tests pass; type check, build and the Python self-test pass; lamp-video run still toggles its zone.

**Next:**
- Grid-factor presets for more countries, with sources.
- Supabase-backed site and history per organization.
- Browser check of the room boundary with a real camera.

## Session 6 · A product for any building, real data only, warm design · Claude Opus 5.5

**What:** Turned the one-building demo into a product any site can adopt. Removed every piece of demo data. New warm light design. New integrations.

**Removed:** the placeholder A Block model, the simulated live timetable, demo mode and its fast clock, the rupee-only money handling, the modelled utilization heatmap.

**Created:**
- `src/shared/site.ts`: the customer's site store, room templates, cited country presets, automatic floor layout, JSON schema, import and export
- `src/ui/pages/Setup.tsx`: location search (Open-Meteo geocoding), currency, tariff, grid factor, empty delay, languages, floors, rooms from templates, device ratings, integrations status, import and export
- `src/twin/usage.ts`: observed room-by-hour utilization
- `api/ingest.ts` (sensor API with key), `api/status.ts` (integration status), signed command webhook in `api/_lib/http.ts`
- `docs/INTEGRATIONS.md` (site file, sensor API, Home Assistant, webhook verification, CCTV), `docs/SITE_SURVEY.md` (generic survey, replaces the A Block one)
- `src/test/fixture.ts`; tests for sensors, staff confirmation, unknown rooms, fan zones, ingest, the webhook signature, languages and the layout

**Changed:**
- **Twin store rewritten:** occupancy from camera or sensor; devices from sensor, camera zone or staff report; metered power; "unknown" status; savings counted only after a camera, sensor or staff member confirms; confirmation credited to whoever saw it.
- **Camera page:**
  - fan zones by motion; screen zones by brightness;
  - the person detector runs on CPU (the WebGL GPU path misclassified);
  - any room from the site.
- **Money:** currency-neutral throughout (`inr` renamed to `cost`). The grounding check accepts any currency, and the prompts take the currency from the facts.
- **Telegram:** alerts in the site's chosen languages.
- **Public view:** draws from the snapshot layout, so phones need no setup.
- **Design:** warm light theme (ivory, ink buttons, terracotta highlight), Fraunces / Plus Jakarta Sans / JetBrains Mono, warm dark theme.
- **Docs:** README, BUILD_SPEC, DESIGN_SYSTEM, CLAUDE.md and `.env.example` rewritten for the product.

**Checks:** 43 tests pass; type check and build pass; Python self-test passes. In the browser:
- a fresh install shows only the Setup prompt;
- Setup with a city search and template rooms saves correctly;
- a camera room and a Shelly-style sensor room show correct observed watts;
- unknown rooms read "No data";
- no page scrolls sideways at 375 px.

**Known issues:**
- The site lives in the operator's browser; multi-device and multi-tenant storage is next on the roadmap.
- Grid factor presets exist only for India (cited); other countries type theirs in.

**Next:** Store the site and history in Supabase per organization; learn the left-on share from observed history; region-of-interest drawing on the camera page; more country presets with sources.

## Session 5 · Full build, then deeper checks · Claude Opus 5.5

**What:** Built the whole app, then added the 3D view, time travel, AI Surveyor, Python edge worker, utilization, payback and EPI.

**Fixed:**
- The relay now switches back on when people return.
- Camera-room savings are no longer always zero.
- Bundle halved by lazy-loading Supabase and the Sankey.
- Floor plan readable on phones.

**Checks:** tests, browser walk-throughs, and real person detection on sample photos.

## Session 4 · Full build · Claude Opus 5.5

**What:** Built the whole application: computer vision, live twin, simulation engine, grounded AI, commands, relay, Telegram and all five screens. Verified in the browser and with automated tests.

**Created:**
- App: `src/App.tsx`, `src/main.tsx`, `src/index.css` (design tokens mapped onto shadcn), `index.html`
- Shared: `src/shared/types.ts`, `config.ts`, `building.ts`, `building.a-block.json` (13 placeholder rooms, 352 devices)
- Simulation: `src/sim/engine.ts` (+ `engine.test.ts`)
- Twin: `src/twin/store.ts`, `energy.ts`, `co2.ts`, `merge.ts`, `rules.ts`, `realtime.ts` (+ `twin.test.ts`)
- AI client: `src/ai/client.ts`, `templates.ts`, `reportTemplate.ts`, `tools.ts`
- Computer vision: `src/cv/CameraPage.tsx`, `detector.ts`, `lightZones.ts`, `sources.ts`; models in `public/models/`
- Relay: `src/relay/webSerial.ts`, `firmware/relay/relay.ino`
- UI: `src/ui/Layout.tsx`, `pages/` (LiveTwin, RoomDetail, ScenarioLab, Reports, JudgeView), `components/` (FloorPlan, Metrics, AlertFeed, EnergyFlow, Copilot, status, states)
- Server: `api/ai/recommend.ts`, `report.ts`, `copilot.ts`, `api/command.ts`, `alert.ts`, `telegram.ts`, `api/_lib/` (grounding, llm, http, schemas, + 2 tests)
- Config: `vite.config.ts` (serves `/api` in dev), `vercel.json` (security headers), `tsconfig.api.json`, `scripts/copy-mediapipe.mjs`, `supabase/schema.sql`, `edge/mediamtx.yml`, `.env.example`, `.claude/launch.json`

**Decisions made while building:**
- Plain `fetch` to Groq and Gemini (both OpenAI-compatible) instead of the AI SDK; plain Telegram Bot API instead of grammY; Recharts' own Sankey instead of d3-sankey.
- `BroadcastChannel` links tabs of one browser when Supabase keys are missing, so the full loop runs offline.
- Detection runs on the main thread every 500 ms instead of a Web Worker; fast enough, far simpler.
- Copilot is two steps: the AI picks a tool, the browser runs the real engine, the AI explains the result.

**Checks:** 16 tests pass; `tsc -b` clean; production build passes. In the browser: twin, alerts with offline cards, Apply, Scenario Lab, report, judge view at 375 px, MediaPipe loading from local files, and the full loop (room empties, turns red after 20 s, Apply, camera sees dark, "verified by camera", people return and the hold clears).

**Known issues:**
- Room layout and wattages are placeholders until `docs/A_BLOCK_SURVEY.md` is filled in.
- The main bundle is about 230 KB gzipped; lazy-load the Sankey and Supabase if load time matters.
- Browsers slow timers in background tabs; keep the twin tab in front during the demo.
- Not built: AI Surveyor, 3D view, time-travel replay, Python edge worker.

**Next:** Fill the survey and replace `src/shared/building.a-block.json`. Add keys to `.env` and Vercel, run `supabase/schema.sql`, register the Telegram webhook, then rehearse the demo path in BUILD_SPEC section 8 with the real lamp and camera.

## Session 3 · Team of three, shortcuts, survey · Claude Opus 5.5

**What:** Split the work across Priyanshu Shaurya, Aditya Raj and Neev Pujari; mapped ready-made tools onto the build; turned the research plan's checklist and wow features into owned tasks.

**Created:** `docs/A_BLOCK_SURVEY.md`. **Modified:** `docs/BUILD_SPEC.md`, `docs/DESIGN_SYSTEM.md` (brand token renamed `--brand`; shadcn mapping), `README.md`, `CLAUDE.md` (skills to use every session).

## Session 2 · Decisions · Claude Opus 5.5

**What:** Team name Barfi; tariff ₹8.73/kWh (BESCOM LT-2 ₹8.17 plus the ₹0.56 true-up); every camera option documented; EPA figure confirmed (63 % less waste, 58 % energy savings, 5-minute delay).

## Session 1 · Planning · Claude Opus 5.5

**What:** Planning documents: `README.md`, `CLAUDE.md`, `docs/RESEARCH_MASTER_PLAN.md`, `docs/BUILD_SPEC.md`, `docs/DESIGN_SYSTEM.md`, `.env.example`, `.gitignore`, `LICENSE`.

<!--
Template:

## Session N · <module or topic> · <who / which AI>

**What:**
**Created / Modified:**
**Checks:**
**Known issues:**
**Next:**
-->
