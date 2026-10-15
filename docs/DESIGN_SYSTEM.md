# Pratibimb Design System

Version 3.0 · Owner: Neev Pujari (UI) · Implemented in [`src/index.css`](../src/index.css)

Built with the ui-ux-designer skill (colour search "warm earthy sustainability", type search "warm friendly professional modern"), then adapted so status colours keep one meaning each.

## 1. Direction

**Warm, calm, trustworthy.** Ivory paper, ink-dark actions, one terracotta highlight. It should feel like a well-made instrument a facility manager trusts, not a gaming dashboard. Light is the default; a warm dark theme is one click away.

| Decision | Why |
| --- | --- |
| Warm light default (ivory `#FAF8F4`) | Readable on projectors and in bright offices; feels approachable to non-technical buyers |
| Primary buttons in ink (`#29241F`), not a colour | A coloured primary would compete with the status colours that carry meaning |
| Terracotta highlight (`#AD4F2B`, 4.6:1 or better on every light surface) for the logo, active nav, focus ring, charts | Warmth and identity without clashing with "waste" red |
| Serif headings (Fraunces), friendly sans for UI (Plus Jakarta Sans), mono for numbers (JetBrains Mono) | Editorial warmth; tabular digits stop live numbers from jittering |
| Status is never colour alone | Colour plus icon plus text; waste rooms are hatched; rooms without data are dashed |
| Cards: white, 12 px radius, soft warm shadow | Modern and quiet; the data stands out, not the chrome |

## 2. Tokens

Define in `src/index.css`. Components use Tailwind classes mapped to these tokens and never raw hex.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | `#FAF8F4` | `#1F1C19` | Page |
| `--surface` | `#FFFFFF` | `#29251F` | Cards |
| `--surface-2` | `#F2EDE4` | `#342F28` | Hover, inputs, plan background |
| `--border-c` | `#E4DCCF` | `#463F36` | Borders |
| `--text` | `#29241F` | `#F4EFE7` | Text |
| `--text-muted` | `#6B6259` | `#B5AA9C` | Labels (5.4:1 on light background) |
| `--brand` / `--on-brand` | `#29241F` / `#FAF8F4` | `#F4EFE7` / `#1F1C19` | Primary buttons |
| `--highlight` / `--on-highlight` | `#AD4F2B` / `#FFFFFF` | `#E0835E` / `#1F1C19` | Logo, active nav, focus, charts, heatmap |
| `--status-occupied` | `#12703A` | `#4ADE80` | People present |
| `--status-idle` | `#736A61` | `#8A8178` | Empty and off |
| `--status-waste` | `#C2342A` | `#F87171` | Empty but drawing power |
| `--status-warn` | `#955900` | `#FBBF24` | CO2 high, underused, stale |
| `--simulated` | `#7C5CC4` | `#B39DF0` | "Modelled" badge on what-if numbers |
| `--ai`, `--on-ai` | `#1D4ED8` on `#FFFFFF` | `#7CB2FF` on `#1F1C19` | The one cool colour, kept for AI actions (Set up with AI) so they stand out among warm controls; contrast 6.7:1 and 7.8:1 |

| Other | Value |
| --- | --- |
| Fonts | Fraunces 500/600 (headings), Plus Jakarta Sans 400-700 (UI), JetBrains Mono 400-600 (numbers, ids) |
| Radius | `--radius` 12 px; sm 6, lg 18, xl 24 |
| Shadow | `--shadow-card`: 1 px hairline plus a soft 24 px warm drop |
| Motion | 150 ms hover, 250 ms status change, 2 s waste pulse; everything off under `prefers-reduced-motion` |

## 3. Status language

| Status | Colour | Icon (lucide) | Label | Floor plan |
| --- | --- | --- | --- | --- |
| Occupied | `--status-occupied` | `Users` | "Occupied" | solid 28 % |
| Idle | `--status-idle` | `Moon` | "Empty, off" | solid 12 % |
| Waste | `--status-waste` | `Zap` | "Empty, wasting" | 28 % + diagonal hatch + slow border pulse |
| No data | `--text-muted` | `CircleDashed` | "No data" | dashed border, 12 % |
| Modelled | `--simulated` | `FlaskConical` | "Modelled" badge | Scenario Lab only |

Input badges on a room: `ScanEye` Camera, `Gauge` Sensor, `Hand` Staff report, all in the highlight colour.

## 4. App shell and screens

**Shell.** A left sidebar groups the screens by job: Monitor, Analyse, Connect, Settings. Below 1280 px it starts collapsed to icons; on phones it becomes a bottom tab bar with the five most used screens. The top bar holds breadcrumbs, the live status (time of the last reading, "Stale" after 15 minutes), the alerts bell (only unacknowledged alerts count), the Assistant, the workspace menu and the theme switch. Ctrl+K opens a command palette for rooms, pages and actions.

| Group | Screen | Path | Layout |
| --- | --- | --- | --- |
| Monitor | Overview | `/` | Building health score with what moves it; power, cost per hour, waste and saved; today's three actions; the "Get your building live" checklist; a live mini 3D view |
| Monitor | Building 3D | `/building` (`?fs=1` full screen) | The 3D twin (section 4.1) |
| Monitor | Rooms | `/rooms`, `/room/:id` | Table or grid with search and filters, status (including "Emptying, n s"), people, watts, inputs and camera coverage; the room page has its tiles, devices, cameras, CO2 and staff reports |
| Monitor | Alerts | `/alerts` | Open, acknowledged and resolved, each with its evidence and fix |
| Analyse | Scenario Lab | `/lab` | Policies, savings ranges, business case, solar, observed utilization; every result labelled Modelled |
| Analyse | Reports | `/reports` | Audit report, Download PDF, activity log with CSV |
| Analyse | Trends | `/trends` | Day, week and month history from the server's hourly roll-up |
| Connect | Cameras | `/camera` | Camera station, zones, auto-find, health, privacy inspector |
| Connect | Connections | `/connections` | One card per input or output with a status light and its set-up link; the plug and entity list per room |
| Connect | Connection doctor | `/connections/doctor` | Every check with what failed and the fix |
| Settings | Site | `/settings/site` | Site and money, hours, floors, rooms, devices, import and export, with a sticky save bar |
| Settings | Keys and AI | `/settings/keys` | One card per provider and service: where to get the key, Save, Test, last four characters; which AI handles chat, reports, photos and voice |
| Settings | Team | `/settings/team` | Invite links by role, signed-in devices, password, export and delete |
| | Public view | `/live` | Phone layout for visitors, no sign-in |

Viewers see every screen but write actions are disabled with the reason in the tooltip.

### 4.1 The 3D twin

- **A building, not a stack of plates.** By default the model shows the facade (glass bands, mullions, spandrels), columns, the roof with its parapet and AC condensers, and the entrance canopy, standing on paving and lawn with trees, a path, parking and benches.
- **Cutaway (K)** lifts the facade and roof to show the rooms; picking one floor, exploding the floors or walking in does the same.
- **Inside**, each room has its own wall and floor colour and furniture laid out for its type; devices show their live state (lit lights, turning fans, split ACs); the live status tints each room's floor, and labels carry an icon and text.
- **Natural colours** (grass, trees, glass, wood) are blended into the page background, so they sit quietly in both themes and never compete with the status colours.
- **Edit** works on a draft with Undo; nothing is stored until Save. The AI designer proposes a list of changes the person ticks before they apply.
- Only the top floor's labels show while the facade is on, plus any room wasting power, so labels never float through the roof.

## 5. Component rules

- Every data panel has four states: loading (skeleton the shape of the content), empty (a sentence and the next step), error (what failed and Retry), success.
- Unknown is a state, not zero: show "No input", "Not observed" or "No data", never a made-up number.
- Buttons: 44 px touch targets on the public view; visible focus ring in the highlight colour; icon-only buttons have `aria-label` and a tooltip.
- Switches and inputs always have a label or `aria-label`.
- Live numbers use one `role="status"` region per panel with a sentence, not a bare number.
- Charts: legends, axis units, tooltips; dashed vs solid lines so colour is never the only difference; a table with the same numbers.

## 6. Mapping onto shadcn/ui

| shadcn variable | Our token |
| --- | --- |
| `--background` / `--foreground` | `--bg` / `--text` |
| `--card`, `--popover` | `--surface` |
| `--primary` / `--primary-foreground` | `--brand` / `--on-brand` |
| `--secondary`, `--muted`, `--accent`, `--input` | `--surface-2` |
| `--muted-foreground` | `--text-muted` |
| `--border` | `--border-c` |
| `--ring`, `--chart-1` | `--highlight` |
| `--chart-2`, `--chart-3`, `--chart-4`, `--chart-5` | `--text-muted`, `--status-occupied`, `--status-warn`, `--simulated` |
| `--destructive` | `--status-waste` |

Dark mode is the `.dark` class on `<html>`, stored in `localStorage` as `theme`.

## 7. Pre-delivery checklist

- [ ] No emojis; icons from lucide-react only
- [ ] Text contrast 4.5:1 in both themes
- [ ] Status shown by colour plus icon plus text
- [ ] Unknown values say so; nothing invented
- [ ] Focus visible on every interactive element; keyboard reaches every control
- [ ] `prefers-reduced-motion` respected
- [ ] Every page checked at 375 px and 1280 px with no sideways scrolling
- [ ] Loading, empty, error and success states on every data panel
