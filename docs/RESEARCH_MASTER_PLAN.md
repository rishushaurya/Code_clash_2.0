# Pratibimb — Code Clash 2.0 Research & Master Plan

## Executive summary

We build **Pratibimb** for Problem Statement 04 (Green Building Digital Twin). It is a live digital twin of SOE A Block, the building where Code Clash 2.0 is judged. Ordinary cameras show which rooms are occupied, the twin calculates the power being wasted in empty rooms, and generative AI turns those numbers into concrete fixes and an energy-audit report.

**One-line pitch:** Pratibimb sees which rooms are empty, shows what that waste costs in rupees and CO2, and tells the facility manager exactly what to do about it.

**The wow moment in the demo:** judges scan a QR code and watch Lecture Hall 1 live on their own phones. When our team walks out of the camera's view, the room turns red, a Telegram alert reaches the presenter, and one tap physically switches off a lamp on our table, which the camera then confirms. The twin answers a spoken what-if question by running its simulation, and one click produces a NAAC-ready report.

| Judging criterion | Weight | How Pratibimb scores |
| --- | --- | --- |
| Technical Implementation | 30% | Real-time CV running live, a working simulation engine, deployed app |
| Innovation & Creativity | 25% | Closed loop from camera to twin to AI to a real lamp switching off, verified by the camera |
| Practicality & Impact | 20% | A real buyer (DSU estate office) and a real need (energy audits for accreditation) |
| Presentation & Demo | 15% | Judges see their own building react live |
| Teamwork | 10% | Three clear module groups, one per member, visible in Git history |

**Backup track:** PS03 (Energy Monitoring) reuses about 80% of the same design if we change our minds before registering.

**How we build it:** with AI coding assistants driven by the AI build spec tab. It fixes the module contracts, acceptance checks and one prompt per module before the event; the AI writes the code at the event, and every member runs, verifies and can explain their part.

## Understanding PS04 in depth

PS04 asks for three things that must work together: a digital twin of a building, computer vision that monitors occupancy, lighting and resource usage, and generative AI that turns that data into recommendations for energy efficiency, indoor sustainability and resource utilization. Every Code Clash track requires all three pillars, so a weak pillar costs marks directly.

**What "digital twin" really means.** The research literature separates three levels, and judges who know the field may test us on this:

1. **Digital model:** a 3D or 2D replica with no live data. Many teams will stop here.
2. **Digital shadow:** the replica updates automatically from the real building, one way.
3. **Digital twin:** live sync plus simulation and prediction, with the ability to send decisions back to the physical side.

Pratibimb reaches level 3. Cameras update room state live, the simulation engine projects energy, cost, CO2 and indoor air quality forward, and control commands ("switch off lights in LH-2") go to a real relay that switches a lamp in the demo room, and to simulated relays for every other room. We say plainly which is which.

| What PS04 asks for | What we build | Real or simulated in the demo |
| --- | --- | --- |
| Monitor occupancy with CV | Live person detection and counting per room | Real, live webcam |
| Monitor lighting with CV | Lights on/off from brightness of marked ceiling regions | Real, live webcam |
| Monitor resource usage | Per-room device states and power draw (fans, ACs, projectors), water as a stretch | Simulated IoT feed, labelled as such |
| Digital twin of a building | Floor plan of SOE A Block with live room states | Real layout, live state |
| Analyze data with GenAI | AI reads the twin's numbers, not generic text | Real API calls, cached fallback |
| Recommendations: energy efficiency | Waste alerts, auto-off policies, scheduling changes | Real |
| Recommendations: indoor sustainability | Indoor CO2 estimated from head-count and ventilation, daylight use | Simulated model, driven by real counts |
| Recommendations: resource utilization | Room-usage heatmap, underused rooms, class consolidation | Real counts over the demo session |

**Two things most teams will miss.** First, "indoor sustainability" is explicitly in the statement; estimating classroom CO2 from the live head-count covers it cheaply and convincingly. Second, "resource utilization" includes space itself: a room that seats 120 but averages 18 people is a recommendation in its own right.

## The real-world problem

Buildings use about a third of India's electricity, and a large share of campus electricity is spent lighting and cooling rooms nobody is in. Nobody sees this waste as it happens, so nobody fixes it.

**Scale.** Buildings account for about 33% of India's electricity consumption, and that share is growing as construction booms ([Indo-Swiss BEEP](https://www.eda.admin.ch/content/dam/countries/countries-content/india/en/ressources/resource_en_222537.pdf)).

**Proof that occupancy-based control works.** A US EPA study monitored 158 rooms across 60 buildings and found that occupancy-based switching with a 5-minute delay cut classroom energy waste by 63% ([EC&M summary of the EPA study](https://www.ecmweb.com/contractor/epa-study-shows-occupancy-sensors-reduce-energy-waste-demand)). The University of Illinois found that occupancy control of HVAC saved even more per square foot than lighting control ([UIUC sustainability report](https://icap.sustainability.illinois.edu/files/ssc-project/10043/2009%20Sustainability%20Committee%20Final%20Report%20with%20Attachments.pdf)). These two numbers are the backbone of our impact claim.

**Why cameras instead of motion sensors.** Classic PIR sensors switch lights off when students sit still and cannot count people. Cameras already exist in most Indian college corridors and labs, they count heads, and they also see whether lights are on. One camera replaces several sensors, and the head-count unlocks recommendations a motion sensor never could, such as moving a 20-student class out of a 120-seat hall.

**Why Indian universities specifically need this.** NAAC accreditation metric 7.1.6 asks institutions to show that quality audits on environment and energy are regularly undertaken, including a green audit and an energy audit ([NAAC 7.1.6 submission example](https://dbjaincollege.org/wp-content/uploads/7.1.6_Index.pdf)). These audits must come from independent agencies ([GloCert guide](https://www.glocertinternational.com/resources/guides/naac-green-energy-environment-audits-criterion-7/)), so Pratibimb does not replace the auditor. It produces continuous, room-level evidence and an action-taken record that make the audit faster and the institution's score stronger.

**Who uses Pratibimb.**

| User | What they need | What Pratibimb gives them |
| --- | --- | --- |
| Estate / facility manager (primary) | Know where power is wasted right now, and cut the bill | Live twin, waste alerts, auto-off policy simulation |
| IQAC / NAAC coordinator | Evidence for energy and green audits | AI-drafted monthly sustainability report |
| Timetable office | Fit classes to the right-sized rooms | Room utilization heatmap and consolidation suggestions |
| Students | See the campus's footprint | Public read-only view of the twin |

## What already exists, and the gap we fill

Commercial occupancy products and research prototypes already prove the idea works, but they need new hardware, enterprise budgets, or a research lab. None of them gives an Indian campus a zero-hardware twin with AI-written actions and audit reports. That gap is our pitch.

| Existing solution | What it does | What it lacks, which Pratibimb adds |
| --- | --- | --- |
| [Butlr](https://news.mit.edu/2025/butlr-creates-smart-buildings-with-privacy-first-sensors-0211) (MIT Media Lab spin-off) | Low-resolution thermal sensors count room occupancy without cameras; 20,000+ sensors sold to firms like Verizon and Microsoft | New hardware in every room; no generative recommendations or audit output |
| Enterprise building platforms (Siemens, Johnson Controls, Honeywell) | Full building management systems with dashboards | Expensive, installed during construction, out of reach for most Indian colleges |
| [Tien et al., University of Nottingham](https://doaj.org/article/3ef96fc779284e3c8572d37cf2e4f008) | Camera-based deep learning detects occupancy and equipment use in an office; simulation showed far lower wasted equipment and occupancy heat gains | Research prototype; no twin interface, no AI recommendations |
| [Applied Energy study, university building](https://orca.cardiff.ac.uk/178040) | Camera detects occupant activity (85.6% accuracy) and window opening (92.2%) to inform HVAC | Same: proves the CV works, stops before a usable product |
| [mac999/digital\_twin](https://github.com/mac999/digital_twin) (GitHub) | Building twin using BIM, IoT sensors, deep-learning anomaly detection and OpenPose occupancy | Needs Autodesk Forge and Arduino hardware; no GenAI; good to study for structure |
| [21aansh06/EnergyDigital](https://github.com/21aansh06/EnergyDigital) (GitHub) | Next.js energy dashboard with Gemini insights and a Three.js 3D building | No computer vision and no policy simulation; this is roughly what a typical rival team will build |

**Our positioning in one sentence:** Butlr-style occupancy intelligence, without new hardware, using cameras the campus already owns, with a simulation engine and an AI analyst on top.

**The privacy objection, and our answer.** Butlr's whole pitch is that cameras invade privacy, and a judge may raise it. Our answer: video never leaves the device. Detection runs in the browser or on an edge box, faces are blurred before anything is shown, and only numbers (head-count, light state) are sent to the twin. We store zero images.

## Our solution end to end

Pratibimb runs one loop every two seconds: sense, mirror, simulate, advise, act. Each judging pillar maps to one stage, and the stages feed each other, which is what separates a real twin from three disconnected demos.

1. **Sense (Computer Vision).** A camera per monitored room runs person detection and light-state detection on the device. Every two seconds it sends one small message: room ID, head-count, which light zones are on, and a confidence score. Rooms without a camera get a simulated feed that follows a realistic class timetable.
2. **Mirror (Digital Twin state).** The twin's state store updates that room, and the A Block floor plan recolors it. Green means occupied and powered, grey means empty and off, and red means empty but still drawing power.
3. **Simulate (Digital Twin engine).** The engine converts each room's state into watts, rupees per hour, kWh today and kg CO2, and projects indoor CO2 from the head-count. It also runs what-if scenarios, such as "auto-off after 5 empty minutes" or "move Section B to a smaller room", over a simulated week.
4. **Advise (Generative AI).** A rules layer turns state into events: empty room with load on for more than N minutes, a room over capacity, CO2 above 1,000 ppm. The AI receives those events plus the twin's real numbers and writes a specific recommendation with expected savings. On request it writes the full sustainability report.
5. **Act (closing the loop).** The manager clicks "Apply". A real relay switches off the demo room's lamp (other rooms use simulated relays), the camera confirms it, the twin updates, the savings counter ticks up, and the action is logged. That log becomes the action-taken record auditors ask for.

**Screens we build, in priority order.**

| Screen | What the user sees | Priority |
| --- | --- | --- |
| Live Twin | A Block floor plan, rooms colored by state, building totals (kW, ₹/hr, kg CO2 today), alert feed | Must |
| Room Detail | Live camera with faces blurred, head-count, light zones, device list with watts, cost of this room today | Must |
| Scenario Lab | Pick a policy, run a simulated week, compare baseline vs policy in kWh, ₹ and CO2 | Must (this is the wow) |
| Reports | One-click AI sustainability report, downloadable as PDF | Must |
| AI Copilot chat | Ask "which room wasted the most today?" and get answers grounded in twin data | Should |
| Utilization Heatmap | Rooms × hours, showing underused spaces | Should |

**The exact demo path, under three minutes:** judges scan the QR code → team walks out of camera view → room turns red with ₹/hr wasted → Telegram alert, tap "Switch off" → the real lamp goes dark and the camera confirms → a spoken what-if runs the Scenario Lab simulation → Generate Report → PDF opens. The full choreography is in the Wow features section below.

## Wow features: what makes judges remember Pratibimb

The core idea is no longer rare. A Habib University final-year team built a camera-based occupancy twin of their campus labs ([HU Digital Twin](https://habib.edu.pk/graduate-directory/graduate/muhammad-shawaiz-khan/)), and a 2023 conference paper describes a campus twin fed by a camera ([Creative Construction Conference 2023](https://repozitorium.omikk.bme.hu/items/7d636d59-772a-4636-b41b-de2e90a7f023/full)). The idea alone will not win. What wins is a loop that reaches into the physical world, judges holding the twin in their own hands, and an AI that operates the simulation. Nothing guarantees first prize, but these are the things rival teams are least likely to have.

&#91;embedded content: Wow features · judge impact vs build effort\]

Features 1–5 join the core plan, 6 and 7 are added only if the Day 1 gate passes on time, and the 3D scan comes last. Solar rooftop what-ifs, occupancy forecasting and an AR phone overlay are future scope for the pitch, not hackathon work.

**The ten features, in recommended build order.**

| Feature | What the judges experience | How we build it | Real-world value |
| --- | --- | --- | --- |
| **1. Judges hold the twin** | They scan a QR code on our first slide and watch Lecture Hall 1 live on their own phones | A public, read-only route of the same app plus a QR code; the UI is already responsive | A QR code on every classroom door shows the room's status, with a "report lights left on" button for students |
| **2. A real lamp, switched by the twin, verified by the camera** | A lamp on our table switches itself off when the room empties, and the camera confirms it | Arduino or ESP32 with a relay driving a 12 V LED lamp, controlled from Chrome over USB with the [Web Serial API](https://developer.chrome.com/docs/capabilities/serial) (Chrome and Edge only). The light-zone detector watches the lamp, so the twin marks the action "verified by camera" | The same command later goes to smart relays on real lighting circuits |
| **3. One-tap fix on Telegram** | The presenter's phone buzzes with an alert and a "Switch off" button; tapping it turns off the lamp | [Telegram Bot API](https://core.telegram.org/bots/api) inline buttons; the tap hits a webhook on Vercel, which broadcasts the command through Supabase Realtime to the twin | Facility staff act from their phones; the AI writes each alert in Kannada, Hindi or English |
| **4. Privacy inspector** | A panel shows the exact JSON leaving the camera each second, and a counter reading "0 images stored" | A small log view of outgoing messages | Answers the privacy objection before a judge raises it |
| **5. Live waste ticker and energy Sankey** | A rupee counter climbs while a room wastes power; a flow chart shows where every kWh goes | Derived from twin state, drawn with Recharts or d3-sankey | A lobby display for the campus |
| **6. Talk to the building** | The presenter asks aloud, "What would auto-off save this semester?" and the twin answers aloud with a chart | Web Speech API for listening and speaking; Chrome 139 added on-device recognition so audio need not leave the laptop ([Chrome 139](https://developer.chrome.com/blog/new-in-chrome-139)). The Copilot runs the simulation as a tool | Hands-free questions for managers walking the campus |
| **7. AI Surveyor** | We photograph the hall's ceiling and the AI draws boxes around every tube light, fan and AC, then adds them to the twin | Gemini object detection returns boxes, normalized to 0–1000, for any object we name ([Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding)); we confirm counts and wattages | Onboards a room in a minute, which answers "how does this scale to 300 rooms?" |
| **8. Photoreal 3D Lecture Hall 1** | The room appears as a photoreal 3D scan with glowing light zones and the live head-count | Scan with [Scaniverse](https://apps.apple.com/us/app/-/id1541433223) (free, on-device, 1–2 minutes of walking), export SPZ or PLY, render with [Spark](https://radiancefields.com/platforms/spark), the MIT-licensed splat renderer for three.js | A twin any non-technical manager understands at a glance |
| **9. Energy League** | A leaderboard ranks floors by wasted kWh per seat, with AI-written weekly shout-outs | A ranking view over twin data | At Oberlin, dorms with real-time feedback cut electricity 55% versus 31% with weekly data ([Petersen et al. 2007](https://cbsm.com/articles/32594-dormitory-residents-reduce-electricity-consumption-when-exposed-to-real-time-visual-feedback-and-inc)); a European program sustained 7% over two years ([Bull et al. 2018](https://spiral.imperial.ac.uk/bitstream/10044/1/63586/2/Bull%20et%20al%202018.pdf)) |
| **10. Time-travel replay** | A slider rewinds the building through the day | Replays the event log the twin already keeps | Investigating what was left on overnight |

**Recommended bundle.** Features 1–5 are cheap and high-impact, so they are part of the core plan. Add 6 and 7 only if the Day 1 gate passes on time. Feature 8 is the showstopper, attempted only if everything else is green by 10 AM on Day 2; scan the hall at the event, not before, to stay clearly within the rules.

**The upgraded wow moment (about 2.5 minutes).**

1. Our first slide shows a QR code. Judges scan it and see Lecture Hall 1 live on their phones.
2. The lamp on our table is on; the twin shows the room occupied with lights on, both confirmed by the camera.
3. The team walks out of frame. Twenty seconds later the room turns red on the projector and on the judges' phones, and the waste ticker starts climbing.
4. The presenter's phone buzzes with a Telegram alert in Kannada and English. They tap "Switch off".
5. The lamp on the table goes dark. The camera sees it, and the twin turns grey with "verified by camera".
6. The presenter asks aloud, "Pratibimb, what would auto-off save across A Block this semester?" The twin runs the simulation and answers with a range and a chart.
7. One click generates the NAAC-ready report as a PDF. The AI Surveyor stays in reserve for the scaling question in Q&A.

**Hardware kit (approximate prices; buy before the event, write the firmware at it).**

| Item | Approximate cost |
| --- | --- |
| Arduino Uno clone or ESP32 board | ₹400–700 |
| 5 V relay module or logic-level MOSFET module | ₹60–150 |
| 12 V LED strip, or 12 V bulb with holder | ₹150–300 |
| 12 V DC adapter | ₹150–250 |
| USB cable, jumper wires, small breadboard | ₹100–150 |
| Phone clamp or small tripod | ₹200–400 |

Use only low-voltage parts on stage and never switch 230 V mains at the venue. SP Road in Bengaluru or online stores stock everything above.

**Fallbacks for the wow features.** If Web Serial fails, the twin shows a simulated relay instead. If Telegram is slow, the same "Switch off" button exists in the twin UI. If voice recognition mishears in a noisy hall, the presenter types the question. If the 3D scan stutters, the 2D floor plan is one click away.

## Computer Vision module

We run a pretrained person detector in the browser and add three simple, reliable pixel techniques on top: light zones, fan motion and projector state. No model training is needed, so CV is working on Day 1 morning and the rest of the time goes into the twin.

**Model choice.**

| Option | License | Runs where | Use it for |
| --- | --- | --- | --- |
| [MediaPipe Object Detector, EfficientDet-Lite0/Lite2](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector/index) | Apache 2.0 | Browser (WebAssembly/GPU), no server | **Primary.** COCO-trained "person" class, 320×320 input, about 30 ms per frame for the int8 model on the device Google tested |
| YOLO11n via onnxruntime-web (see [Hyuto/yolov8-onnxruntime-web](https://github.com/Hyuto/yolov8-onnxruntime-web)) | AGPL-3.0 | Browser | **Upgrade** only if RF-DETR Nano also struggles; it forces an AGPL-3.0 license |
| [Ultralytics region counting](https://docs.ultralytics.com/guides/region-counting) in Python | AGPL-3.0 | Laptop or edge box with a Python server | **Fallback** if browser performance is poor; also matches the "edge device next to existing CCTV" production story |

**License warning.** Ultralytics states that any project using its YOLO code or trained models must be open-sourced under AGPL-3.0 ([Ultralytics licensing](https://www.ultralytics.com/license)). If we use YOLO, our repository license must be AGPL-3.0, not MIT. MediaPipe avoids this entirely.

**Better upgrade found in the second research pass.** RF-DETR Nano runs fully in the browser with Transformers.js and WebGPU under the Apache-2.0 license ([live demo](https://huggingface.co/spaces/webml-community/RF-DETR-WebGPU)). It improves accuracy in crowded halls without the AGPL obligation, so it replaces YOLO as our first upgrade. For the Python edge fallback, D-FINE is an Apache-2.0 alternative to Ultralytics.

**What we detect, and how.**

1. **Occupancy (ML).** Count "person" detections above about 0.4 confidence inside the room's region. Smooth with a rolling median over the last 5 readings so one missed frame does not flip the room to empty. Declare "empty" only after N seconds with zero people (5 minutes in production, 20 seconds in demo mode).
2. **Light zones (pixel math, no ML).** During setup, draw a box around each light fixture in the camera view and record its brightness with lights on and lights off. At runtime, compute mean luminance of each box per frame and compare against the midpoint of those two references, with a small hysteresis band to stop flicker. Comparing against a wall patch makes it robust to daylight.
3. **Daylight level.** Overall frame brightness near the windows tells us when daylight alone is enough, which powers a "switch off window-side lights" recommendation for indoor sustainability.
4. **Ceiling fans (stretch, pixel math).** Rotating blades create large frame-to-frame differences inside the fan's box; still blades do not. This gives fan on/off from a camera with no sensor.
5. **Projector or display (stretch).** A bright, changing screen region means the projector is on, often in an empty room after class.
6. **Privacy.** Run MediaPipe's face detector on each displayed frame and blur faces before drawing. Frames are never uploaded or stored; only numbers leave the device.

**Honest accuracy story for judges.** Exact head-counts in a crowded hall can be off by a few people because of occlusion. Energy decisions only need empty versus occupied, which is far more robust than exact counts, and published camera-based research reached 85–97% detection accuracy in real buildings. Exact counts matter only for room utilization and CO2 estimates, where small errors do not change the recommendation.

**Hardware for the demo.** Laptop webcam for Lecture Hall 1, plus one phone used as a second camera via the browser (open the app's camera page on the phone and it streams counts to the twin). No extra hardware purchase.

## Digital Twin module

The twin has three layers: a data model of A Block, a live state that cameras keep in sync, and a simulation engine that can run the building forward in time. The simulation engine is where most of our technical-implementation marks come from, because almost no rival team will have one.

**Layer 1: the building model.** One JSON file describes A Block: floors, rooms (name, type, seating capacity, floor area, volume, polygon on the floor plan), and each room's devices (type, rated watts, light zone). We name rooms and devices using the vocabulary of [Brick Schema](https://brickschema.org/), the open metadata standard for buildings, which signals to judges that the model could plug into a real building system later.

**Layer 2: live state.** Each room holds head-count, light zones on/off, device states, time since last occupied, and current watts. Camera rooms update from CV every two seconds; other rooms follow a timetable-driven simulator. All updates flow through one event log, which also stores every alert and every action taken.

**Layer 3: the simulation engine.** A discrete-time simulator with one-minute ticks. A full week for 30 rooms is about 300,000 room-ticks, which runs in well under a second in the browser.

- **Occupancy generator:** builds a week of class sessions from a timetable, with realistic noise (late starts, early exits, empty periods).
- **Human-behaviour model for the baseline:** after a class leaves, lights and fans stay on with probability p until the next class or a cleaner's round. We calibrate p from our own survey of A Block (see Preparation checklist).
- **Policies to compare:** manual baseline; auto-off after N empty minutes; daylight harvesting for window-side zones; room consolidation (small classes moved to smaller rooms).
- **Monte Carlo runs:** each scenario runs 20 times with different random seeds, so we report savings as a range (for example "₹X–Y per month") rather than one suspiciously precise number. Judges trust ranges.

**The core equations.** Energy, cost and emissions for each room and tick:

```latex
E_{kWh} = \sum_{d \in devices} \frac{P_d \cdot t_{on,d}}{1000}, \quad Cost = E_{kWh} \times tariff, \quad CO_2 = E_{kWh} \times EF_{grid}
```

Indoor air quality uses a standard single-zone CO2 mass balance, driven by the live head-count N:

```latex
\frac{dC}{dt} = \frac{N \cdot G \cdot 10^6}{V} - \frac{Q}{V}\,(C - C_{out})
```

Here G is CO2 generated per seated person (about 0.005 litres per second), V is room volume, Q is ventilation airflow, and C\_out is outdoor CO2 (about 420 ppm). When the projection crosses 1,000 ppm, the twin raises an indoor-sustainability alert such as "open windows in LH-1 within 15 minutes". These G and C\_out values are approximate textbook figures. Before suggesting open windows, the twin checks outdoor air quality from Open-Meteo's free Air Quality API; when outdoor air is poor, it recommends ventilation fans instead.

**How it looks.** The same room polygons render two ways. The default is a clean 2D floor plan in SVG, which is fast, sharp on a projector and impossible to break. As a stretch, the polygons are extruded into a simple 3D view with React Three Fiber for the opening shot of the demo. We do not build detailed 3D models: extruded boxes with glowing colours look modern and cost an hour, not a day.

## Generative AI module

Our rule: code computes every number, the AI writes the words. The AI never invents a kWh or rupee figure; it receives a compact facts pack from the twin and turns it into actions, explanations and a report. This makes the AI trustworthy, and "grounded" is the word to use with judges.

**Three AI features, in build order.**

1. **Event recommendations (Must).** When the rules layer fires an event (e.g., LH-1 empty 6 minutes, 8 lights and 4 fans on), we send the AI the event plus room facts and ask for JSON: title, action, reason, expected monthly saving (copied from the facts pack), priority. The UI shows it as a card with an "Apply" button.
2. **Sustainability report (Must).** One call per report. Input: a week of twin totals, top wasting rooms, scenario results, and the action log. Output: a report structured like a real energy audit, which typically contains an energy balance, energy-conservation measures with cost-benefit analysis, and a priority matrix ([GloCert](https://www.glocertinternational.com/resources/guides/naac-green-energy-environment-audits-criterion-7/)). Our sections: summary, building profile, baseline consumption, waste hotspots, indoor air quality, recommendations with cost-benefit, actions taken, method and assumptions.
3. **Twin Copilot with tool calling (Should, big innovation points).** A chat panel where the AI can call our functions: get room state, list top wasters, and run a scenario. Asking "what if we lock the third floor after 5 PM?" makes the AI run the real simulation and answer with its output. This is an AI agent operating the digital twin, which very few teams will attempt.

**Provider plan, all free.**

| Provider | Free-tier facts (verify in console before the event) | Our use |
| --- | --- | --- |
| [Groq](https://localaimaster.com/blog/groq-api-free-guide) | About 30 requests/minute; Llama 3.3 70B about 1,000 requests and 100K tokens per day; GPT-OSS models about 200K tokens per day; OpenAI-compatible API; very fast | Event cards and Copilot, where speed matters live on stage |
| Google Gemini (AI Studio) | Flash and Flash-Lite models are free; Pro models have left the free tier; free-tier requests per minute are low ([GeoToolbox](https://geotoolbox.ai/blog/gemini-api-pricing.md)) | Long sustainability report; backup provider |

We wrap both behind one function with automatic fallback: if one returns a rate-limit error, the other answers. The Vercel AI SDK gives one interface for both providers, with Zod-validated output and tool calling for the Copilot.

**Protecting the free quota during a live demo.**

- Never call the AI per frame. Only on events, debounced to one call per room per alert type every 5 minutes.
- Cache responses by facts-pack hash, so the same situation never costs a second call.
- Pre-generate a cached report and a set of cached recommendations as an offline fallback, clearly labelled internally.
- Send only numbers and room names, never images. Google's free-tier terms allow inputs to be used for model improvement, so this also keeps the privacy promise intact.

**Prompt design.** The system prompt casts the model as an energy auditor for an Indian university campus. It must use only figures from the facts pack, write money in rupees, name rooms by ID, keep each recommendation under 40 words, and return valid JSON matching our schema. The server validates the JSON and rejects any rupee or kWh figure that does not appear in the facts pack, then retries once.

## Architecture and tech stack

Pratibimb is one TypeScript web app on Vercel plus Supabase, with all heavy computer vision running in the browser. One language and one deploy target keeps a three-person team fast and leaves almost nothing to break on stage.

&#91;embedded content: Pratibimb architecture · 3 zones, 12 components\]

Cameras send only head-counts and light states through Supabase Realtime; the twin simulates and raises events, and the AI API turns those events into validated recommendation cards.

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React + Vite + TypeScript, Tailwind, shadcn/ui | Polished UI fast; the whole team works in one language |
| Computer vision | MediaPipe Tasks Vision inside a Web Worker, with RF-DETR Nano via Transformers.js as the accuracy upgrade | No GPU server, works offline, Apache 2.0, keeps the UI smooth |
| Twin state | Zustand store | Small and simple, perfect for live room state |
| Simulation | Plain TypeScript module in a Web Worker | A simulated week runs in under a second with no infrastructure |
| Realtime and storage | Supabase (Realtime channels + Postgres) | Free tier; links the phone camera to the twin screen; SQL for reports |
| AI | Vercel serverless functions using the Vercel AI SDK (Groq and Gemini providers), validated with Zod | Keeps API keys server-side; automatic fallback between providers |
| Charts, 3D, PDF | Recharts; React Three Fiber (stretch); browser print to PDF | Proven libraries with low risk |
| Hosting | Vercel | Free HTTPS, which browsers require for webcam access; one deploy for UI and API |

**Why no Python backend by default:** a second server means a second deployment, cold starts on free hosting, and more to break. Python stays as the edge fallback only if browser detection is too slow.

## Resources: what to use, what to only study

The rule that decides everything here: open-source libraries and pretrained models are allowed tools, but copying another project's application code is prohibited, because Code Clash bans pre-built projects and templates. So we install libraries freely, and we read the GitHub repos below only to learn patterns, then write our own code during the event.

**Libraries and models we install (allowed).**

| Resource | What it gives us | Notes |
| --- | --- | --- |
| [@mediapipe/tasks-vision](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector/index) | In-browser person detection and face detection | Apache 2.0; primary CV engine |
| onnxruntime-web | Run YOLO ONNX models in the browser | Only if we upgrade to YOLO (then AGPL-3.0 repo) |
| React + Vite (or Next.js), Tailwind CSS, shadcn/ui | Fast, polished UI | shadcn components are copied into the repo as a library, standard practice |
| React Three Fiber + drei | Extruded 3D view of A Block | Stretch goal only |
| Zustand | Twin state store in the browser | Tiny, no boilerplate |
| Recharts | Scenario comparison and usage charts |  |
| Supabase (Postgres + Realtime) | Event log, room state sync between the phone camera and the twin screen | Free tier; Firebase Realtime Database is an equal alternative |
| Groq SDK, Google GenAI SDK | LLM calls | Free tiers, see the AI section |
| Zod | Validate the AI's JSON output | Core to the grounding rule |
| @react-pdf/renderer or browser print | PDF sustainability report | Browser print is the zero-risk fallback |
| Vercel | Free deployment with HTTPS (webcam access requires HTTPS) |  |

**GitHub repos to study, not copy.**

| Repo | What to learn from it |
| --- | --- |
| [mac999/digital\_twin](https://github.com/mac999/digital_twin) | How a building twin links BIM, IoT data and AI occupancy (OpenPose) |
| [21aansh06/EnergyDigital](https://github.com/21aansh06/EnergyDigital) | What a typical Gemini + Three.js energy twin looks like, so we know what to beat |
| [Hyuto/yolov8-onnxruntime-web](https://github.com/Hyuto/yolov8-onnxruntime-web) | Running YOLO in the browser with WebAssembly; the nano model is about 13 MB |
| [akbartus/Yolov8-Object-Detection-on-Browser](https://www.github.com/akbartus) | Live webcam YOLO in plain JavaScript, no framework |
| [ultralytics/ultralytics](https://docs.ultralytics.com/guides/region-counting), YOLOv8-Region-Counter example | Counting people inside drawn regions |
| [LuisM78/Occupancy-detection-data](https://archive.ics.uci.edu/dataset/357/occupancy+detection) | Scripts behind the UCI occupancy paper |

**Datasets (for realism, validation and the pitch).**

| Dataset | Contents | How we use it |
| --- | --- | --- |
| [UCI Occupancy Detection](https://archive.ics.uci.edu/dataset/357/occupancy+detection) | About 20,000 minute-level readings of temperature, humidity, light (lux), CO2 and ground-truth occupancy from an office; CC BY 4.0 | Shapes our simulated CO2 and light curves, and lets us show judges our CO2 model behaves like real data |
| Building Data Genome Project 2 (GitHub: buds-lab) | One of the largest open sets of hourly energy-meter data from non-residential buildings, including university buildings | Realistic daily load shapes for the simulator's baseline |
| Our own A Block waste-walk survey | Count of empty rooms with lights or fans on, taken by us on campus | Calibrates the baseline behaviour model; original data no rival has |

**Papers to cite in the PPT.** Tien et al. on camera-based occupancy and equipment detection ([Energies, 2020](https://doaj.org/article/3ef96fc779284e3c8572d37cf2e4f008)), the Applied Energy university-building study ([Cardiff ORCA](https://orca.cardiff.ac.uk/178040)), and the EPA occupancy-sensor study ([EC&M summary](https://www.ecmweb.com/contractor/epa-study-shows-occupancy-sensors-reduce-energy-waste-demand)). Three citations on one slide make the approach look research-backed rather than improvised.

**Second research pass: resources that help an AI build Pratibimb correctly.** AI coding tools write wrong code mostly when they guess at library APIs or cannot see the running app. These servers fix both, and all of them are free to connect.

| Resource | What it does for the AI builder | Link |
| --- | --- | --- |
| Context7 MCP server (Upstash) | Pulls current, version-specific docs for MediaPipe, Supabase, AI SDK and others into the AI's context; add "use context7" to prompts | [upstash/context7](https://github.com/upstash/context7) |
| Chrome DevTools MCP (Google) | Lets the AI open our app in Chrome, read console errors and failed requests, take screenshots, fix, and re-check | [Chrome blog](https://developer.chrome.com/blog/chrome-devtools-mcp) |
| Figma MCP server (remote, all plans) | The AI reads our Figma screens as React + Tailwind context, so UI comes out matching the design | [Figma guide](https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server) |
| Supabase MCP server | The AI can create tables and inspect data; use it only on our hackathon project | npm: @supabase/mcp-server-supabase |

**Better libraries and free APIs found in this pass.**

| Resource | Use in Pratibimb | License or cost |
| --- | --- | --- |
| RF-DETR Nano in the browser via Transformers.js + WebGPU | More accurate person detection for crowded halls, running locally | Apache-2.0 ([live demo](https://huggingface.co/spaces/webml-community/RF-DETR-WebGPU)) |
| D-FINE (via easydetect) | Accurate detector for the Python edge fallback; D-FINE-S scores 48.5 COCO mAP with 10M parameters | Apache-2.0, code and weights ([PyPI](https://pypi.org/project/easydetect/)) |
| Vercel AI SDK with @ai-sdk/groq and @ai-sdk/google | One interface for both LLMs, Zod-validated structured output, and tool calling for the Copilot | Open source ([ai-sdk.dev](https://ai-sdk.dev)) |
| grammY | TypeScript Telegram bot framework with an official guide for Vercel serverless | Open source ([hosting guide](https://grammy.dev/hosting/vercel)) |
| Open-Meteo forecast and Air Quality APIs | Cloud cover and solar radiation for daylight-harvesting advice; outdoor air quality to decide whether "open the windows" is good advice | Free for non-commercial use, no key, CC BY 4.0 attribution ([open-meteo.com](https://open-meteo.com)) |
| Wokwi | Browser simulator for Arduino and ESP32; test the relay logic before the board arrives, or if it fails | Free tier ([wokwi.com](https://wokwi.com)) |

**What AI coding tools are actually free for us (verify before the event; these change often).**

| Tool | Status for DSU students at the time of research |
| --- | --- |
| GitHub Copilot | Copilot Free works for anyone. Copilot Student is free for verified students, but new sign-ups have been paused ([GitHub Docs](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/enable-copilot/set-up-for-students)) |
| Cursor | The free student year currently accepts only US .edu emails; Indian .ac.in addresses are not supported ([Cursor forum](https://forum.cursor.com/t/cursor-pro-plan-for-students/148193)). New accounts get a 2-week Pro trial, so create accounts shortly before the event |
| Gemini CLI | Its free 1,000-requests-a-day tier has ended; Google moved free users to Antigravity CLI with a much smaller quota ([Tembo](https://www.tembo.io/blog/gemini-cli-pricing)) |
| Open-source agents with free API keys | Agents such as Cline accept a free Gemini or Groq key; slower and rate-limited, but a working backup |

Three members each have their own free quotas, so do the heaviest generation early on Day 1. If one paid seat is affordable for a month, it removes the biggest risk of the build: running out of AI quota halfway through.

**Supabase free-tier detail that matters.** Free projects pause after one week of inactivity, and the free plan includes 200 concurrent Realtime connections and 2 million messages ([Neon's comparison, citing Supabase pricing](https://neon.com/guides/neon-vs-supabase-free-plan)). Create the project on Day 1, and open it once a week afterwards if judges or DSU will view the demo later.

## Building Pratibimb with AI tools

AI can write most of the code, but three things decide whether an AI-built project wins: fixed contracts between modules before anyone generates code, running and checking every piece, and a team that can explain every file to judges. The companion tab AI build spec holds the contracts, acceptance checks and a prompt for every module, ready to hand to an AI coding tool.

**Rules check.** Code Clash allows any open-source tools, APIs and cloud platforms, and requires all code to be written during the event. It says nothing either way about AI assistants, so ask the organizers on the same call as the other questions. Code an AI generates at the event is written during the event. Specs and prompts prepared beforehand are planning documents, like our Figma mockups.

**The workflow for three people.**

1. **Hour 1, contracts first.** Save the AI build spec tab into the repo as BUILD\_SPEC.md and point the AI tool's instruction file at it. One person generates only the folder skeleton and the shared types, commits, and everyone pulls.
2. **Parallel modules.** Each member's AI session works only inside their own folder and imports shared types from one place, so three AI sessions never edit the same file.
3. **Run everything.** After each prompt, run the code and tick its acceptance check. Let the AI use Chrome DevTools MCP to see console errors itself. Never commit code nobody has run.
4. **Merge at the gates.** Integration happens at the 4:30 PM Day 1 gate and the 1:00 PM Day 2 freeze, not continuously.
5. **Explain-back.** After each module, ask the AI to explain each file as if to a judge, then the owner rehearses it aloud. Technical Implementation and Teamwork are 40% of the score, and judges' questions are where AI-built projects get exposed.

**Guardrails for AI-written code.**

- Secrets only in environment variables; never paste keys into prompts.
- Ask the AI to use Context7 for every library, so it uses current APIs rather than guessing.
- Small files with one job each; AI edits small files far more reliably than large ones.
- Original code only: libraries are fine, but never ask the AI to copy another project's repository.
- Commit after every working step, so a bad AI edit is one revert away.
- All numbers are computed in the twin engine; the AI writes words and UI, never the energy maths in the UI.

**AI quota plan.** Heavy generation (skeleton, CV worker, engine, screens) happens in the first six hours, when quotas are fresh. Day 2 prompts are small fixes and polish.

## Numbers we will use

Every number lives in one config file so it can be changed live if a judge questions it. Using India's own grid factor and a Karnataka tariff, instead of generic global numbers, is a small detail judges notice.

| Parameter | Planning value | Source and caveat |
| --- | --- | --- |
| Grid emission factor, India | 0.727 kg CO2 per kWh | CEA CO2 Baseline Database, weighted average for 2023-24 ([SolarQuarter summary](https://solarquarter.com/2025/01/06/co2-baseline-database-highlights-indias-progress-in-renewable-energy-and-emission-reduction-cea/)); check cea.nic.in for a newer version |
| Electricity tariff, DSU | About ₹8 per kWh, configurable | KERC's 2025 combined tariff order covers FY2025-26 to FY2027-28 for BESCOM ([KERC order](https://data.opencity.in/dataset/kerc-combined-tariff-order-2025)), and HT educational energy charges were cut by 90 paise for 2025-26 ([The Week/PTI](https://www.theweek.in/wire-updates/national/2025/03/27/mes21-ka-electricity-tariff.html)). Rates have since been revised and a true-up surcharge added ([Deccan Herald](https://www.deccanherald.com/amp/story/india/karnataka/bengaluru/power-bills-in-bengaluru-to-go-up-from-may-3971802)). Best: ask DSU's estate office for the actual per-unit rate on the bill |
| Savings from occupancy-based switching | 58% energy savings in classrooms (5-minute delay) | US EPA study, 158 rooms ([EC&M](https://www.ecmweb.com/contractor/epa-study-shows-occupancy-sensors-reduce-energy-waste-demand)) |
| Typical lighting savings range | 20–60% | Manufacturer and field data ([Lutron classroom guide](https://www.1000bulbs.com/pdf/lutron-rmjeco32dvb-classrooms.pdf)) |
| LED tube light | About 20 W | Approximate; confirm from nameplates during our survey |
| Ceiling fan, conventional / BLDC | About 75 W / 30 W | Approximate |
| 1.5-ton split AC | About 1,500 W | Approximate; star rating changes this |
| Projector | About 300 W | Approximate |
| Lab desktop with monitor | About 120 W | Approximate |
| CO2 per seated person | About 0.005 litres per second | Approximate textbook value |
| Outdoor CO2 | About 420 ppm | Approximate |
| Indoor CO2 alert threshold | 1,000 ppm | Common indoor-air-quality guideline |

**A worked example for the pitch (illustrative).** A classroom with 10 LED tubes and 6 conventional fans draws 650 W. If it sits empty with everything on for 3 hours a day over 22 working days, it wastes about 43 kWh a month: roughly ₹340 and 31 kg of CO2. Across 50 such rooms, that is about ₹17,000 and 1.6 tonnes of CO2 every month, before counting a single air conditioner. Replace these assumptions with our survey data before the final pitch.

## Real-world deployment: from demo to a DSU pilot

Pratibimb is designed so DSU could pilot it in two classrooms within a month, using cameras it already owns. Only small numeric events leave the campus network, which also suits India's new privacy law. Offering this pilot in the pitch turns the project from a demo into a proposal.

**Connecting real CCTV.** Campus IP cameras and their recorders usually expose RTSP video streams. [MediaMTX](https://github.com/bluenviron/mediamtx), a free single-binary media server that also runs on a Raspberry Pi, converts RTSP into WebRTC or HLS that a browser can play, so the same in-browser CV worker runs on an edge machine inside the campus network. A small Python worker reading RTSP directly is the alternative. Either way, video never leaves the LAN.

**Edge hardware.** One spare lab PC or small edge box per floor can handle several cameras, because occupancy changes slowly and one frame every second or two per camera is enough.

**Actuation in production.** Phase one is advisory only: Telegram alerts to staff, no automatic switching. Phase two adds smart relays or contactors on lighting circuits, installed by DSU's electricians, or integration with a building management system. Automatic switching starts only after the advisory week shows that false "empty" readings are rare.

**Privacy and India's DPDP law.** MeitY has notified the Digital Personal Data Protection Rules, with obligations phasing in over the following months ([AZB & Partners](https://www.azbpartners.com/bank/indias-digital-personal-data-protection-act-phased-rollout-and-key-compliance-milestones/)). Camera footage of students is personal data, so the design minimizes it: processing on the edge, faces blurred on any display, zero images stored, and only counts and light states sent to the cloud. Rooms get a visible notice. DSU's legal and IT teams should review this before a pilot; it is design guidance, not legal advice.

**A four-week pilot to offer DSU in the pitch.**

1. Week 1: install in two similar classrooms; advisory alerts only.
2. Week 2: measure the baseline, hours of lights and fans running in empty rooms.
3. Weeks 3–4: turn on the auto-off policy in one room and keep the other as a control; compare kWh with a clamp meter or sub-meter. A control-room comparison is the same design used in published university energy studies ([Otago study](https://pmc.ncbi.nlm.nih.gov/articles/PMC2884359)).
4. Deliver a pilot report generated by Pratibimb itself, plus the action log as energy-audit evidence for NAAC.

**Costs and payback (illustrative).** The software runs on free tiers for a pilot. In the worked example, one 650 W classroom wastes about ₹340 a month; a relay kit of roughly ₹2,000 per room would pay back in about six months at that rate, and faster in rooms with ACs. Replace these figures with pilot measurements.

**Business model.** A per-building subscription for colleges with the NAAC evidence pack as the hook, or an open-source campus edition with paid installation.

**Scaling to a whole campus.** Each block is one JSON model, the AI Surveyor onboards rooms from photos, edge boxes process cameras locally, and the cloud holds only small events.

## Preparation checklist

Everything below is research, design, data collection and account setup, which wins the hackathon before it starts.

**Registration and rules.**

- [ ] Register on the official form, select PS04, and double-check the UTR number for the ₹299 payment
- [ ] Call an organizer and confirm: is a CLI scaffold (e.g., `npm create vite`) allowed? Can we bring a pre-drawn floor-plan image and Figma mockups? Can we place a webcam in the room during judging? Can we stay late on Day 1?

**Field research on A Block (our unfair advantage).**

- [ ] Sketch the floor plan of the floors we model: room names, rough dimensions by pacing, windows, doors
- [ ] Count devices per room: tube lights, fans, ACs, projectors, lab PCs; photograph nameplates for wattage
- [ ] Do a "waste walk" three times on one day (around 1 PM, 4:30 PM, 6 PM): note every empty room with lights or fans on. Never photograph people
- [ ] Ask the estate office for the per-unit electricity rate on DSU's bill, any monthly consumption figure for A Block, and the room timetable

**Accounts and keys (test each once in a throwaway sandbox).**

- [ ] GitHub: one team account owner, all three members added as collaborators
- [ ] Vercel and Supabase accounts (free tier)
- [ ] Groq and Google AI Studio API keys; note the actual free limits shown in each console

**Skill practice, in a separate repo we never submit.** Each member spends 2–3 hours learning their module's tools: MediaPipe webcam detection, SVG floor plan with Zustand, Groq JSON-mode calls, Supabase Realtime. Delete that repo afterwards and rewrite everything at the event; practice builds speed, not code.

**Design and pitch (not code).**

- [ ] Figma wireframes for Live Twin, Room Detail, Scenario Lab and Reports; pick colors and fonts
- [ ] Draft the pitch story and slide outline; final numbers go in during the event

**Kit and logistics.**

- [ ] Laptops and chargers, extension board, HDMI adapter, phone tripod or clamp, a USB webcam if anyone has one, phone hotspot data
- [ ] College IDs for all members; plan travel so everyone reaches Harohalli before 8:30 AM, since one absence cancels the whole team's attendance

**For the wow features.**

- [ ] Buy the low-voltage hardware kit listed in the Wow features section, and ask an organizer whether hardware on the demo table is allowed
- [ ] Create the Telegram bot with BotFather and keep the token private (account setup, not code)
- [ ] On the demo laptop's Chrome, confirm Web Serial works and download the on-device speech language pack
- [ ] Install Scaniverse on one phone and practise a 2-minute scan of a room at home; the real Lecture Hall scan happens at the event

**For building with AI.**

- [ ] On the organizer call, also ask whether AI coding assistants are allowed
- [ ] Each member installs an AI coding tool and connects Context7, Chrome DevTools MCP and the Figma MCP server; test them in the throwaway practice repo
- [ ] Create any Cursor accounts shortly before the event so the 2-week Pro trial covers both event days; check the other free tiers the same day
- [ ] Design the five screens (Live Twin, Room Detail, Scenario Lab, Reports, Judge view) in Figma so the AI can read them through the Figma MCP server
- [ ] Write up the A Block survey notes that prompt P1 needs, and export the AI build spec tab as Markdown

## Two-day build plan and roles

The whole plan bends around one gate: by 4:30 PM on Day 1, a person walking out of the camera's view must turn a room red on the twin and produce an AI card. Everything after that adds depth and polish to something that already works.

&#91;embedded content: Two-day build plan · 5 phases, 4 roles, 3 gates\]

Stretch items (in grey) are the first things cut if a gate slips; the Must list from the solution section never shrinks.

**Working rules for the two days.**

- Hour 1: create the repo, first commit by every member, and deploy a hello-world to Vercel so deployment is never a last-minute surprise.
- Commit small and often with Conventional Commit messages (`feat:`, `fix:`), one branch per role, merged to `main` at each gate. The commit history is our proof of original work and of teamwork.
- A 10-minute stand-up at each gate: what works, what is blocked, what gets cut.
- Day 2 workshops and the mentor check-in are attended as required; rotate who listens so building never fully stops.
- The AI + pitch lead owns the clock and calls the feature freeze at 1:00 PM regardless of who is mid-task.

## Demo, pitch and judge questions

The pitch opens with our own waste-walk numbers, spends most of its time on the live demo, and ends with a monthly rupee and CO2 figure for A Block. Every team member speaks once, which also scores the 10% teamwork criterion.

**Three-minute pitch (stretch or shrink to the slot given).**

| Time | Beat | What we say or show |
| --- | --- | --- |
| 0:00–0:20 | Hook | "Right now, in this building, a room with nobody in it is burning electricity. On our walk through A Block, we found X of Y empty rooms with lights or fans on." |
| 0:20–0:45 | Problem | Buildings use a third of India's electricity; nobody sees campus waste live; NAAC still asks for energy audits |
| 0:45–2:15 | Live demo | The demo path from the solution section: live twin, walk-out, red room, AI card, Scenario Lab, PDF report |
| 2:15–2:35 | How it works | One slide: the sense → mirror → simulate → advise → act loop; on-device CV; grounded AI |
| 2:35–2:50 | Impact | Simulated monthly savings range for A Block in ₹ and kg CO2; zero new hardware because it reuses CCTV |
| 2:50–3:00 | Close | "Pratibimb means reflection. We built a reflection of A Block that doesn't just show the waste, it stops it." |

**PPT outline (9 slides).** Title → Problem with our survey data → Solution and the loop → Architecture → Computer vision → Twin and simulation → Grounded generative AI → Results chart (baseline vs policy) and research backing → Team roles and future scope.

**Demo safety net.**

- A "Demo mode" switch that shortens the empty-room delay to 20 seconds and serves cached AI responses if the network fails.
- CV runs in the browser, so it keeps working without internet.
- A 60-second screen recording of the full demo path, saved locally on two laptops.
- Phone hotspot as backup to venue Wi-Fi.

**Tough questions and our answers.**

| Likely question | Our answer |
| --- | --- |
| Isn't this just a dashboard? | No. It syncs live from cameras, simulates the future, and sends control actions back; that is the definition of a twin rather than a model |
| Cameras in classrooms violate privacy. | Detection runs on the device, faces are blurred, and only numbers leave it. We store zero images |
| How accurate is the count in a full hall? | Exact counts can be off by a few, but energy decisions need only empty vs occupied, which is far more robust. Published camera studies report 85–97% accuracy |
| Where does fan and AC data come from? | Lights and visible fans are detected by CV; ACs are a clearly labelled simulated feed. In production, smart plugs or the building management system supply them |
| Why trust your savings numbers? | They come from India's grid factor, the local tariff, our own survey, and an EPA study that measured 58% classroom savings. We show a Monte Carlo range, not a single number |
| What if the AI hallucinates? | Code computes every number; the AI only writes text. Its JSON is validated, and any figure not in the facts pack is rejected |
| Why not just use motion sensors? | They cannot count people, switch off when students sit still, and need installation per room. Cameras already exist and give richer data |
| A rules engine could flag waste. Why GenAI? | Rules detect; the AI prioritizes, explains in plain language, writes the audit report, and answers what-if questions by running the simulation |
| What does it cost DSU? | Software only, reusing existing CCTV and one lab PC or edge box per block; the free tiers cover a pilot |
| How does it scale to the campus? | Each block is one JSON model; cameras process locally; the cloud holds only small numeric events |
| What did you build vs borrow? | The detector is MediaPipe's pretrained model. The twin, simulation, light and fan detection, grounding layer and UI were written here, as the commit history shows |
| What about night or dark rooms? | Lights off means no lighting waste to detect; IR CCTV still sees people if needed |
| Biggest limitation? | We switch one real lamp, not a building's wiring, and we modelled one building. The four-week pilot in the deployment section is the next step |
| Business model? | Per-building subscription for colleges, with the NAAC audit report as the hook, or an open-source campus edition |
| Data security? | No images stored, keys in environment variables, database row-level security, read-only public view |

## Risks and fallbacks

The biggest risks are scope creep and the venue network, not the technology. Each risk below has a fallback decided now, so nobody improvises under pressure.

| Risk | Fallback decided in advance |
| --- | --- |
| Venue Wi-Fi fails during the demo | CV runs in the browser offline; Demo mode serves cached AI responses; phone hotspot; recorded video as last resort |
| AI free-tier limit hit | Automatic Groq ↔ Gemini fallback, response caching, one call per event per 5 minutes |
| Browser CV too slow on a laptop | Detect every 500 ms instead of every frame, use the int8 Lite0 model, or switch to the Python edge fallback |
| Head-count wrong on stage | Demo room has few people in view; the story relies on empty vs occupied, which is robust |
| 3D view eats hours | It is a stretch goal; the 2D floor plan is the product |
| Scope creep | Cut list, in order: fans and projector detection → utilization heatmap → 3D view → Copilot chat. The Must list never shrinks |
| Deployment breaks late (HTTPS, environment variables, camera permission) | Deploy a hello-world to Vercel in hour 1 and redeploy after each milestone; keep a localhost demo ready |
| Questions about who built what | Small frequent commits from all three members, Conventional Commit messages, and each member explains their own module |
| License conflict if YOLO is used | Repository licensed AGPL-3.0 from the first commit |
| Judges doubt simulated data | Every simulated value is labelled in the UI, and the baseline is calibrated from our own survey |
| Day 2 workshops cut build time | Attend as required, rotate who listens, feature freeze at 1:00 PM regardless |
| Late submission | Submit at 3:30 PM, an hour before the 4:30 deadline: GitHub link, Vercel link, PPT (also as PDF), and files on Google Drive |
