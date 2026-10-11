# Pratibimb user guide

How to run Pratibimb, set up a building, connect cameras and sensors, and use every screen. To put it online, see [DEPLOY.md](DEPLOY.md); for each integration in depth, [INTEGRATIONS.md](INTEGRATIONS.md).

## 1. How it answers the problem statement

> Develop a Digital Twin of a building that integrates Computer Vision to monitor occupancy, lighting, and resource usage. Generative AI should analyze the data and generate recommendations to improve energy efficiency, indoor sustainability, and resource utilization.

| Part of the statement | Where it lives | How it works |
| --- | --- | --- |
| Digital twin of a building | Live twin, Room pages, Scenario Lab | Every room's live state on a floor plan and 3D view, updated every 2 seconds. It can look back (time travel), run forward (what-if policies) and act (switch-off commands). |
| CV: occupancy | Cameras page | MediaPipe person detection in the browser counts people inside a marked room boundary. |
| CV: lighting | Cameras page | A box around each light is read by brightness against an "on" and an "off" recording. |
| CV: resource usage | Cameras page, sensor API | Fans by motion, projector screens by brightness; meters and smart plugs through `/api/ingest`. |
| GenAI analyses the data | Alerts, Patterns, Copilot, Reports | The AI receives a facts pack computed by code and explains it. It cannot invent numbers: a grounding check rejects any figure not in the facts. |
| Recommendations: energy efficiency | Alert cards, Patterns | "Room empty with lights on" with a one-click switch-off and the saving; recurring waste such as "LH-1, Fridays at 16:00". |
| Recommendations: indoor sustainability | Room page, alerts | CO2 (measured or estimated from head-count) with ventilation advice checked against outdoor air quality; AC advice when outdoor air is mild or a room is overcooled. |
| Recommendations: resource utilization | Scenario Lab | Observed room-by-hour occupancy, underused large rooms, and a "move small classes" policy. |

### Beyond the statement

These go further than the statement asks, all on the same twin:

- **It acts, not just advises.** A switch-off goes to a USB relay, your control system (signed webhook) or a Telegram button, and counts as saved only after a camera, sensor or person confirms it.
- **Automatic switch-off** after N empty minutes, with exempt rooms.
- **What-if engine:** Monte Carlo comparison of policies with payback, plus a rooftop solar estimate from measured sunshine.
- **Audit report and activity log** (CSV) for energy audits such as NAAC 7.1.6.
- **Public view with QR codes:** anyone can see the building's live state and report lights left on.
- **Works anywhere:** any currency, tariff, grid factor, building or campus; alerts in English, Hindi or Kannada.
- **Privacy:** video never leaves the device; only numbers are sent.
- **Many customers, one deployment:** each workspace (a name and a password) keeps its building, cameras and data to itself.
- **Set up with AI:** describe the building in plain words; the AI fills the form for you to review.

## 2. Run it on your computer

You need Node.js 20.19 or newer (22 LTS recommended).

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. With no keys, everything below works on one computer: workspaces kept in this browser, cameras in tabs of this browser, the twin, the Scenario Lab, reports and the public view, with the AI answering from templates. Phones, Telegram, stored history and Set up with AI need the online version ([DEPLOY.md](DEPLOY.md)).

## 3. Open or create a workspace

The first page asks for a **workspace name** and a **password** (8 characters or more).

- **Create a workspace** for a new building or campus. Share the name and password only with your team.
- **Open a workspace** to continue on another computer.

Everything you do inside belongs to that workspace: rooms, cameras, live data, alerts, reports. Another team's workspace on the same address never sees it. The workspace menu at the top right shows the public view's QR code, a QR code that signs another device in, and **Sign out**.

## 4. Set up your building (Setup page)

The quick way: press the blue **Set up with AI** button, start from the suggested format, describe your building (or press **Speak** and say it, in English, Hindi or Kannada), and press **Read it into the form**. Plain, informal sentences work: "4 rooms, room 1 has 1 fan and 1 light, open 24/7"; rooms without ids get one (`R-1`, `BR-1`). Review the result (any number not in your text is left out and listed; values taken from room templates are listed too), press **Fill the form**, check it, and **Save**. The AI only fills the form; it saves nothing and can do nothing else.

By hand:

1. **Site and money:** search your city. Indian locations prefill INR, the BESCOM tariff and the CEA grid factor; the UK, US and Singapore prefill their own. Correct the tariff from your electricity bill.
2. **Opening hours** and days. After a few hours of camera data, Setup suggests your real hours.
3. **Buildings and floors:** one floor per level. For a campus, give each floor a building name.
4. **Rooms and devices:** add rooms from templates, then set each room's seats and its number of lights, fans, ACs, screens and PCs. With several cameras in one room, switch on **Cameras split the room** if each sees a different part (their counts are added); leave it off if they overlap (the largest count is used).
5. **Device ratings:** watts per device type. A connected meter overrides them.
6. **Automatic switch-off** stays off until you turn it on. Mark labs and server rooms **Never auto-off**.
7. **Integrations:** the Telegram chat id, the sensor key for `/api/ingest`, and the channel for the CCTV edge worker.
8. **Save.** Every device of the workspace takes the new rooms at once. **Export** keeps a JSON backup; **Import** loads one.

## 5. Connect cameras (Cameras page)

One device can run several cameras, and one room can have several cameras. Each camera keeps its own room boundary and zones, saved to the workspace.

**On this computer:** Cameras, **Add a camera on this device**: pick the room, keep "New camera", and choose the source:

- a camera of this computer (**Start**; press **Show camera names** to see which is which);
- **Back camera** on a tablet or phone;
- a CCTV stream address (WHEP, through MediaMTX) and **Open**;
- **Play a recorded video file** (lasts for this visit only).

**On a phone:** Cameras, **Add a phone** next to the room (or the QR code on a room's page). Scan it with the phone; it joins the workspace and opens the camera. Tap **Use this phone's rear camera** and mount the phone where it sees the room and its lights.

**Then, on each camera, open "Zones and calibration":**

1. **Room boundary, Mark:** drag around the floor of the room, so people in a corridor are not counted.
2. For each light and screen this camera can see: **Mark** a tight box around it, then **On** while it is on and **Off** while it is off. If both recordings look the same, a warning asks you to mark tighter and record again.
3. Fans need only the box: they are read from motion.
4. Zones this camera cannot see can stay empty; another camera can watch them.

Cameras keep running while you use the other pages in the same tab, and start again by themselves after a reload. **Every camera in this workspace** lists each camera, by floor and room, as Live, silent, or not running, with its count.

## 6. Use the twin

| Screen | What to do there |
| --- | --- |
| **Live twin** (`/`) | Rooms turn green (occupied), grey (idle), red (empty with power on) or dashed (no data). Act on alert cards with one click. Ask the Copilot. Drag the timeline to look back. |
| **Room** (click a room) | Devices on, off and not observed; its cameras with live status; CO2, temperature, humidity; staff can report "lights are off" to confirm a switch-off. The AI Surveyor counts devices from a photo. |
| **Scenario Lab** (`/lab`) | Compare a policy (auto-off, daylight, consolidate, combined) with today over modelled weeks, labelled **Modelled**; business case, payback, rooftop solar, observed utilization. |
| **Reports** (`/reports`) | One-click audit report; Download PDF; activity log as CSV. |
| **Public view** (`/live`) | What anyone sees from the public QR code, with "Lights left on here?". It needs no sign-in. |

**Switching devices off:**

- **USB relay:** plug in the board flashed with `firmware/relay/relay.ino` and press the cable icon (Connect relay) in the top bar, in Chrome or Edge (Web Serial).
- **Your control system:** set `COMMAND_WEBHOOK_URL`; every command is signed with `COMMAND_WEBHOOK_SECRET` and names the workspace.
- **No relay:** the command is shown, and the saving counts once a camera, sensor or staff member confirms the devices went off.

## 7. Check it works

```bash
npm test
```

Quick manual check: set up one room with one light, add a camera on it, mark and calibrate the light, stand in view with the light on (green), walk out (red after the empty delay), switch the light off (grey, and the saving appears). [DEPLOY.md](DEPLOY.md), section 8, has the full checklist for the online version.

## 8. Keys for the full product

All keys, where to get them free, and what each unlocks: [DEPLOY.md](DEPLOY.md), section 1. In short: Supabase (three keys) and `WORKSPACE_SECRET` for online workspaces and phones; `GROQ_API_KEY` or `GEMINI_API_KEY` for the AI; a Telegram bot for alerts.

## 9. Troubleshooting

| Symptom | Fix |
| --- | --- |
| A camera shows "Camera permission is needed" | Allow camera access in the address bar, then **Try again**. On a phone use the `https://` address. |
| A room stays "No data" | Nothing is watching it: add a camera for it or connect a sensor. |
| A light zone is always "on" | Mark the box tighter on the fixture and record **On** and **Off** again in the room's real lighting. |
| People in the corridor are counted | Mark the room boundary tighter. |
| A phone camera does not reach the twin | Both must be in the same online workspace; scan the QR code again. A workspace kept in one browser cannot reach phones. |
| Two cameras in a room double the count | Turn off **Cameras split the room** in Setup when their views overlap. |
| Speak does nothing or asks for permission | Allow the microphone in the address bar. Voice is written down on the server, so it works in every browser, Brave and Firefox included, but needs the online version with `GROQ_API_KEY`. |
| AI text looks like a template | No AI key, the free quota is used up for now, or the AI's answer failed the number check; the template is the safe fallback. |
