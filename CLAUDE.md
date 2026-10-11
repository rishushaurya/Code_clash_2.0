# Instructions for AI coding assistants

Project: **Pratibimb**, a green-building digital twin for any building, built for Code Clash 2.0 (PS04) and developed as a product. Judges review this repository on GitHub.

## Read first, in this order

1. `README.md` for what the project is.
2. `CHANGELOG.md`, last entry, for what was done and what to do next.
3. `docs/BUILD_SPEC.md` for contracts, folder ownership and acceptance checks. This is the source of truth.
4. `docs/DESIGN_SYSTEM.md` before touching any UI.
5. `docs/INTEGRATIONS.md` before touching inputs, outputs or the site file; `docs/DEPLOY.md` before touching hosting, keys or the API router.
6. `docs/RESEARCH_MASTER_PLAN.md` only when you need the reasoning behind a decision.

## Hard rules

1. **Real data only.** Never add demo, placeholder or invented data to the app. Unknown is shown as unknown; modelled numbers are labelled "Modelled". No site-specific hardcoding: buildings, currency, tariff and languages come from the customer's site settings.
2. **Keep it green.** `npm test`, `npx tsc -b` and `npm run build` pass before every commit.
3. **Stay in your module's folder** (BUILD_SPEC section 3). Never edit `src/shared/` outside a gate; propose the change instead.
4. **Code computes every number; the AI only writes words.** No energy, money or CO2 maths in UI components or prompts. Use `src/twin/energy.ts` and `src/sim/`.
5. **Only numbers leave a camera.** Never upload, store or log a frame.
6. **Secrets only in environment variables.** Never in code, prompts or commits. Client code sees only `VITE_` variables, which must be public-safe.
7. **Label modelled numbers** in the UI with the "Modelled" badge.
8. **No emojis** anywhere: UI, Telegram messages, AI output, commits. Icons from `lucide-react`.
9. **Check current docs** for library and API usage (MediaPipe, Supabase, Open-Meteo, Groq, Gemini, Telegram). Do not guess APIs; search the web before building anything that may already exist.
10. **Simplest thing that works.** No abstraction with one user, no config for a value that never changes, no new dependency for a few lines of code. Prefer native browser APIs and installed libraries.
11. **Run it before you commit it.** Open the screen you changed with `npm run dev`; each module's check is in BUILD_SPEC section 8.
12. **Small commits, Conventional Commit messages** (`feat(cv): ...`, `fix(twin): ...`), each member commits their own folders.

## After every session

Add an entry to `CHANGELOG.md`: what changed, files touched, known issues, and a **Next** line saying exactly what to do next.

## Skills to use (Claude Code)

The team asked for these on every session of this project:

| Skill | When |
| --- | --- |
| `seniordev` | Every coding task: the lazy ladder (native API, then installed library, then minimum code) |
| `cleancode` | Every coding task: state assumptions, surgical changes, a runnable check for non-trivial logic |
| `ui-ux-designer` | Any UI work: search its guidance and follow `docs/DESIGN_SYSTEM.md` |
| `less-token` | Chat replies only. Code, comments, commits and docs stay in plain full sentences |
