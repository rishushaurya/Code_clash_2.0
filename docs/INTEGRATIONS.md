# Integrating Pratibimb

Pratibimb works with whatever a building already has. Four inputs and two outputs cover almost every site.

| Direction | Channel | What it carries | Auth |
| --- | --- | --- | --- |
| In | Cameras page (`/camera`) on any laptop, phone or USB camera; several cameras per device and per room | Head-count, lights, fans, screens | Workspace session; video never leaves the device |
| In | Python edge worker (`edge/edge.py`) on a campus machine | The same, from CCTV over RTSP | Supabase anon key and the workspace's channel (Setup) |
| In | `POST /api/ingest` | Occupancy, device states, metered power from any sensor or system | `x-api-key` = the workspace's sensor key (Setup) |
| In | Staff report buttons on each room page | What a person sees in the room | Workspace session |
| Both | Shelly Cloud (section 7) | Each plug's or relay's state and power, read every minute; switched off on a command | The workspace's Shelly Cloud key and server address |
| Both | Home Assistant, read directly (section 3) | Lights, switches, fans, power sensors and motion sensors, read every minute; switched off on a command | The workspace's Home Assistant token and https address |
| Out | Command webhook | Switch-off commands for your control system | HMAC signature with the workspace's webhook secret, or `COMMAND_WEBHOOK_SECRET` |
| Out | Telegram bot | Alerts with a one-tap switch-off button, to the chat linked to the workspace | The workspace's own bot (Connect), or the deployment's |
| Out | Weekly digest (`/api/digest`, Vercel Cron, Mondays) | A summary of each workspace's week to its Telegram chat | `CRON_SECRET` |
| Both | `GET` / `PUT /api/site`, `/api/cameras` | The site file and the camera settings, shared by every device of a workspace | Workspace session (`Authorization: Bearer`) |
| In | `POST /api/report` | A visitor on the public view says lights are left on; raises a check, changes nothing | The public view link's key, 5 per minute per address |

Everything belongs to a **workspace**: a name and a password, created on the first page. Each workspace has its own site, cameras, live channel, events, sensor key and Telegram chat, so many customers share one deployment without seeing each other's data. The server derives the private channel name, the public view key and the sensor key from `WORKSPACE_SECRET`; Setup shows the sensor key and the edge worker's channel.

Everything is keyed by **room id**, the ids you create in Setup (for example `CR-101`). Export the site from Setup to give integrators the full room and device list as JSON.

## 1. The site file

With server storage (Supabase keys, `WORKSPACE_SECRET` and the tables from `supabase/schema.sql`), saving in Setup also stores the site on the server, and every device of the workspace, phone cameras included, loads it on start; open screens fetch it again the moment it is saved. A local edit that could not be uploaded is pushed first, never overwritten. Camera settings (room boundary, zones, calibration) are stored separately, one camera at a time, so a phone calibrating a camera never overwrites setup edits.

Setup's **Export** button downloads `<building>.pratibimb.json`. It is the contract between Pratibimb and other systems: rooms, floors, devices with ratings and camera zones, currency, tariff and grid factor. **Import** accepts the same format, so a facility team can generate it from their asset register or BIM export. The schema is `SiteSchema` in [`src/shared/site.ts`](../src/shared/site.ts); devices carry Brick Schema classes (`Luminaire`, `Fan`, `Air_Handling_Unit`, `Projector`, `Computer`).

## 2. Sensor API: `POST /api/ingest`

```bash
curl -X POST https://<your-app>/api/ingest \
  -H "x-api-key: $SENSOR_KEY" -H "content-type: application/json" \
  -d '{"readings":[{"roomId":"CR-101","source":"shelly","occupancy":0,"devices":[{"type":"light","on":true}],"powerW":240}]}'
```

Each reading may carry any of:

| Field | Meaning |
| --- | --- |
| `roomId` | Required. A room id from your site |
| `source` | Required. Free text shown in the twin, for example `home-assistant`, `bms`, `shelly` |
| `ts` | Optional epoch milliseconds; the server time is used when missing |
| `occupancy` | People counted, or `1` / `0` from a motion sensor. Counts as live for 15 minutes |
| `devices` | `[{ "id": "CR-101/light-03", "on": true }]` for one device, or `[{ "type": "light", "on": true }]` for every light in the room |
| `powerW` | Metered power for the whole room. When present it replaces the sum of device ratings |
| `co2ppm`, `temperatureC`, `humidity` | From a room air sensor. Measured CO2 replaces the head-count estimate and drives the indoor-air advice |

`$SENSOR_KEY` is the workspace's sensor key from Setup, Integrations. It names its workspace, so readings reach only that workspace. Up to 100 readings per request. Readings go to the open twins at once and are stored as the room's latest sensor state, so the server's minute tick uses them with no browser open. The response says how many reached the live twin (`delivered`) and whether they were stored (`stored`).

## 3. Home Assistant

Send room state to Pratibimb with a REST command and an automation:

```yaml
# configuration.yaml
rest_command:
  pratibimb_ingest:
    url: https://<your-app>/api/ingest
    method: POST
    headers:
      x-api-key: !secret pratibimb_ingest_key
    content_type: "application/json"
    payload: >
      {"readings":[{"roomId":"{{ room }}","source":"home-assistant",
        "occupancy": {{ occupancy }},
        "devices":[{"type":"light","on": {{ lights_on | lower }} }],
        "powerW": {{ power }} }]}

automation:
  - alias: "Pratibimb: report CR-101"
    triggers:
      - trigger: state
        entity_id: [binary_sensor.cr101_motion, light.cr101, sensor.cr101_power]
      - trigger: time_pattern
        minutes: "/5"
    actions:
      - action: rest_command.pratibimb_ingest
        data:
          room: "CR-101"
          occupancy: "{{ 1 if is_state('binary_sensor.cr101_motion', 'on') else 0 }}"
          lights_on: "{{ is_state('light.cr101', 'on') }}"
          power: "{{ states('sensor.cr101_power') | float(0) }}"
```

Receive switch-off commands from Pratibimb with a webhook trigger. Set `COMMAND_WEBHOOK_URL` to `https://<home-assistant>/api/webhook/<your-secret-webhook-id>`:

```yaml
automation:
  - alias: "Pratibimb: switch off on command"
    triggers:
      - trigger: webhook
        webhook_id: "pratibimb-<long-random-id>"
        allowed_methods: [POST]
        local_only: false
    actions:
      - action: light.turn_off
        target:
          area_id: "{{ trigger.json.roomId | lower }}"
```

The webhook id works like a password; keep it long and random. A workspace can set its own webhook (address and secret) in Settings, Keys and AI; it replaces the deployment's `COMMAND_WEBHOOK_URL` for that workspace. Commands look like:

```json
{ "id": "uuid", "ts": 1700000000000, "roomId": "CR-101", "target": "lights", "state": "off", "origin": "telegram", "workspace": "city-college" }
```

`workspace` names the workspace that sent it, so one receiver can serve several workspaces of a shared deployment. A deployment that serves one customer can ignore it.

### Or let Pratibimb read Home Assistant directly

No automations needed. In Home Assistant, open your profile, Security, Long-lived access tokens, and create one. In Pratibimb, Settings, Keys and AI, add it under Home Assistant with your Home Assistant's public `https://` address (Home Assistant Cloud, or your own domain; a `homeassistant.local` or `192.168.x.x` address cannot be reached from the server). Then list which entities belong to which room in Devices and integrations (`PUT /api/connections`):

```json
{ "homeAssistant": [
  { "roomId": "CR-101", "entityId": "light.cr101_lights", "target": "lights" },
  { "roomId": "CR-101", "entityId": "switch.cr101_fans", "target": "fans" },
  { "roomId": "CR-101", "entityId": "sensor.cr101_power" },
  { "roomId": "CR-101", "entityId": "binary_sensor.cr101_motion" }
] }
```

Every minute the server reads `/api/states` once: `light`, `switch`, `fan` and `input_boolean` entities give device states for their `target` (lights, fans or all), `sensor` entities give power in W or kW, and `binary_sensor` entities give occupancy (on is 1 person, off is 0). A switch-off command calls `light.turn_off`, `switch.turn_off`, `fan.turn_off` or `input_boolean.turn_off` for the room's matching entities.

**Devices on the local network only** (Tasmota, Shelly in local mode, Zigbee, anything without a cloud): add them to Home Assistant, which reaches them, and connect Home Assistant as above.

## 4. Other control systems: verifying the command webhook

Every forwarded command carries `x-pratibimb-signature: sha256=<hex>`, an HMAC-SHA256 of the raw body with `COMMAND_WEBHOOK_SECRET`. Check it before acting:

```js
import { createHmac, timingSafeEqual } from 'node:crypto'
const expected = 'sha256=' + createHmac('sha256', process.env.COMMAND_WEBHOOK_SECRET).update(rawBody).digest('hex')
const ok = timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers['x-pratibimb-signature'] ?? ''))
```

Node-RED, BACnet or Modbus gateways, and PLC bridges can all receive this webhook and drive relays or contactors. Pratibimb then waits for a camera, sensor or staff report to confirm the devices really went off before it counts the saving.

## 5. Campus CCTV

Run MediaMTX on a machine inside the campus network ([edge/mediamtx.yml](../edge/mediamtx.yml)), then either:

- open Cameras on that machine and paste the WHEP address (`http://<machine>:8889/<path>/whep`) for each stream; one page runs several cameras, or
- run the Python edge worker for many streams on one box:

```bash
python -m venv edge/.venv
```

```bash
edge/.venv/Scripts/python -m pip install opencv-python-headless mediapipe
```

```bash
edge/.venv/Scripts/python edge/edge.py --room LH-3 --camera 2 --source rtsp://user:pass@10.0.0.5:554/stream1 --zones zones-LH-3.json
```

Calibrate the camera once in the browser (Cameras, add it with its WHEP address), then use **Copy zones** for `zones-LH-3.json` and the same camera number for `--camera`. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `PRATIBIMB_CHANNEL` (Setup, Integrations, "Live channel for the CCTV edge worker") so readings reach the workspace's twin; without them the worker prints readings as JSON lines. `python edge/edge.py --selftest` checks the install.

## 6. Telegram

**A workspace's own bot.** Create a bot with @BotFather, paste its token in Settings, Keys and AI, Telegram, and press **Connect** (`POST /api/telegram/connect`). The server sets the bot's webhook to `/api/telegram?ws=<workspace>` with a secret derived for that workspace. Send any message to the bot from your staff group within 15 minutes: that chat is linked and the bot confirms. No `/chatid` is needed. To link another chat, press Connect again with "link another chat" (`{ "relink": true }`). Alerts, the Switch off button and the weekly digest use this bot; a tap counts only from the linked chat.

**The deployment's bot**, for workspaces without their own. Create it with @BotFather, set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`, and register the webhook once:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-app>/api/telegram&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

Each workspace then adds the bot to its staff group, sends `/chatid`, and pastes the number the bot replies with into Setup, Integrations, Telegram chat id, and saves. Alerts and the weekly digest go to that chat. A "Switch off" tap is accepted only from the chat linked to that workspace.

## 7. Smart plugs and relays: Shelly Cloud

In the Shelly app, open User settings, Authorization cloud key: copy the key and the server address (like `https://shelly-123-eu.shelly.cloud`). Add both in Settings, Keys and AI, Shelly Cloud. Each device's id is in the app under the device, Settings, Device information. List which plug belongs to which room (`PUT /api/connections`):

```json
{ "shelly": [ { "roomId": "LAB-1", "id": "a8032ab12345", "channel": 0, "target": "all", "power": true } ] }
```

Every minute the server reads the devices (Shelly's Cloud Control API v2, 10 devices per call, one call per second): the switch state sets the room's devices of the `target` type on or off, and with `"power": true` the plug's watts become the room's metered power. A switch-off command turns the matching channels off. Use `"power": false` when the plug feeds only part of the room, so the room's other devices still count.

## 8. The server API for apps and dashboards

Every route needs the workspace session (`Authorization: Bearer <token>`) unless said otherwise. Roles: owner, manager, viewer (docs/DEPLOY.md, section 7a).

| Route | Role | Does |
| --- | --- | --- |
| `POST /api/reading` | manager | `{ readings: CvReading[], sensors?: SensorReading[] }`; a camera's latest reading every 10 s, and staff reports; stored for the minute tick |
| `GET /api/state` | viewer | The server's last computed twin, the latest camera readings and each room's sensor state |
| `GET /api/history?room=&from=&to=` | viewer | Hourly roll-ups per room: kWh, cost, waste, occupied and observed minutes; at most 93 days |
| `POST /api/tick` | `CRON_SECRET` | The minute tick (docs/DEPLOY.md, section 4a) |
| `GET /api/doctor` | manager | Every connection tested now: `[{ name, ok, detail, fix }]` |
| `GET`, `PUT /api/connections` | viewer, manager | Which Shelly devices and Home Assistant entities belong to which room |
| `GET`, `PUT`, `DELETE /api/keys`; `POST /api/keys/test`; `PUT /api/keys/ai` | owner | Bring your own keys; values never come back, only the last four characters |
| `GET /api/keys/client` | viewer | Only the Google Maps key, which the browser uses by design; restrict it to your domain in Google Cloud |
| `GET`, `POST /api/telegram/connect` | viewer, owner | The linked bot and chat; Connect |
| `GET`, `DELETE /api/sessions` | owner | Signed-in sessions; sign one out (anyone may sign out their own) |
| `POST /api/workspace/invite` | owner | `{ role, days? }`: a key for an invite link that signs in with that role |
| `PUT /api/workspace/password` | owner | `{ current, next }`; every other session is signed out |
| `GET /api/workspace/export`, `DELETE /api/workspace` | owner | Download everything the workspace stored; delete it (with the password) |
