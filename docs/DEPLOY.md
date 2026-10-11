# Putting Pratibimb online, free

Everything below runs on free plans: GitHub, Supabase (database and live channel), Vercel (website and API), Groq and Google AI Studio (AI), Telegram (alerts). Allow about 30 minutes the first time.

| Service | What it does for Pratibimb | Free plan limits that matter |
| --- | --- | --- |
| GitHub | Holds the code; Vercel deploys from it | None for this project |
| Supabase | Workspaces, sites, camera settings, event log, live channel for phones and sensors | 500 MB database, 2 million realtime messages a month; the project pauses after a week with no use (one click to resume) |
| Vercel (Hobby) | The website and the API | Non-commercial use; 12 functions per deployment (Pratibimb uses 1); cron at most once a day (the digest runs weekly) |
| Groq | Fast AI for recommendations, reports, Copilot and Set up with AI | Requests per minute and per day are capped; Pratibimb caches answers and falls back to templates |
| Google AI Studio (Gemini) | Second AI provider, and photos for the AI Surveyor | Same: capped per minute and per day |
| Telegram | Alerts with a switch-off button, weekly digest | None for this use |

When Pratibimb is sold to customers, move Vercel to Pro (commercial use) or another host; nothing in the code changes.

## 1. Keys you will collect

| Key | Where it comes from | What it unlocks |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Supabase, Project Settings, **Data API**, Project URL (or the **Connect** button at the top of the project), `https://<project-ref>.supabase.co`, without `/rest/v1/` | Live channel (phones, cameras, sensors over the internet) |
| `VITE_SUPABASE_ANON_KEY` | Supabase, Project Settings, **API Keys**, Publishable key (`sb_publishable_...`); a legacy `anon` key also works | Same; it is public by design and can read or write no table |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase, Project Settings, **API Keys**, Secret key (`sb_secret_...`, press the eye to reveal it); a legacy `service_role` key also works | Server storage: workspaces, sites, cameras, events. **Secret.** |
| `WORKSPACE_SECRET` | You generate it (step 3) | Signs workspace sessions; derives channel names and sensor keys. **Secret.** |
| `GROQ_API_KEY` | console.groq.com, API Keys | AI recommendations, reports, Copilot, Set up with AI |
| `GEMINI_API_KEY` | aistudio.google.com, Get API key, then **Copy key** (it starts with `AQ.` or `AIza`) | AI fallback and the AI Surveyor (photo to device list) |
| `TELEGRAM_BOT_TOKEN` | Telegram, @BotFather, /newbot | Alerts and the weekly digest |
| `TELEGRAM_WEBHOOK_SECRET` | You generate it | Lets only Telegram call `/api/telegram` |
| `CRON_SECRET` | You generate it | Lets only Vercel Cron call `/api/digest` |
| `COMMAND_WEBHOOK_URL`, `COMMAND_WEBHOOK_SECRET` | Optional: your Home Assistant or control system | Switch-off commands to real equipment (docs/INTEGRATIONS.md) |

The minimum for the full product: the three Supabase keys, `WORKSPACE_SECRET`, and one AI key. Telegram and the command webhook can come later. Without any key, the app still runs on one computer (section 9).

## 2. Push the code to GitHub

The test repository is `rishushaurya/just_for_fun`. From the project folder:

```bash
git remote add origin git@github.com:rishushaurya/just_for_fun.git
```

```bash
git push -u origin main
```

Do not run the `echo "# just_for_fun" >> README.md` line GitHub suggests: it would append to Pratibimb's README. `.env` is ignored by git, so no key is ever pushed. Check before every push:

```bash
git status --short
```

**Moving to the final repository later:** create the new empty repository on GitHub, then point this folder at it and push:

```bash
git remote set-url origin git@github.com:<owner>/<new-repo>.git
```

```bash
git push -u origin main
```

In Vercel, open the project, Settings, Git, and connect the new repository (or import it as a new project and copy the environment variables). Supabase does not change.

## 3. Generate the secrets

Run this once per secret (`WORKSPACE_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET`, and `COMMAND_WEBHOOK_SECRET` if you use it) and keep the outputs in a password manager:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Changing `WORKSPACE_SECRET` later signs everyone out and changes every sensor key and channel name, so set it once.

## 4. Supabase

1. supabase.com, New project. Pick the region closest to your buildings and a strong database password.
2. SQL Editor, New query, paste all of [`supabase/schema.sql`](../supabase/schema.sql), Run. It creates `workspaces`, `sites` and `events`, all with row-level security on and no public access.
3. Project Settings, Data API: copy the Project URL. Project Settings, API Keys: copy the publishable key and the secret key (press the eye icon, then copy). The legacy `anon` and `service_role` keys also work, but Supabase is retiring them.

## 5. AI keys

- **Groq:** console.groq.com, sign in, API Keys, Create API Key.
- **Gemini:** aistudio.google.com, Get API key, Create API key.

One is enough; with both, Pratibimb uses Groq first and Gemini when Groq is busy, and Gemini first for photos. The defaults are `openai/gpt-oss-120b` on Groq and `gemini-flash-latest` on Gemini (an alias Google moves to its current Flash model); leave `GROQ_MODEL`, `GROQ_VISION_MODEL` and `GEMINI_MODEL` empty to use them. Providers retire models often: `npm run check:keys` reports a retired model by name.

## 6. Vercel

1. vercel.com, sign in with GitHub, Add New, Project, import the repository. Vercel detects Vite; keep the defaults (build `npm run build`, output `dist`).
2. Before the first deploy, open Environment Variables and add every key from section 1 that you have, for Production and Preview. `VITE_` keys are built into the page, so after changing one, redeploy.
3. Deploy. The address looks like `https://<project>.vercel.app`.
4. Check `https://<project>.vercel.app/api/health`: it should say `"status":"ok"` with `"storage":"ok"`.

Before deploying, you can test every key from your computer: put them in `.env` (copy `.env.example`) and run `npm run check:keys`. It prints pass or fail for each service and never prints a key.

`vercel.json` already sets the security headers and the weekly digest (Mondays). The whole API is one function, `api/[...route].ts`, so the Hobby limit of 12 functions is never reached.

## 7. Telegram (optional)

1. In Telegram, message @BotFather, send `/newbot`, follow the steps, copy the token into `TELEGRAM_BOT_TOKEN` on Vercel, and redeploy.
2. Register the webhook once (replace the three parts):

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<project>.vercel.app/api/telegram&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

3. Add the bot to your staff group, send `/chatid` in the group, and paste the number it replies with into Pratibimb, Setup, Integrations, Telegram chat id. Save.

## 8. First run, and checking every feature

Open `https://<project>.vercel.app`.

| Step | Do | It works when |
| --- | --- | --- |
| Workspace | Create a workspace: a name and a password of at least 8 characters | The Live twin opens; the menu at the top right shows the name and says "An online workspace" |
| Setup | Search your city, check the tariff, add floors and rooms, or press **Set up with AI** and describe the building; review, then **Save** | "Site saved: every device and camera of this workspace now uses these rooms"; Setup, Integrations shows ticks for workspaces, live channel and AI |
| Camera on this laptop | Cameras, Add a camera on this device, pick the room and **Start** | The camera shows "Live" in "Every camera in this workspace"; on the Live twin the room changes from "No data" to occupied or idle |
| Zones | On the camera, **Mark** the room floor, then each light; press **On** with the light on and **Off** with it off | "2 of 2 device zones ready"; switching the light changes the room's watts on the twin |
| Phone camera | Cameras, **Add a phone** next to a room, scan the QR code with the phone, tap **Use this phone's rear camera** | The phone's camera appears as Live on the laptop within seconds |
| Several cameras | Add a second camera to the same room (another phone or USB camera) | Both show Live; set "Cameras split the room" in Setup if each sees a different part |
| Leaving and coming back | Go to the Live twin, then back to Cameras; reload the page | Cameras keep sending; after a reload they start again by themselves |
| Alert and AI card | With a camera on a room, walk out and leave the light on; wait for the empty delay | A red "empty with power on" card with an AI recommendation (or a template without AI); Telegram gets the alert if set |
| Switch-off | Press the card's switch-off, then switch the light off by hand (or with your relay) | "Switch-off confirmed by camera" and the saving grows |
| Public view | Workspace menu, Public view QR, open it on a phone without signing in | The phone shows the live building; "Lights left on here?" raises a check on the twin |
| Reports | Reports, generate the report | The report includes the last 30 days of stored actions |
| Sensors | Setup shows the sensor key; post a reading as in docs/INTEGRATIONS.md | The room shows "sensor" as its source |

A second team can create its own workspace on the same address; neither sees the other's rooms, cameras or data.

## 9. Running on one computer without keys

```bash
npm install
```

```bash
npm run dev
```

Open `http://localhost:5173`. Without Supabase keys, the first page keeps the workspace in this browser only (its password hashed in the browser). Cameras work in tabs of the same browser and the twin computes everything; phones, Telegram, stored events and Set up with AI need the online version. To use the online features locally, copy `.env.example` to `.env`, fill in the same keys, and restart `npm run dev`; the dev server runs the same API as Vercel.

## 10. When something does not work

| Symptom | Cause and fix |
| --- | --- |
| Deploy fails | Check the build log; run `npm run build` locally first. Every commit should pass `npm test`, `npx tsc -b` and `npm run build`. |
| "This server has no workspace storage" and workspaces stay on one device | `SUPABASE_SERVICE_ROLE_KEY` or `WORKSPACE_SECRET` (at least 32 characters) is missing on Vercel; add it and redeploy. |
| `/api/health` says storage `down` | The Supabase project is paused (free plan, a week without use): resume it in Supabase. |
| Phones do not appear on the laptop | `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` were added after the last deploy: redeploy. Both devices must be in the same workspace. |
| Phone camera asks for permission every time | Use the `https://` address; browsers remember camera permission only on secure sites. |
| AI cards say they came from a template | No AI key, the provider's free quota is used up for now, or the AI's answer failed the number check; the template is the safe fallback. |
| Telegram stays quiet | The webhook was not registered, the chat id is not saved in Setup, or the bot is not in the group. |
| "Sign in to your workspace again" | Sessions last 30 days, and changing `WORKSPACE_SECRET` ends all of them: sign in again. |
