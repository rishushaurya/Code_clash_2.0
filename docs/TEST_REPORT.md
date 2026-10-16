# Test report

What was tested for release 2.0, how, and the results. Run the automated parts yourself with `npm test` and `node tests/journey.mjs` (the second needs `npm run dev` running).

## Summary

| Check | Result |
| --- | --- |
| Unit and route tests (`npm test`, Vitest) | 213 of 213 pass |
| Type check (`npx tsc -b`), production build (`npm run build`), lint (`npm run lint`) | Pass; lint shows warnings only, no errors |
| End-to-end API journey on local storage (no Supabase) | Pass: workspaces, site, events, encrypted keys, camera readings, the minute tick, state, health |
| End-to-end API journey against Supabase (`tests/journey.mjs`) | 26 of 35 pass; the other 9 need the tables in `supabase/schema.sql`, which the live project has not run yet |
| A fresh clone with no `.env`: `npm install`, `npm run dev` | Works with no account and no key; storage in `.pratibimb-data/`; the minute tick ran on its own |
| Accessibility (axe-core 4.10, every page, light and dark) | Fixed every finding of the first run (landmarks, link name, tab contrast, heading order) |
| Every page at 1024 px | No sideways scrolling, no error screens |

## What the automated tests cover

- **Energy and air:** energy, cost and CO₂ maths; the single-zone CO₂ model; measured CO₂ replacing the estimate.
- **Cameras:** merging several cameras per room; light zones against a wall reference; fan motion; calibration gap; coverage per room; auto-find of lights and fans; inferred device states and manual overrides.
- **Twin:** the full loop with real inputs only (empty delay, waste, alert, switch-off, camera confirmation); the Emptying countdown; sensors and staff reports; camera-offline alerts; the pure room computation shared by browser and server.
- **What-if engine:** deterministic runs, no policy worse than today, payback and energy intensity.
- **3D:** the model from the site, wall and door layout, collision, device placement, the OpenStreetMap parser, and every design operation (add, resize, restyle, refurnish, move, duplicate, remove, generate from an outline), each producing a valid site.
- **AI:** grounding by unit and period; code-written actions; one card per room; reports without raw JSON; the Assistant's tools; provider fallback; workspace keys for every provider; Set up with AI dropping invented numbers; the design route keeping only operations on real rooms and floors.
- **Server:** every route through the router; workspaces (hashing, signed sessions, forged and expired tokens); roles; isolation between workspaces; key encryption that never stores or returns the value; the minute tick; Telegram per workspace; Shelly and Home Assistant dispatch; rejection of private-network addresses.
- **Local storage:** the PostgREST filters the server uses, and the whole journey with no Supabase.

## Live checks on localhost

Run against the team's real Supabase, Groq and Gemini keys with throwaway workspaces, deleted afterwards.

| Feature | Result |
| --- | --- |
| Set up with AI from a plain description | 4 rooms with every device count, hours and tariff read correctly |
| Sensor readings into the twin | Reached the open twin in about 2 seconds |
| Scenario Lab, reports, room pages | Work; report written by the AI with the measured CO₂ |
| Assistant: "which room uses the most power" | Uses the live summary tool and answers correctly |
| 3D building: facade, roof, grounds, furniture, room colours | Renders; cutaway and single floors show the rooms and furniture |
| Design with AI: "add a 40-seat classroom on the second floor with 2 ACs, Library walls light blue, two more plants" | Three correct changes proposed, applied, saved and shown in 3D |

## Still to check by hand

These need real devices and cannot run in an automated browser:

| Check | How |
| --- | --- |
| Camera on Chrome desktop, Android Chrome and iPhone Safari | Start, reload, put the tab in the background, unplug a USB camera |
| Two cameras in one room | Both live; counts merged as set in Site settings |
| Auto-find on a real ceiling | Switch the lights off and on; check the proposed zones |
| Telegram end to end | Connect a bot in Keys and AI, trigger an alert, tap Switch off |
| Smart plug or Home Assistant | Map a plug to a room in Connections, switch off from the twin |
| AI designer with a room photo | Paste a photo of a room and ask for its design on another room |
