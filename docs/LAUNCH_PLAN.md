# Launch plan: workspaces, multi-camera setup, AI setup, free hosting

The team's request, restated as a specification. Every item stays inside Problem Statement 04: a digital twin of a building, computer vision for occupancy, lighting and resource use, and generative AI recommendations.

## 1. The request, made precise

| # | Asked | Specified as |
| --- | --- | --- |
| 1 | A login so many people can use the product at once without colliding | **Workspaces.** The first page asks for a workspace name and password, with *Open* and *Create*. Everything inside a workspace is private to it: the site, cameras, live channel, events, alerts, AI calls, sensor key, Telegram chat, public view. |
| 2 | Push to a test GitHub repository | Commit the project and push to `rishushaurya/just_for_fun` (test only; the team will move to a final repository later). |
| 3 | A full guide to put it online | `docs/DEPLOY.md`: GitHub, Supabase, Vercel, AI keys, Telegram, checks, all on free tiers. |
| 4 | Camera settings lost on going back; data not sent or calculated | Find and fix the root causes (section 3), make settings save themselves and follow the workspace to every device. |
| 5 | Everything needed to reach full potential | The key list in `docs/DEPLOY.md`, with what each key unlocks. |
| 6 | Stay inside the problem statement; plan security | Section 4. |
| 7 | "Set up with AI" | A format to describe the building; the AI only extracts fields into a draft; code validates it, drops any number not in the text, and the person reviews and saves. |
| 8 | Several cameras per room across floors, analysed live | A camera station: several cameras on one device, cameras on phones by QR code, each with its own saved zones, all merged per room by the twin. |

## 2. Deployment blockers found

| Problem | Effect | Fix |
| --- | --- | --- |
| 14 files in `api/`; Vercel Hobby allows **12 functions** per deployment, one per file | The free deploy fails | One router function `api/[...route].ts`; handlers move to `api/_routes/` (underscore folders are not functions) |
| `events` table had a policy letting anyone with the public key read it | Every tenant's audit log readable by anyone | Policy removed; the browser reads events only through `/api/events` with its workspace token |
| One channel name per deployment (`twin:site`), and the public key can join any channel | Anyone could read the live twin or **send switch-off commands** | Private channel per workspace with a secret suffix derived on the server; a separate public channel that only carries snapshots |

## 3. Camera bugs found (item 4)

| Symptom | Root cause | Fix |
| --- | --- | --- |
| Camera opened from the twin's own tab: nothing reaches the twin, nothing is calculated | `BroadcastChannel` never delivers a message to the object that sent it, and Supabase is set to `self: false` | `send()` also delivers to listeners in the same tab |
| Going back to the twin stops the camera | The camera page unmounts on navigation | A camera station mounted at the app root keeps feeds running while you use the rest of the app |
| Coming back starts from scratch | Source not remembered | Each device remembers which cameras it runs and with which source, and resumes them |
| After coming back, a phantom camera and a false "camera offline" alert | A new random camera id on every visit | Stable camera ids per room (`LH-1/cam-1`) |
| Zones lost on another device, and two cameras in one room overwrite each other's zones | Zones stored per room, in one browser only | Zones stored per camera in the workspace, on the server |
| Data stops when the camera tab or the twin tab is in the background | Chrome throttles timers in hidden tabs to once a minute after 5 minutes | Detection and the twin tick run on a Web Worker timer, which hidden-tab throttling does not slow |
| A phone shows no rooms | The site was readable only with the operator token | The phone joins the workspace and reads its site |

## 4. Security plan

- **Passwords** hashed with scrypt (Node's built-in `crypto`) and a random salt; compared in constant time. Never stored or logged in clear.
- **Sessions** are HMAC-signed tokens (`WORKSPACE_SECRET`), 30 days, sent as `Authorization: Bearer`. No session table.
- **Every private endpoint** checks the token and acts only on the token's workspace: site, cameras, events, commands, alerts, AI.
- **Brute force:** login is rate-limited per address; scrypt makes each guess slow.
- **Live channels:** the private channel name carries a secret only workspace members receive. The public view gets a different channel that carries snapshots only. Visitor tips go through the server, which checks the public key and rate-limits.
- **Sensor API:** one key per workspace, derived on the server, shown in Setup.
- **Telegram:** one bot per deployment; each workspace sets its own chat id. Button presses carry the workspace and room, and are checked against Telegram's secret header.
- **AI setup:** the description is treated as data inside delimiters; the model may only return the fixed JSON shape; Zod validates every field; any number not present in the text is dropped and listed; nothing is saved until a person presses Save. The AI can fill a draft and nothing else.
- **Unchanged:** Zod on every request, size limits, CSP and security headers, no frame ever leaves a camera, secrets only in environment variables.
- **Known ceiling:** rate limits are per server instance (in memory); a shared store (Upstash) is the upgrade path. Realtime channels rely on unguessable names; Supabase private channels with RLS are the upgrade path.

## 5. Without Supabase (localhost, one machine)

The server answers 503 for workspaces, and the entry page creates a **local workspace** in this browser instead (password hashed with PBKDF2 in WebCrypto). Data is separated per workspace on the device. Phones need the online version.

## 6. Build order and checks

1. Router function; tests updated. Check: `npm test`, `/api/health` through the dev server.
2. Workspaces on server and client; storage namespaced per workspace. Check: two workspaces in two browsers see different sites.
3. Realtime: same-tab delivery, private and public channels, worker timer. Check: camera in the twin's tab updates the twin.
4. Camera station, per-camera zones, QR join, overview. Check: two feeds on one laptop, navigate away and back, feeds keep sending.
5. Set up with AI. Check: injection text in the description changes nothing outside the draft; numbers not in the text are dropped.
6. Docs, `.env.example`, schema; full test, type check, build; browser run; commit and push.

## 7. Status

Built and tested; see `CHANGELOG.md`, Session 24. Remaining: deploy with real keys and run `docs/DEPLOY.md` section 8 on the live address.
