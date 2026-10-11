# Pratibimb Design System

Version 2.0 · Owner: Neev Pujari (UI) · Implemented in [`src/index.css`](../src/index.css)

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

## 4. Screens

| Screen | Path | Layout |
| --- | --- | --- |
| Live Twin | `/` | Metric strip (power, cost per hour, session energy, saved); floor plan with a floor switcher, 3D view and time-travel slider; alert feed with AI cards; energy Sankey; Copilot; Patterns; Energy League with shout-out. With no site: one card leading to Setup; with no live input: the "Bring the building to life" guide |
| Room | `/room/:id` | Status and input badges; four tiles (people, power, cost, CO2), each saying "No input" honestly when unknown; device table with On, Off and Not observed; camera zones; staff report buttons; CO2 chart; cameras card with QR and each camera's live status; AI Surveyor |
| Scenario Lab | `/lab` | Policy cards and run button; savings range tiles; business case (payback and EPI); baseline vs policy chart with p10-p90 bands; per-room table; rooftop solar from measured sunshine; observed utilization heatmap |
| Reports | `/reports` | Generate, then a printable audit report; "Download PDF" prints it; activity log with filters and CSV download |
| Setup | `/setup` | Site and money; automatic switch-off; opening hours (with observed suggestion); integrations status; floors; rooms with template buttons, device counts and exemptions; device ratings; import, export, save |
| Camera | `/camera/:room` | Source picker; live view with blurred faces; device zones (lights, fans, screens); privacy inspector |
| Public view | `/live` | Phone layout: featured room with a "Lights left on here?" button, building totals, live power line, compact plan; works on any phone with no setup |

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
