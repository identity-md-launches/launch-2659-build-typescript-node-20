# DESIGN.md: Squeekchain settlement latency dashboard

Source of truth: `web/src/styles.css` (tokens and every component class), `web/src/App.tsx` (markup and components), `web/index.html` (meta, favicon) and `web/public/` (favicon.svg, og.png). The values below are taken from those files.

## Overview

This is an operator's dashboard for people watching Squeekchain settlement on Sepolia. It's calm, light and dense, and it reads like a status page rather than a marketing site.

The page has one job: say whether settlement is keeping up, and point to the alerts that explain why not. The status panel comes first and carries the verdict, four metrics and the one primary action ("Review N alerts"). Everything after it is evidence, in order of importance: alerts, latency chart, daily table, downloads, deployment checks, then a footer with the pinned block.

A new page should reuse the panel, section, list and table patterns below. It shouldn't add new surfaces.

## Colors

All colors are CSS custom properties on `:root` in `web/src/styles.css`, written in hex.

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#f6f6f3` | Page background (also `theme-color`) |
| `--surface` | `#ffffff` | Buttons, inputs, chart, table, neutral panels |
| `--ink` | `#1b1e22` | Primary text |
| `--ink-muted` | `#545b64` | Labels, captions, meta, footer |
| `--line` | `#d9dbd6` | Hairline borders and dividers |
| `--accent` | `#1d4f91` | Links, primary button, selected segment, `details` summary. Hover `#173f75` (literal in `.button-primary:hover`). |
| `--accent-ink` | `#ffffff` | Text on accent |
| `--focus` | `#1d4f91` | Focus ring |
| `--info-bg` / `--info-ink` | `#e9f0f8` / `#1d4f91` | Info badge, passed check |
| `--warning-bg` / `--warning-ink` | `#fdf1dc` / `#7a4300` | Warning badge, warning status panel, empty-day table rows. Panel border `#efd3a4`. |
| `--critical-bg` / `--critical-ink` | `#fbe9e8` / `#9b1c1c` | Critical badge, critical panel and error notice (border `#efc2bf`), chart threshold line |
| `--bar` / `--bar-over` | `#8aa6c8` / `#c2410c` | Chart bars under / over the latency threshold |

Status always pairs color with words: badges say "Critical", "Warning" or "Info", and the panel headline states the condition. The design probe measured all rendered text at 4.5:1 or better. Contrast for hover states wasn't measured separately.

## Typography

- **Families:**
  - `--font`: `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. No web fonts are loaded.
  - `--mono`: `ui-monospace, "SF Mono", Menlo, Consolas, monospace`, used only for `code` (file names, hashes).
- **Weights:** 400 (body), 600 (labels, buttons, badges, table headers), 650 (headings, metric values).
- **Scale (five sizes):**

  | Token | Size | Role |
  | --- | --- | --- |
  | `--text-sm` | 13px | Meta, captions, labels, tables |
  | `--text-md` | 15px | Body text, line-height 1.5 |
  | `--text-lg` | 18px | Section headings, `h1` and metric values on mobile |
  | `--text-xl` | 24px | Status headline on mobile; `h1` and metric values from 48rem |
  | `--text-2xl` | 28px | Status headline from 48rem |

- **Text treatment:**
  - Headings use line-height 1.25 and `text-wrap: balance`; paragraphs use `text-wrap: pretty`.
  - `font-variant-numeric: tabular-nums` is set on `body` so figures line up and don't shift on reload.
  - No letter-spacing, no all-caps, no labels above headings.
  - Alert codes show as sentence-case labels (`ALERT_LABELS` in `web/src/format.ts`).
  - Copy uses no em dashes or emoji.

## Layout

- **Spacing scale:** `--space-1` to `--space-8` = 4, 8, 12, 16, 24, 32px.
- **Content width:** `.wrap` caps it at `--max: 64rem`, centred, with 16px side padding (24px from 48rem).
- **Vertical rhythm:** sections are 32px apart (`.section { margin-top: var(--space-8) }`), and headings sit 12px above their content.
- **One breakpoint, `min-width: 48rem`:**
  - The metrics grid goes from 2 to 4 columns.
  - Status padding goes from 16 to 24px.
  - The `h1` grows from 18 to 24px and the lede from 13 to 15px.
  - The status headline grows from 24 to 28px.
- **Header:** a flex row with the title block on the left and "Reload data" on the right; it was checked side by side at 390 and 1440 wide.
- **Wrapping:**
  - Filters wrap (`flex-wrap`).
  - Alert heads wrap, with the time pushed right using `margin-left: auto`.
  - Long hashes and messages break with `overflow-wrap: anywhere`.
  - The daily table never widens the page: it scrolls inside `.table-scroll`.
- **Verified:** no horizontal scroll at 320, 390 or 1440 (probe and Playwright). At 390 the headline, status, metrics and primary action fit in the first 844px.

## Elevation & Depth

The design is deliberately flat. There are no shadows. Depth comes from tone and hairlines: white surfaces on the off-white page, 1px `--line` borders, and tinted status panels. The only stacking is the skip link (`z-index: 1`).

## Shapes

- `--radius` 10px: status panel and notices.
- `--radius-sm` 6px: buttons, select, segmented control ends, chart and table frames.
- 999px: badges.

Borders are always 1px solid.

## Components

All components are in `web/src/App.tsx`, with classes in `web/src/styles.css`.

- **Button** (`.button`, `.button-primary`):
  - Used on `<button>` and `<a>`.
  - At least 44px tall, 600 weight, `white-space: nowrap`.
  - Neutral style is a white surface with a hairline border; hover darkens the border.
  - Primary uses the accent fill and is reserved for the one main action per screen ("Review N alerts").
  - Transitions cover background and border color only (120ms) and are removed under `prefers-reduced-motion`.
- **Status panel** (`.status`, `.status-info|warning|critical`):
  - Verdict `h2`, one sentence, a `dl.metrics` of `Metric` items (`dt` label 13px muted, `dd` value 18 or 24px at 650 weight), then the primary action.
  - The tone comes from the data: critical if paused or checks failed, warning if behind threshold, otherwise neutral.
- **Section** (`.section`): an `h2` at 18px, then content. Intro paragraphs inside a section are muted.
- **Filters:**
  - `.field` is a label wrapped around a native `select` (44px tall, min 14rem wide).
  - `.segmented` is a `fieldset` and `legend` around native radios. The radios are visually hidden but stay clickable and focusable; the checked segment uses the accent fill, and focus shows a ring on the visible segment.
  - Changing a filter resets paging, and the result count is announced through `role="status"`.
- **Alert row** (`ol.alerts > li.alert`):
  - Hairline-separated rows, not cards.
  - The head holds a badge, the label (raw code in `title`) and a UTC `time`. Below it are the message and a meta line linking the block and transaction on Blockscout.
  - Paged 15 at a time with a "Show N more" button.
  - The empty state says "No alerts match these filters."
- **Badge** (`.badge-info|warning|critical`): a sentence-case word on a tinted pill, 13px at 600 weight.
- **Latency chart** (`figure.chart`):
  - An SVG with `viewBox 0 0 100 100` and `preserveAspectRatio="none"`, 10rem tall, on a white framed surface.
  - The y axis is log scale. Bars over the threshold use `--bar-over`, and a dashed threshold line is drawn in `--critical-ink`.
  - The `figcaption` carries the numbers, and the SVG is `role="img"`, labelled by that caption.
- **Data table** (`.table-scroll > table`):
  - Framed and scrollable (it can take focus as a `role="region"`).
  - Text is 13px and right-aligned, except for the first column, which is a row header.
  - Days with no settlements are tinted warning.
- **Downloads** (`ul.files`): each item is a neutral button with the `download` attribute plus a muted note.
- **Disclosure** (`details.checks`): a native `summary` (44px, accent) that opens a list of pass/fail badges.
- **Notice** (`.notice`, `.notice-critical`):
  - Loading uses `role="status"`; the load error uses `role="alert"`, with the commands to fix it.
- **Footer** (`.foot`): 13px muted text, with a hairline above. It shows the pinned block, hash, replay range and the read-only statement.
- **Skip link** (`.skip`): sits off-screen until it receives focus, then appears in the top-left corner.

## Do's and Don'ts

**Do:**

- Lead with the verdict and one primary action.
- Keep numbers in `tabular-nums`.
- Pair every color state with words.
- Use 44px controls.
- Keep wide data inside its own scroll region.

**Don't:**

- Add shadows, nested cards, gradient text or all-caps labels.
- Add a second accent color or a sixth type size.
- Use monospace for prose.
- Show raw alert codes as headings.
