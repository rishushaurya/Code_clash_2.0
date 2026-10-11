# Pratibimb

**A live digital twin for any building. Cameras you already own find empty rooms wasting power, the twin shows the cost and CO2, and AI tells the facility manager exactly what to fix.**

**Team Barfi** · Code Clash 2.0 · Problem Statement 04: Green Building Digital Twin

---

## The problem

Buildings use about a third of India's electricity, and much of a campus's or office's share lights and cools rooms nobody is in. Nobody sees this waste while it happens, so nobody fixes it. Energy audits, including NAAC metric 7.1.6 for Indian colleges, are still a once-a-year snapshot.

A US EPA study of 158 rooms in 60 buildings found that occupancy-based switching with a 5-minute delay cut classroom energy waste by 63 % (58 % energy savings). The control idea is proven. What buildings lack is a way to see and act on the waste without rewiring every room.

## What Pratibimb does

Pratibimb (Sanskrit for *reflection*) runs one loop every two seconds:

```mermaid
flowchart LR
    A["Sense<br/>Cameras count people and<br/>see lights, fans, screens;<br/>sensors and staff report"] --> B["Mirror<br/>Each room's live state<br/>on your floor plan"]
    B --> C["Simulate<br/>Watts, money, CO2,<br/>indoor air, what-if policies"]
    C --> D["Advise<br/>AI writes a grounded<br/>recommendation"]
    D --> E["Act<br/>One click or a Telegram tap<br/>switches devices off"]
    E -->|camera, sensor or staff confirm| A
```

| Problem statement asks for | Pratibimb |
| --- | --- |
| Digital twin of a building | Any building: describe it once in Setup (or import a JSON file), see it live, run it forward in the Scenario Lab, send commands back |
| CV for occupancy | In-browser person detection on any camera: laptop, phone, USB, CCTV; faces blurred, no image stored or sent |
| CV for lighting | Light zones read by brightness against on/off references |
| CV for resource usage | Fan zones read by motion, projector screens by brightness, plus sensors and meters through an API |
| GenAI recommendations for energy efficiency | Alert cards with a one-click fix and a saving from the simulation engine; observed waste patterns ("LH-1, Fridays at 16:00") explained by the AI |
| ... for indoor sustainability | Indoor CO2 measured by room sensors when present, otherwise estimated from live head-counts, with ventilation advice checked against outdoor air quality; AC advice when the outdoor air is already below the 24 °C BEE default, and when a room is overcooled (about 6 % saved per degree) |
| ... for resource utilization | Observed room-by-hour utilization, underused large rooms, and a "move small classes" policy |

### Real data only

A fresh install has no rooms and no numbers. Every live figure comes from an observed input: a camera, a connected sensor or meter, or a staff member reporting what they see. A room nobody watches shows **No data**, and a device nobody observes draws nothing in the totals. A switch-off counts as saved money only after a camera, sensor or person confirms the devices went off. The only modelled numbers are the Scenario Lab's what-ifs, built from your own rooms and assumptions and labelled **Modelled**.

### Grounded AI

Code computes every number. The AI only writes words. It receives a *facts pack* from the twin, and the server rejects any money, kWh, kg, ppm, watt or percent figure that is not in that pack, asks once more, and otherwise falls back to a template written by code. Without any AI key, every AI feature still works from templates.

### Privacy by design

Video never leaves the device. Detection runs in the browser (or on an edge box inside the campus network), faces are blurred before anything is drawn, and only a small JSON message is sent: room id, head-count, zone states, confidence. The camera page shows that exact message next to "Images stored: 0" and "Images sent: 0".

## Built for any site

- **Setup in minutes:** search your city (Open-Meteo geocoding), pick a currency, enter the tariff from your bill, add rooms from templates, then match counts to reality. Indian locations prefill INR, the BESCOM educational rate and the CEA grid factor.
- **One building or a whole campus:** floors can carry a building name, and the twin, league and 3D view group by it.
- **Any currency, any tariff, any grid factor.** Alerts in English, Hindi or Kannada.
- **Integrates with what you have:** a sensor API for building systems, smart plugs and Home Assistant; a signed command webhook for your control system; Telegram for staff; CCTV through MediaMTX or the Python edge worker. See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).
- **Your data in a portable file:** export and import the site as JSON, with Brick Schema device classes. With server storage, every device shares it automatically.
- **Everyone can help:** the public view behind each room's QR code has a "Lights left on here?" button that asks staff to check, without changing any reading.
- **Your hours, your week:** opening hours and days in Setup shape every what-if.
- **Automatic switch-off when you are ready:** turn it on in Setup after trying it in the Scenario Lab; the twin then switches off rooms left empty with power on, through your relay or control system, once per room until people return. Labs and server rooms can be kept out.
- **Knows when a camera drops out:** a "Camera offline" alert, with a fix-it card, when a room's camera goes quiet; each room lists its cameras with live status and confidence.
- **Phones make good cameras:** the camera page keeps the screen awake while it watches, and Pratibimb installs to the home screen.
- **Uptime-ready:** `/api/health` reports server and storage health for monitoring.
- **A weekly digest** goes to Telegram every Monday from the stored events: rooms found wasting, commands sent, switch-offs confirmed.
- **Learns your building:** after a few hours of observation, Setup suggests your real opening hours and how often empty rooms stay on.
- **Activity log for auditors:** every alert, command and confirmation, filterable and downloadable as CSV.
- **Audit trail:** with server storage, every alert, command and confirmation is kept, and the report includes the last 30 days of actions.
- **Rooftop solar what-if** from the sunshine measured at your location over the last three months.
- **Workspaces:** each team signs in with a workspace name and password; its building, cameras, live data, alerts and reports stay its own, so many customers share one deployment.
- **Set up with AI:** describe the building in plain words and the AI fills the setup form; numbers you did not write are left out, and nothing is saved until you review it.
- **Many cameras, any device:** one laptop runs several cameras, one room can have several, and a QR code turns a phone into a camera in seconds. Each camera's zones are saved to the workspace, and cameras keep running while you use the rest of the app.
- **Grid factors with sources:** India (CEA), UK (DESNZ), US (EPA eGRID) and Singapore (EMA) prefill on location search.

## Try it

```bash
npm install
```

```bash
npm run dev
```

Open `http://localhost:5173`, create a workspace (kept in this browser when no server storage is set), go to **Setup**, add your rooms and save. Then open **Cameras**, add a camera for a room, and walk in and out of view. No API key is needed for any of this. To put it online for free, with phones, AI and Telegram, follow [docs/DEPLOY.md](docs/DEPLOY.md).

| Screen | Path | What it does |
| --- | --- | --- |
| Live twin | `/` | Floor plan, 3D view, time travel, alerts with one-click fixes, energy flow, Copilot |
| Room | `/room/<id>` | Devices on, off and not observed; staff reports; CO2; camera QR code; AI Surveyor |
| Cameras | `/camera` | Several cameras per device and per room; zones per camera; every camera's live status; QR codes for phones; privacy inspector |
| Scenario Lab | `/lab` | What-if policies over 20 modelled weeks; payback; energy intensity; observed utilization |
| Reports | `/reports` | One-click audit report; Download PDF |
| Setup | `/setup` | Set up with AI; site, money, floors, rooms, devices, integrations, import and export |
| Public view | `/live` | What anyone sees after scanning the public QR code; no sign-in |

```bash
npm test
```

To connect phones and sensors over the internet, use AI, Telegram and commands, follow [docs/DEPLOY.md](docs/DEPLOY.md): every service it uses has a free plan.

## Architecture

```mermaid
flowchart TB
    subgraph Inputs["Inputs"]
        CAM["Camera page on any device<br/>MediaPipe person + face detection<br/>light, fan and screen zones"]
        EDGE["Edge worker on campus LAN<br/>CCTV over RTSP"]
        SENS["Sensors, meters, BMS,<br/>Home Assistant"]
        STAFF["Staff reports"]
    end
    subgraph Twin["Operator browser: the twin"]
        STORE["Twin store, ticks every 2 s"]
        SIM["What-if engine"]
        RULES["Rules -> alerts -> facts pack"]
        SERIAL["Web Serial -> USB relay"]
    end
    subgraph Cloud["Server"]
        RT["Supabase Realtime + event log"]
        API["Vercel functions<br/>AI, ingest, commands, Telegram"]
        LLM["Groq, fallback Gemini"]
    end
    OUT["Your control system<br/>signed command webhook"]
    PUB["Phones: public view"]

    CAM -- "numbers only" --> RT
    EDGE -- "numbers only" --> RT
    SENS -- "/api/ingest" --> API --> RT
    RT --> STORE
    STAFF --> STORE
    STORE --> SIM
    STORE --> RULES -- facts pack --> API --> LLM
    STORE -- command --> API --> OUT
    STORE --> SERIAL
    STORE -- snapshot --> RT --> PUB
```

Without Supabase keys, the browser's `BroadcastChannel` links the camera, twin and public tabs on one machine, so the whole loop runs offline.

| Layer | Technology |
| --- | --- |
| Frontend | React 19, Vite 8, TypeScript (strict), Tailwind 4, shadcn/ui, lucide-react |
| Computer vision | MediaPipe Tasks Vision (Apache-2.0), models served locally, CPU delegate |
| Twin and simulation | Zustand, plain TypeScript, seeded Monte Carlo |
| Realtime and storage | Supabase broadcast and Postgres; `BroadcastChannel` locally |
| AI | Groq and Gemini through their OpenAI-compatible APIs, Zod-validated, grounding check |
| Integrations | Ingest API, HMAC-signed command webhook, Telegram Bot API, MediaMTX, Python edge worker |
| Hosting | Vercel, with CSP and security headers |

## Quality

- 79 automated tests (`npm test`) cover:
  - energy maths, the CO2 model, camera merging, light and fan zones;
  - the full twin loop with real inputs only, and visitor reports that never touch device states;
  - sensor ingest, staff confirmation and unknown rooms;
  - the what-if engine and the automatic floor layout;
  - grounding and the AI retry and fallback;
  - every API route through the router, including workspaces (hashing, signed sessions, forged and expired tokens), per-workspace isolation of sites, cameras, events, sensors, Telegram and visitor tips, and the signed webhook;
  - Set up with AI: invented numbers dropped, injected text unable to change the answer's shape;
  - site sync that never overwrites an edit that failed to upload.

  The Python edge worker has its own self-test.
- Person detection was checked on sample photos in the browser and in Python (person scores 0.98 and 0.95 in both).
- An axe-core accessibility audit finds no violations on any page, and every text colour meets WCAG AA contrast.
- Strict TypeScript across app and server. Every data panel has loading, empty, error and success states. Error boundaries keep one broken panel from blanking a page.
- Security:
  - workspaces with scrypt password hashes and signed sessions; every private route acts only on the caller's workspace;
  - a private live channel per workspace, named with a server-derived secret, and a separate snapshot-only public channel;
  - a sensor key per workspace on ingest;
  - Telegram's secret header on the webhook, and switch-off taps accepted only from the workspace's own chat;
  - HMAC on outgoing commands;
  - Zod validation and size limits on every request;
  - incoming realtime messages validated before use;
  - rate limits, CSP and security headers;
  - no secrets in the repository.

## Repository map

| Path | What it holds | Owner |
| --- | --- | --- |
| `src/cv/`, `edge/` | Camera station (several cameras per device), per-camera settings, detector, device zones, camera sources; Python edge worker and MediaMTX config | Aditya |
| `src/relay/`, `firmware/`, `api/_routes/` (cameras, command, alert, telegram, ingest, report) | Relay, camera settings, commands, Telegram, sensor ingest, visitor tips | Aditya |
| `src/twin/` | Live twin store, energy and CO2 maths, rules, camera merge, realtime, recorded utilization | Priyanshu |
| `src/sim/` | What-if engine and Monte Carlo | Priyanshu |
| `src/ai/`, `api/[...route].ts`, `api/_routes/ai/`, `api/_lib/` | AI client, offline templates, Copilot tools, AI endpoints (Set up with AI included), grounding check, the API router, workspace auth | Priyanshu |
| `src/shared/` | Shared types, engineering constants, the site model, the signed-in workspace | Priyanshu |
| `src/ui/` | Workspace sign-in, Live Twin, Room, Scenario Lab, Reports, Setup, Public view | Neev |
| `docs/` | Research, build spec, design system, integrations, deployment, user guide, site survey | All |

## Documents

| Document | Read it for |
| --- | --- |
| [docs/RESEARCH_MASTER_PLAN.md](docs/RESEARCH_MASTER_PLAN.md) | The research: problem, prior work, design choices, sources, pitch, judge Q&A |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Putting it online for free: GitHub, Supabase, Vercel, AI keys, Telegram, and a check for every feature |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | Step by step: run it, set up a building, connect cameras, use every screen, add keys |
| [docs/BUILD_SPEC.md](docs/BUILD_SPEC.md) | Contracts, ownership, data rules, module checks, security, camera options |
| [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | Site file, sensor API, Home Assistant, command webhook, CCTV |
| [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) | Warm light theme, tokens, status language, screens, accessibility |
| [docs/SITE_SURVEY.md](docs/SITE_SURVEY.md) | The worksheet for onboarding a new building |
| [CHANGELOG.md](CHANGELOG.md) | What was done, session by session |
| [CLAUDE.md](CLAUDE.md) | Instructions for the AI coding assistants we used |

## Team Barfi

| Member | Module |
| --- | --- |
| Priyanshu Shaurya | Digital twin, simulation engine, generative AI, integration (Mirror, Simulate, Advise) |
| Aditya Raj | Computer vision, cameras, relay hardware, sensors, Telegram (Sense, Act) |
| Neev Pujari | User interface, setup, public view, design, pitch (Show) |

## How we used AI tools

We built Pratibimb with AI coding assistants, driven by the contracts in [docs/BUILD_SPEC.md](docs/BUILD_SPEC.md). Every module was run and checked by its owner, who can explain every file. Libraries and pretrained models are used as libraries; no other project's application code was copied.

## Research we build on

- US EPA occupancy sensor study, 158 rooms in 60 buildings ([EC&M summary](https://www.ecmweb.com/contractor/epa-study-shows-occupancy-sensors-reduce-energy-waste-demand))
- Tien et al., camera-based occupancy and equipment detection ([Energies](https://doaj.org/article/3ef96fc779284e3c8572d37cf2e4f008))
- Camera-based occupant activity detection in a university building ([Applied Energy, Cardiff ORCA](https://orca.cardiff.ac.uk/178040))
- Building vocabulary from [Brick Schema](https://brickschema.org/)
- Geocoding, weather and air quality from [Open-Meteo](https://open-meteo.com) (CC BY 4.0)

## License

MIT, see [LICENSE](LICENSE). MediaPipe models are Apache-2.0.
