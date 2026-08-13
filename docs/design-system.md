# Design System — "Lustra" direction (Head Office ERP)

Visual language for the ERP UI, distilled from the reference mockups. Warm,
premium, airy, pastel-accented, heavily rounded, light theme. We build **original**
components in this style — and our **own** logo/wordmark (the reference is a
third-party jewellery dashboard concept, used only as visual direction).

Colors below were sampled directly from the mockups, not eyeballed.

---

## 1. Color tokens

```css
:root {
  /* ---- Neutrals (warm) ---- */
  --bg:            #F6F4EF;  /* app canvas — warm off-white          */
  --bg-cool:       #EEEFEF;  /* alt cool-grey panel background        */
  --surface:       #FFFFFF;  /* cards                                 */
  --surface-cream: #F7F2E8;  /* warm cream card variant               */
  --panel-muted:   #F1EEE9;  /* muted inner panels                    */
  --border:        #EAE5DD;  /* hairline borders (warm)               */
  --text:          #141414;  /* primary text (near-black)             */
  --text-muted:    #857C72;  /* secondary text (warm grey)            */
  --text-hint:     #B4ABA0;  /* tertiary / placeholders               */

  /* ---- Pastel accents (data + color-coding) ---- */
  --salmon:        #EBA98F;  --salmon-strong:     #E1876B;  /* PRIMARY brand accent */
  --amber:         #EFD0A6;  --amber-strong:      #E4B47E;
  --lavender:      #D2B9EA;  --lavender-strong:   #B693DD;
  --periwinkle:    #A6C0E6;  --periwinkle-strong: #7FA3DC;
  --pink:          #EDA6D0;  --pink-strong:       #E07FBE;
  --cream-accent:  #F4E8CA;

  /* ---- Semantic ---- */
  --success:       #7FC489;  --success-bg: #E9F6EC;
  --warning:       #E4B47E;  --warning-bg: #FBF1E1;
  --danger:        #E5786B;  --danger-bg:  #FCEAE7;
  --info:          #7FA3DC;  --info-bg:    #EAF0FB;

  /* ---- Buttons ---- */
  --btn-primary-bg:  #17140F;  --btn-primary-fg: #FFFFFF;  /* dark pill CTA */
  --btn-accent-bg:   #E1876B;  --btn-accent-fg:  #FFFFFF;  /* salmon accent CTA */

  /* ---- Shape ---- */
  --r-card: 22px;  --r-md: 14px;  --r-sm: 10px;  --r-pill: 999px;

  /* ---- Elevation (very soft) ---- */
  --shadow-sm:   0 2px 8px  rgba(20,16,12,0.04);
  --shadow-card: 0 10px 30px rgba(20,16,12,0.05);
}
```

**Note on buttons:** in the reference, the main call-to-action is a **near-black pill**;
**salmon** is the brand/accent/data color, not the default button. Keep that split.

**Card color-coding** — tint metric cards with the *soft* accent as the fill and use
near-black text on top (e.g. Fabric = amber, Thread = lavender, Zip = periwinkle,
Sticker = pink, Packing = salmon). Consistent color-per-thing across the app.

---

## 2. Typography

- **Primary family:** **Plus Jakarta Sans** (geometric-humanist, rounded, premium — free on Google Fonts). Fallback **Inter** for data-dense tables.
- **Display / wordmark / card titles:** 600–700 weight.
- **Body / UI:** 400–500.
- **Labels / eyebrows:** 500, small (11–12px), muted; section eyebrows may be UPPERCASE with `letter-spacing: .06em`.
- **Numbers in tables:** tabular figures (`font-variant-numeric: tabular-nums`).

---

## 3. Shape, spacing, motion

- **Radius:** cards `--r-card` (22px), inputs/inner `--r-md`, chips/pills fully round, icon chips circular.
- **Spacing:** 4px base scale; airy. Card padding 20–24px; grid gap 16–24px.
- **Shadows:** soft, low-opacity, large blur (see tokens). No hard/dark shadows.
- **Motion:** gentle — 150–200ms ease on hover/expand; subtle scale on card hover.

---

## 4. Signature motifs (the things that make it "Lustra")

1. **Radial tick gauge** — a circular score dial built from many thin colored ticks (the "87 Inventory Score"). Use for an overall health/coverage score.
2. **Linear tick ruler with colored bands** — a horizontal ruler with labelled ranges (Weak / Moderate / Good / Impressive) and a marker ("74 First-rate"). Bands underlined in the accent colors.
3. **Segmented gradient pipeline bar** — thin vertical ticks fading amber → blue → purple → pink across stages (Lead → Working → Qualified → Converted).
4. **Dot-matrix heatmap** — a time series drawn as a grid of dots with an opacity ramp (purple), months on the x-axis.
5. **Pastel metric cards** — tinted fill, a **black circular icon chip** top-left, an expand arrow top-right, a big value, and a small `+%` delta chip.
6. **Colored work-queue tiles** — a left column of pastel list cards, each with a number badge, a status/flame icon, an avatar, name + subtitle.
7. **Black circular icon chips** as section/card headers throughout.
8. **Pill tabs & filters** — active = dark filled pill; inactive = light. Rounded filter pills with a search glyph.
9. **Detail cards** — small circular icon rows (label + value): stock, phone, email, source, etc.

---

## 5. Layout

- **Top bar:** wordmark left · tab nav (Sell / History / Reporting / Products / Customers / Ecommerce → *ours:* Dashboard / Inventory / Production / Employees / Reports / Admin) · search + notifications + avatar right.
- **Left column:** a "Work Queue"-style panel (→ *ours:* Pending Approvals / Active Production Orders) with colored tiles + quick filters.
- **Main:** responsive grid of cards (detail card, history/timeline card, activity card, sales/consumption chart, radial gauge, today's figures).
- **Responsive:** desktop/laptop first (dense tables), tablet supported, mobile shows the same style in stacked colored cards (as in the phone mockups).

---

## 6. How the theme maps to *our* ERP

| Reference element | Our ERP use |
|---|---|
| Pastel metric cards | Total Raw-Material Value · Fabric / Thread / Zip / Sticker / Packing stock · Low-Stock · Today's Receipts / Issues · WIP · Pending Approvals · Employee Production Today |
| Radial tick gauge | Overall inventory health / stock-coverage score |
| Linear ruler bands | Stock level vs min / reorder / healthy — or production-order progress |
| Dot-matrix heatmap | Material consumption / production output over months |
| Work-queue tiles | Pending approvals (GRNs, issues, rate changes) or active production orders, color-coded by type/urgency |
| Detail card w/ icon rows | Material detail (balance, rate, supplier, batch) · employee detail |
| Color-per-thing | One accent per raw-material group, used consistently everywhere |

---

## 7. Build notes

- **Stack:** Next.js + Tailwind + shadcn/ui. Put these tokens in `globals.css` `:root` and mirror them in `tailwind.config` (`theme.extend.colors`, `borderRadius`, `boxShadow`).
- **Gauges / ruler / dot-matrix** are custom SVG components (no heavy chart lib needed for these; a light lib is fine for standard bar/line charts).
- **Icons:** lucide-react for line icons; the black circular chip is a wrapper (`rounded-full bg-[#141414] text-white p-2`).
- **Our identity:** design an original wordmark + mark for the ERP — do **not** reuse the reference's name or ring logo.
