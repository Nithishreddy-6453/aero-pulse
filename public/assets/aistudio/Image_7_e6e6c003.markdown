---
name: Atmospheric Intelligence Daylight
colors:
  surface: '#faf8ff'
  surface-dim: '#d2d9f4'
  surface-bright: '#faf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f3ff'
  surface-container: '#eaedff'
  surface-container-high: '#e2e7ff'
  surface-container-highest: '#dae2fd'
  on-surface: '#131b2e'
  on-surface-variant: '#3d4a42'
  inverse-surface: '#283044'
  inverse-on-surface: '#eef0ff'
  outline: '#6d7a72'
  outline-variant: '#bccac0'
  surface-tint: '#006c4a'
  primary: '#006948'
  on-primary: '#ffffff'
  primary-container: '#00855d'
  on-primary-container: '#f5fff7'
  inverse-primary: '#68dba9'
  secondary: '#904d00'
  on-secondary: '#ffffff'
  secondary-container: '#fe932c'
  on-secondary-container: '#663500'
  tertiary: '#bb0112'
  on-tertiary: '#ffffff'
  tertiary-container: '#e02928'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#85f8c4'
  primary-fixed-dim: '#68dba9'
  on-primary-fixed: '#002114'
  on-primary-fixed-variant: '#005137'
  secondary-fixed: '#ffdcc3'
  secondary-fixed-dim: '#ffb77d'
  on-secondary-fixed: '#2f1500'
  on-secondary-fixed-variant: '#6e3900'
  tertiary-fixed: '#ffdad6'
  tertiary-fixed-dim: '#ffb4ab'
  on-tertiary-fixed: '#410002'
  on-tertiary-fixed-variant: '#93000b'
  background: '#faf8ff'
  on-background: '#131b2e'
  surface-variant: '#dae2fd'
  surface-canvas: '#f8fafc'
  surface-card: '#ffffff'
  surface-subtle: '#f1f5f9'
  border-subtle: '#e2e8f0'
  border-strong: '#cbd5e1'
  text-heading: '#0f172a'
  text-subheading: '#1e293b'
  text-body: '#475569'
  text-muted: '#64748b'
  emerald-vibrant: '#10b981'
  emerald-tint: '#ecfdf5'
  amber-tint: '#fffbeb'
  crimson-vibrant: '#ef4444'
  crimson-tint: '#fef2f2'
typography:
  display-hero:
    fontFamily: Plus Jakarta Sans
    fontSize: 56px
    fontWeight: '700'
    lineHeight: 64px
    letterSpacing: -0.03em
  display-hero-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 38px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  metric-huge:
    fontFamily: Plus Jakarta Sans
    fontSize: 64px
    fontWeight: '800'
    lineHeight: 64px
    letterSpacing: -0.04em
  metric-huge-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 44px
    fontWeight: '800'
    lineHeight: 48px
    letterSpacing: -0.03em
  metric-sub:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: 0em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: 0em
  label-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-desktop: 1.5rem
  margin: 1rem
  margin-tablet: 2rem
  margin-desktop: 3rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system translates critical atmospheric intelligence and environmental monitoring into an exacting, high-clarity daylight interface. Designed for environmental scientists, athletic directors, healthcare professionals, and health-focused individuals, it balances scientific rigor with effortless legibility. 

The aesthetic is grounded in **precision data minimalism** paired with **crisp light-surface structural framing**. By stripping away murky dark canvases in favor of bright, low-strain slates and pure white containers, visual hierarchy is driven by crisp borders, tonal separation, and targeted spectral alerts. The interface conveys clinical authority, scientific confidence, and calm reliability under standard environmental readings, while commanding immediate focus during hazardous spikes.

## Colors

The daylight palette shifts from self-illuminating neon hues to saturated, high-contrast inks resting on balanced, low-glare surfaces.

- **Primary (`#059669` / `#10b981` — Pure Emerald):** Encodes optimal atmospheric metrics, nominal AQI tiers (0–50), and verified safe ventilation thresholds.
- **Secondary (`#d97706` — Amber Advisory):** Communicates moderate air spikes, sensitive-group advisories, and elevated pollen counts.
- **Tertiary (`#dc2626` / `#ef4444` — High-Visibility Crimson):** Strictly signals dangerous atmospheric density, hazardous particulate levels (AQI 151+), and mandatory health interventions.
- **Neutral (`#0f172a` — Deep Ink Slate):** Provides high-contrast readability across headlines and core telemetry values.

### Surface and Structure Architecture
- **Canvas Base:** `#f8fafc` acts as a calm, cool-tinted ground plane that minimizes screen glare.
- **Card Containers:** `#ffffff` creates distinct component boundaries when set against the canvas.
- **Sub-surface Fill:** `#f1f5f9` defines secondary data tables, nested module wells, and inactive control tracks.
- **Borders & Separators:** `#e2e8f0` provides 1px architectural definition without visual noise; `#cbd5e1` handles interactive edges and focused fields.
- **Alert Containers:** Soft tints (`#ecfdf5`, `#fffbeb`, `#fef2f2`) encase badges and callouts, guaranteeing WCAG AAA legibility for saturated dark-variant text.

## Typography

The typography system pairs the geometric clarity of **Plus Jakarta Sans** with the dense, utilitarian legibility of **Inter**. 

### Application Rules
- Apply `tabular-nums` via `font-variant-numeric: tabular-nums` to all telemetry feeds, continuous time stamps, and variable numeric outputs to eliminate horizontal layout jitter during real-time data streaming.
- Reserve `metric-huge` strictly for primary sensor readouts (such as overall AQI or peak PM2.5). Always baseline-align with an adjacent `label-sm` or `metric-sub` for standard physical units (e.g., `PPM`, `μg/m³`).
- Apply `uppercase` tracking (`letterSpacing: 0.05em`) with `label-sm` when defining atmospheric layer tabs, risk matrix badges, and column headers in environmental data tables.
- Primary and secondary headings utilize `#0f172a` and `#1e293b`. Running explanations and analytical breakdowns transition to `#475569` to ensure optical balance across high-density layouts.

## Layout & Spacing

The layout operates on a flexible, responsive 12-column structural grid for desktop environments, an 8-column configuration for tablet workstations, and a 4-column layout for mobile interfaces.

### Breakpoints & Screen Reflow
- **Desktop (1024px and above):** 12 columns with `1.5rem` gutters and a maximum canvas width of 1440px centered with `3rem` margins. Primary monitoring telemetry spans 8 columns, while actionable environmental checklists and active alerts hold the remaining 4 columns.
- **Tablet (768px – 1023px):** 8 columns with `1.25rem` gutters and `2rem` margins. Telemetry gauges reflow into symmetrical 4x4 module pairs.
- **Mobile (below 768px):** 4 columns with `1rem` margins and `1rem` gutters. Metric cards, hazard badges, and actionable directives stack into a single column.

### Internal Spacing Rhythm
- Use `space-xs` (4px) for inline gap pairings between sensor icons and text indicators.
- Use `space-sm` (8px) for card headers, input label attachments, and metric pill margins.
- Use `space-md` (16px) for standard widget padding, internal form containers, and sensor list gaps.
- Use `space-lg` (24px) for padding primary dashboard card modules, hero metrics, and modal interiors.
- Use `space-xl` (40px) to separate logical dashboard sections and multi-station comparison grids.

## Elevation & Depth

Visual hierarchy uses crisp boundary containment, subtle surface tonal steps, and delicate, low-opacity ambient shadows rather than deep, murky drops:

- **Level 0 (Canvas Base):** Solid `#f8fafc`. All cards and modules sit directly upon this non-reflective ground plane.
- **Level 1 (Card & Module Layer):** Solid `#ffffff` surface paired with a hairline border (`1px solid #e2e8f0`) and an ambient, low-contrast shadow: `0 1px 3px 0 rgba(15, 23, 42, 0.05), 0 1px 2px -1px rgba(15, 23, 42, 0.05)`.
- **Level 2 (Interactive Hover & Flyout Panels):** Surface remains `#ffffff`, with border elevating to `#cbd5e1` and shadow expanding to `0 10px 15px -3px rgba(15, 23, 42, 0.06), 0 4px 6px -4px rgba(15, 23, 42, 0.03)`.
- **Level 3 (Modals, Overlays, & Critical Hazard Banners):** Elevated above the workspace using high-contrast borders and atmospheric tinted drop shadows:
  - Nominal Safe State: `0 20px 25px -5px rgba(5, 150, 105, 0.08), 0 8px 10px -6px rgba(15, 23, 42, 0.04)`.
  - Alert State: `0 20px 25px -5px rgba(220, 38, 38, 0.12), 0 8px 10px -6px rgba(15, 23, 42, 0.04)`.
- **Wells and Inset Containers:** Nested telemetry feeds, sparkline containers, and code readouts utilize `#f1f5f9` with an optional `inset 0 1px 2px rgba(15, 23, 42, 0.04)` to convey physical grounding.

## Shapes

The design system implements a **Rounded (`2`)** structural geometry, delivering crisp technical precision balanced with approachable consumer health aesthetics:

- **Micro Controls & Inputs (`0.5rem` / 8px):** Checkboxes, form fields, action buttons, select dropdowns, and tabular action cells.
- **Telemetry Panels & Cards (`1rem` / 16px):** Metric displays, diagnostic graphs, daily health advisory blocks, and secondary data widgets.
- **Hero & Urgent Alert Shells (`1.5rem` / 24px):** Primary AQI readout containers, regional overview banners, and floating emergency notification sheets.
- **Pills (`9999px`):** Atmospheric particulate tags (`PM2.5`, `O3`, `NO2`), operational status chips, and tabbed filter pills.

## Components

### Buttons
- **Primary Action:** Solid `#059669` fill with pure `#ffffff` text, font weight 600, border radius `0.5rem`. Hover state transitions to `#047857`; active state scales subtly to `0.98`.
- **Hazard / Urgent Action:** Solid `#dc2626` background, `#ffffff` text. Used for reporting acute contamination or initiating emergency ventilation protocols. Hover state transitions to `#b91c1c`.
- **Secondary / Neutral:** Crisp `#ffffff` fill with a `1px solid #e2e8f0` border and `#0f172a` text. Hover shifts background to `#f8fafc` and border to `#cbd5e1`.
- **Ghost:** Transparent fill, text `#475569`. Hover state applies `#f1f5f9` with text intensifying to `#0f172a`.

### Status Badges & Chips
- Fully rounded (`9999px`) metadata containers with internal padding of `0.25rem` vertical and `0.625rem` horizontal.
- **Optimal (Safe):** Background `#ecfdf5`, text `#065f46`, border `1px solid #a7f3d0`.
- **Advisory (Warning):** Background `#fffbeb`, text `#92400e`, border `1px solid #fde68a`.
- **Hazard (Alert):** Background `#fef2f2`, text `#991b1b`, border `1px solid #fecaca`. Includes an optional pulsating 6px crimson indicator dot.

### Telemetry Cards
- Constructed with a pure `#ffffff` surface, bounded by `1px solid #e2e8f0`, and padded with `space-lg`.
- Top row aligns the metric name (`label-sm`, `#64748b`) with an contextual status chip. The center is dominated by `metric-huge` in `#0f172a`, baseline-paired with physical units in `label-md`. The bottom container anchors a 24-hour comparative sparkline resting on a `#f8fafc` well.

### Checklists & Action Directives
- Action cards feature a `#ffffff` surface with a `1px solid #e2e8f0` border, designed for immediate health directives (e.g., "Engage cleanroom air handlers", "Limit outdoor exertion").
- Checkbox elements are `20x20px` with a `0.25rem` radius and a `1.5px solid #cbd5e1` outline against a `#f8fafc` background. When checked, the element transitions to solid `#059669`, presents a crisp white check vector, and applies a strike-through with `#64748b` coloration to the adjacent label.

### Input Fields
- Inputs feature a `#ffffff` background, `1px solid #cbd5e1` border, `0.5rem` border radius, and `space-sm` vertical by `space-md` horizontal padding.
- Text uses `body-md` in `#0f172a` with placeholder copy in `#94a3b8`.
- Focus state creates a sharp `1px solid #059669` ring with an ambient halo of `0 0 0 3px rgba(5, 150, 105, 0.15)`.

### Alert Banners
- Top-level environmental hazard warnings utilize a `#fef2f2` background with a prominent `1px solid #f87171` structural border. 
- Content pairs a bold crimson heading (`headline-sm`, `#991b1b`), informative slate body copy (`body-md`, `#7f1d1d`), and a right-aligned emergency action button.