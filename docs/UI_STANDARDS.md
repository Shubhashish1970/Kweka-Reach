# Kweka UI Standards

This document is the **single source of truth** for UI/UX across Kweka products (Kweka Axis, Kweka Reach, and other Kweka apps). It is maintained in **kweka-sales-client** and can be copied into any Kweka app repo to ensure consistent look, components, and patterns.

---

## Applying this to other Kweka apps

1. **Copy this file** into your app (e.g. `docs/UI_STANDARDS.md` or project root).
2. **Tailwind theme:** Extend your `tailwind.config` with the **Design tokens** below (primary, primary-variant, page, font). For a different product accent, change only `primary` and `primary-variant`; keep all other tokens.
3. **Reference zoom (optional):** If you want the same visual scale, add the zoom/scale rules on `html` in your `index.html` (see "Reference zoom" below).
4. **Components:** Use or reimplement the shared components listed in "Shared components"; match heights (`min-h-10`), focus rings (`ring-primary/20`), and variants.
5. **Product-specific:** Only **brand name**, **tagline**, and **primary color** differ per app (e.g. Kweka Axis = teal, Kweka Reach = green). All typography, spacing, cards, filters, and patterns stay the same.

### Quick reference

| Token | Value | Usage |
|-------|--------|--------|
| **Primary** | `#14b8a6` | Accents, buttons, active states, section bars (Kweka Axis) |
| **Primary variant** | `#0d9488` | Hover on primary |
| **Page background** | `#F8FAFC` | Body / main area (`bg-slate-50` or `bg-page`) |
| **Header** | `bg-slate-900` | App bar, nav |
| **Font** | Inter (300–700) | All UI text |
| **Input/dropdown height** | 40px | `min-h-10` everywhere |
| **Focus ring** | 2px, primary 20% | `focus:ring-2 focus:ring-primary/20 focus:border-primary` |

---

## Design tokens (Tailwind)

Use this in your `theme.extend` so other Kweka apps stay consistent. Only `primary` / `primary-variant` need to change per product.

```js
// tailwind.config.js — theme.extend
colors: {
  page: "#F8FAFC",
  primary: "#14b8a6",           // Kweka Axis teal; use green for Kweka Reach
  "primary-variant": "#0d9488",
  "on-primary": "#FFFFFF",
  surface: "#FAFAF9",
  "surface-variant": "#F5F5F4",
  "on-surface": "#1C1917",
  "on-surface-variant": "#57534E",
  outline: "#E7E5E4",
  accent: "#D97706",
},
fontFamily: {
  sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
},
```

Load Inter from Google Fonts: `family=Inter:wght@300;400;500;600;700`.

---

## Kweka Axis vs Kweka Reach

- **Kweka Axis:** Primary = teal (`#14b8a6`). Brand: "KWEKA AXIS"; tagline e.g. "Field Intelligence Engine".
- **Kweka Reach:** Primary = green; brand "KWEKA REACH"; tagline "Farmer Engagement Platform". All other typography, layout, filters, and components align with this document.

Use `primary` and `primary-variant` only (no raw `teal-500` / `green-500`) so switching products is a config change.

---

### Reference zoom (Chrome 100%)

The design is calibrated to match the visual appearance at **90% Chrome zoom**. To preserve that look at **100% browser zoom**, the app applies a scale factor at the **html** element in `index.html`:
- **Chrome, Safari, Edge:** `html { zoom: 0.9; }` (native support, in a `@supports (zoom: 1)` block)
- **Firefox:** `html { transform: scale(0.9); transform-origin: top left; width: 111.111vw; min-height: 111.111vh; overflow-x: hidden; }` in a `@supports not (zoom: 1)` block

An optional wrapper (e.g. `.app-zoom-root` / `.app-zoom-inner` in `App.js`) is for layout structure only; the zoom is applied on `html`.

## Font, size & color specification (Kweka Reach reference)

Use these values for consistent UI/UX across Kweka products. All fonts are sans-serif (Inter or system fallbacks).

| Section | Element | Font size | Font weight | Color (hex) | Tailwind |
|---------|---------|-----------|-------------|-------------|----------|
| **App header** | Background | — | — | `#0f172a` | `bg-slate-900` |
| | Separation between top bar and nav | — | — | None | No border; seamless transition |
| | Brand name (KWEKA AXIS) | ~16px | Bold | `#FFFFFF` | `text-base font-bold text-white uppercase` |
| | Logo / brand accent | — | — | `#14b8a6` / `#0d9488` | `text-primary` / `bg-primary` |
| | Screen title (role-based, e.g. Admin Dashboard) | ~24px | Bold | `#FFFFFF` | `text-2xl font-bold text-white` |
| | Nav item (inactive) | ~16px | Regular | `#FFFFFF` | `text-base text-white` |
| | Nav item (active) | ~14px | Bold | `#2dd4bf` | `text-sm text-teal-400 font-bold` + teal line above bottom edge |
| | User name, logout | ~14–16px | Regular | `#FFFFFF` | `text-sm text-white` |
| **Info banner** | Background | — | — | `#EFF6FF` | `bg-blue-50` |
| | Border | — | — | `#BFDBFE` | `border-blue-200` |
| | Title text | ~14px | Bold | `#1E3A8A` | `text-sm font-bold text-blue-900` |
| | Body text | ~14px | Regular | `#1D4ED8` | `text-sm text-blue-700` |
| | Icon | — | — | `#2563EB` | `text-blue-600` |
| **Section header card** | Title | ~20–22px | Bold | `#212529` | `text-xl font-bold text-slate-900` |
| | Subtitle | ~14px | Regular | `#6c757d` | `text-sm text-slate-600` |
| **Controls** | Checkbox label | ~14px | Regular | `#212529` | `text-sm text-slate-900` |
| | Secondary button (Refresh) | ~14px | Regular | `#495057` | `text-sm text-slate-600` |
| | Secondary button border | — | — | `#E2E8F0` | `border-slate-200` |
| **Error state** | Error text | ~16px | Regular | `#DC3545` | `text-base text-red-500` |
| | Try Again button bg | — | — | `#E9ECEF` | `bg-slate-200` |
| | Try Again button text | ~14px | Regular | `#495057` | `text-sm text-slate-600` |
| **Main content** | Background | — | — | `#F8FAFC` / `#F5F7F9` | `bg-slate-50` |
| **Cards** | Background | — | — | `#FFFFFF` | `bg-white` |
| | Title | ~20–22px | Bold | `#212529` | `text-xl font-bold text-slate-900` |

### Typography scale (reference)

- **~24px:** Screen title in header → `text-2xl`
- **~20–22px:** Section/card title → `text-xl`
- **~18px:** Large brand text → `text-lg`
- **~16px:** Body, nav items → `text-base`
- **~14px:** Subtitle, controls, secondary text → `text-sm`
- **~12px / 10px:** Labels, meta, compact → `text-xs` / `text-[10px]`

### Color palette (Kweka Reach — extracted from reference screens)

| Use | Hex | Tailwind / Notes |
|-----|-----|------------------|
| **Primary teal (logo, active, accents)** | `#14b8a6`, `#0d9488`, `#2dd4bf` | `primary` / `teal-400` — logo icon, active tab underline, SIGN IN button, role pills |
| **Secondary teal (slogan, subtitles)** | `#2dd4bf`, `#5eead4` | Lighter teal for taglines, subtitles (Kweka Axis); Kweka Reach uses green for "FARMER ENGAGEMENT PLATFORM" |
| **Header dark** | `#152A3C`, `#1D354B`, `#1f272e` | `slate-800` — dark navy/blue-grey top bar |
| **White (text on dark)** | `#FFFFFF` | `text-white` — brand, titles, nav, user info on header |
| **Light blue info banner** | `#E0F2F7`, `#EFF6FF` | `bg-blue-50` — info banner background |
| **Separation line** | `#E0E0E0` | `border-slate-600` — thin line below top bar |
| **Dark text (content)** | `#212529`, `#333333` | `text-slate-900` — headers, body on light backgrounds |
| **Logout accent** | `#FF6347`, `#ff4500` | `text-red-400` / `text-red-500` |
| **Light grey (borders, inactive)** | `#E0E0E0`, `#CCCCCC`, `#999999` | `slate-300`, `slate-400`, `slate-500` |
| **Info banner** | Border `#BFDBFE`; title `#1E3A8A`; body `#1D4ED8`; icon `#2563EB` | `border-blue-200`; `text-blue-900`; `text-blue-700`; `text-blue-600` |

### Logo and brand by page context (Kweka Reach reference)

Branding varies by page type. Kweka Axis should mirror these patterns.

| Page context | Logo | Brand text | Subtitle / tagline | Alignment |
|--------------|------|------------|-------------------|-----------|
| **Landing / Login** | Green leaf icon (`#61BF40`) | "Kweka" bold white; "Reach" regular white | "Farmer Engagement Platform" — smaller, lighter green/white (~12–14px) | Left-aligned; no separation line (integrated with hero) |
| **App header (logged-in)** | Green icon (`#6FC24B`), `w-10 h-10` | "KWEKA REACH" uppercase, white, ~14–16px, medium weight | Page title (e.g. "Team Lead Dashboard") — ~20–24px, bold, white | Logo and brand left-aligned; icon vertically centered with brand; separation line below top bar |
| **Select Workspace** | — | — | — | No dark branded header; content starts with "Select Workspace" title and module cards. |

### Select Workspace — module cards (Dashboard)

- **Purpose:** Module selection grid (Village, HQ, Territory, etc.) under Master Data and other sections.
- **Selection behavior:** When a user clicks a module card, the dark background (`bg-slate-900`) first animates to the clicked card, creating the illusion that it has been selected; then after 0.5 seconds the screen opens.
- **Transition:** `transition-all duration-300` on cards; `transition-colors duration-300` on icon, text, and subtext for smooth visual movement.
- **Selection state:** Track `selectedCardId`; the first card in the list is selected by default; when section changes, reset to first card if current selection is not in the new list.
- **Delay:** 0.5 seconds (`NAVIGATION_DELAY_MS = 500`) between selection visual change and navigation.
- **Selected card style:** `bg-slate-900 border-slate-900 text-white shadow-lg shadow-slate-300`; unselected: `bg-white border-slate-200 hover:border-primary/50 hover:shadow-sm`.
- **Implementation:** `components/Dashboard.js` — `handleCardClick` sets `selectedCardId`, schedules `onNavigate` after delay; cleanup timeout on unmount.

**Rules:**
- **App header:** Brand `text-base font-bold text-white uppercase`; page title `text-2xl font-bold text-white`. Logo and brand aligned at top; page title stacked below.
- **Landing:** Brand can use mixed case ("Kweka Axis"); tagline in secondary teal or white.
- **Separation line:** Visible on app header (logged-in); not on landing (no distinct top bar).

### Home Page (Landing) specification

- **Layout:** Full-viewport hero; no blurry header bar; no white footer; hero image extends to bottom. Body background `bg-slate-900` (`#0f172a`).
- **Brand:** "Kweka" white, "Axis" teal — `text-[30px] font-bold`; "Kweka" `text-white`, "Axis" `text-primary`.
- **Category label:** "Structure. Execute. Scale." — `text-teal-400`, uppercase.
- **Tagline:** "Field Intelligence Engine" — `text-teal-400`.
- **Logo icon:** Square `w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-primary`; no teal bars.
- **Sign In button:** `bg-primary hover:bg-primary-variant text-white font-bold rounded-xl shadow-lg`.
- **Feature cards:** Bold titles, white descriptions on dark.
- **KPIs:** White numbers and labels.
- **Login modal:** Labels `font-semibold`; inputs `min-h-12 rounded-lg border-slate-200`; error `text-base text-red-500`; primary button `bg-slate-900 rounded-xl`.
- **No footer caption:** Do not show "Kweka Axis — Field Intelligence Engine. Access control module coming soon." or similar at bottom.

### Error state (Kweka Reach)

- **Error message:** `text-base text-red-500` (~16px, `#DC3545`), red exclamation icon.
- **Error card:** White background, rounded corners, subtle shadow.
- **Try Again button:** `bg-slate-200` (`#E9ECEF`), `text-sm text-slate-600` (`#495057`), rounded corners.

### Toast (success / error) — Kweka Reach aligned

- **Purpose:** Transient feedback for save, delete, or upload actions. Auto-dismiss after 4–5 seconds.
- **Placement:** Fixed at **top-right corner** (`top-4 right-4`), above main content.
- **Success:** `bg-primary/10 border-primary/30 text-primary`; icon in `bg-primary/20 text-primary`.
- **Error:** `bg-red-50 border-red-200 text-red-800`; icon in `bg-red-100 text-red-600`.
- **Container:** `rounded-xl border shadow-lg px-4 py-3`; text `text-sm font-medium`.
- **Component:** `components/shared/Toast.js`.
- **Info type:** `bg-blue-50 border-blue-200 text-blue-800`; icon in `bg-blue-100 text-blue-600`.

### ConfirmDialog (replaces native window.confirm)

- **Purpose:** Confirmation dialogs for destructive or important actions (delete, etc.). **Do not use `window.confirm` or `alert`** — use ConfirmDialog and Toast instead.
- **Backdrop:** `bg-black/40 backdrop-blur-sm`, full viewport overlay, `z-[9999]`.
- **Panel:** `bg-white rounded-2xl shadow-2xl border border-slate-200 border-l-4 border-l-primary`, `max-w-md`.
- **Header:** Title `text-xl font-bold text-slate-900`, `border-b border-slate-200`, `px-6 py-5`.
- **Body:** Message `text-sm text-slate-600 leading-relaxed`, `px-6 py-5`.
- **Footer:** `bg-slate-50 border-t border-slate-200`, `px-6 py-4`; Cancel (secondary), Confirm (primary or danger). Buttons: `flex justify-end gap-3`.
- **Variants:** `danger` for destructive actions (delete); `primary` for general confirm.
- **Component:** `components/shared/ConfirmDialog.js`.

**Delete modal — standard pattern**

- **Title:** `"Confirm Delete"`.
- **Message:** `"Are you sure you want to delete [entity]? This action cannot be undone."` (or entity-specific, e.g. `"Delete [name]? This cannot be undone."`).
- **Confirm label:** `"Delete"`.
- **Cancel label:** `"Cancel"`.
- **Variant:** `danger`.
- **Props:** `open`, `title`, `message`, `confirmLabel`, `cancelLabel`, `variant`, `onConfirm`, `onCancel`, `loading` (optional, for async delete).

### Header (AppTopBar + SecondaryNavBar) — specification

- **AppTopBar:** `bg-slate-900`, `max-w-7xl mx-auto px-4 sm:px-6`. Logo `w-10 h-10 rounded-xl bg-primary`; brand "KWEKA AXIS" `text-[10px] font-black text-primary uppercase tracking-[0.2em]`; page title `text-xl font-black text-white`. User `text-slate-300`, role `text-xs text-slate-300 uppercase`, Logout `text-red-400`. No border below.
- **SecondaryNavBar:** Same `max-w-7xl mx-auto px-4 sm:px-6` so logo, page title, and first menu item share the same left edge. `bg-slate-900`, `h-14`, no line between bars. Active tab: teal line **above** bottom edge (`absolute bottom-2 left-0 right-0 h-0.5 bg-primary`), `text-primary font-bold`. Inactive: `text-slate-400`, hover `text-white`. Tablet+ horizontal tabs; mobile hamburger with same alignment container.
- **Alignment rule:** Both bars use the same inner container (`max-w-7xl mx-auto px-4 sm:px-6`) so the Kweka Axis icon, section header (page title), and first nav menu item align vertically on the left.

### Navigation (Kweka Reach–aligned)

- **Layout:** Two-tier header: (1) Primary top bar, (2) Secondary nav bar. No vertical sidebar.
- **Primary top bar (Kweka Reach–aligned):**
  - **Height:** ~64px minimum (`min-h-16` or `py-3 min-h-16`).
  - **Background:** `bg-slate-900` (no border between AppTopBar and SecondaryNavBar).
  - **Left:** Logo (`w-10 h-10 bg-primary rounded-xl`) aligned with brand text. Brand "KWEKA AXIS" (`text-[10px] font-black text-primary uppercase tracking-[0.2em]`) + page title (`text-xl font-black text-white`). Logo and brand aligned at top; page title stacked below brand. **Alignment:** Logo, page title, and first nav menu item share the same left edge via `max-w-7xl mx-auto px-4 sm:px-6` in both AppTopBar and SecondaryNavBar. *(Future: page title will be role-based per login role.)*
  - **Right:** User name (`text-sm text-slate-300 font-medium`), person icon (`text-slate-400`), role badge "ADMIN" with chevron (`text-xs text-slate-300 uppercase`), "→ Logout" text link (`text-sm font-medium text-red-400 hover:text-red-300`). No hover background on Logout.
  - **Secondary nav bar (intelligent design):**
  - **Placement:** Directly below primary top bar, full width.
  - **Height:** ~56px (`h-14`).
  - **Background:** Same as top bar `bg-slate-900` (no line between AppTopBar and SecondaryNavBar).
  - **Alignment:** Uses `max-w-7xl mx-auto px-4 sm:px-6` so the first menu item aligns with the logo and page title in AppTopBar. Mobile hamburger uses the same container.
  - **Responsive behavior:** Check screen width; switch layout by breakpoint.
    - **Tablet and up (≥768px):** Horizontal tabs, icon + text, `overflow-x-auto` if needed.
    - **Mobile (<768px):** Hamburger icon; tap opens slide-out drawer from left with vertical list of nav items.
  - **Breakpoint:** `768px` (Tailwind `md`). Use `window.matchMedia('(min-width: 768px)')` for JS-driven switch.
  - **Tabs (tablet+):** `text-sm text-slate-400` (inactive), `text-sm text-primary font-bold` (active). Active state: teal line **above** the bottom edge (`absolute bottom-2 left-0 right-0 h-0.5 bg-primary`), teal icon. Inactive: `text-slate-400` on dark, hover `text-white`.
  - **Hamburger menu (mobile):** Full-height drawer `w-72 max-w-[85vw]`, backdrop `bg-black/50`, close button. Nav items as vertical list with `min-h-[48px]` touch targets.
  - **Items:** Dashboard, Master Data, FDA Related, Activity Report, Farmer, Farmer Registration, Chat Box (role-filtered).
- **Main content:** No left padding (`pl-0`); full width below secondary nav.
- **Back to menu (backlink hierarchy):** When on a sub-page, show a back link with left-arrow icon at the **top-left of the content card** (Kweka Reach aligned). **Styling: shaded pill** — light grey background, rounded pill shape, same format as Filters/Refresh in Kweka Reach: `inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-slate-100 border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-200 hover:text-slate-900 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 focus:ring-offset-1`; icon `w-5 h-5`. **Hierarchy rule:** 3rd level → 2nd level; 2nd level → 1st level. **Label:** Must indicate the **destination screen** the user will navigate to.
  - **3rd level (forms, edit, Excel upload):** Back link goes to the **2nd level (entity list)**. Label: "Back to [Entity]" (e.g. "Back to Villages", "Back to Activity", "Back to Employees"). Form pages always navigate to the parent list, never skip to the section dashboard.
  - **2nd level (entity list, terminal pages):** Back link goes to the **1st level (section dashboard / Master Menu)**. Label: "Back to [Section Name]" (e.g. "Back to Master Data", "Back to FDA Related", "Back to Activity Report", "Back to Farmer"). Use the section label that matches the nav (Master Data, FDA Related, Activity Report, Farmer, etc.).
  - Placement: first row inside the white content card, above the title/header row. Clicking navigates to the indicated destination. Component: `components/shared/BackToMenuLink.js`.

### Intelligent design (responsive navigation)

- **Principle:** Adapt layout to screen size. Use horizontal menu when width accommodates tabs; use hamburger when space is limited.
- **Breakpoint:** 768px. Below = mobile (hamburger); at or above = tablet/desktop (horizontal tabs).
- **Implementation:** `window.matchMedia('(min-width: 768px)')` with listener for resize. React state drives conditional render.
- **Mobile:** Hamburger icon in nav bar; tap opens slide-out drawer from left. Backdrop dims content; tap backdrop or close button to dismiss.
- **Tablet+:** Full horizontal tab bar; `overflow-x-auto` if tabs exceed width.

---

## Reference

### Info banner (GlobalMessageBar) — Kweka Reach aligned

- **Purpose:** Section-level contextual message. A **separate segment** from the app header. Explains workflow, purpose, or how to use the page.
- **Placement:** Renders on all pages, inside the scrollable main content area, at the top (below nav, above page content). Inset from content edges (`mx-4 mt-4`).
- **Scroll behavior:** The Info bar **scrolls with the page**; it is not fixed or sticky. It is the first child of the scrollable `<main>` element.
- **Container:** `bg-blue-50` (`#EFF6FF`), `border border-blue-200`, `rounded-2xl`, padding `p-4`.
- **Icon:** Blue info icon `text-blue-600` in a circular container (`w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center`).
- **Title:** `text-sm font-bold text-blue-900`.
- **Body:** `text-sm text-blue-700 leading-relaxed`.
- **Content rule:** Must **not** repeat the page title or subtitle. Provide complementary detail (workflow, prerequisites, how data flows).
- **Config:** `constants/pageInfoBanners.js` exports `PAGE_INFO_BANNERS` — an object keyed by page ID, each value `{ title, description }`.
- **Do not** embed this inside the header; it is a distinct UI segment.

### Section header — short summary (do not repeat info banner)

- **Purpose:** One-line summary under the section title. Describes *what* the section shows.
- **Rule:** The section header summary must **not** repeat the info banner verbatim. Keep it short and complementary.
- **Example:** Info banner: "Configure eligibility and cooling, then run Sampling Run or Adhoc Run to create Unassigned tasks. Task due in (days) sets the scheduled date for new tasks." Section header: "Configure eligibility + cooling, then run sampling (creates Unassigned tasks)."
- **Style:** `text-sm text-slate-600 leading-relaxed`.

### Yellow / amber banner — detailed logic explanation

- **Purpose:** When a section needs a **detailed logic explanation**, troubleshooting, or step-by-step guidance (e.g. "Why is everything zero?", "How does X work?").
- **Use when:** Explaining *why* data is empty, *how* a process works, or providing troubleshooting bullets.
- **Container:** `bg-amber-50 border border-amber-200 rounded-xl px-4 py-3`.
- **Title:** `text-sm font-bold text-amber-900` (e.g. "Why is everything zero?").
- **Body:** `text-sm text-amber-800`; use bullet lists (`list-disc list-inside`) for troubleshooting steps.
- **Distinct from info banner:** Info banner = blue, general guidance. Yellow banner = amber, detailed logic/troubleshooting.

### Typography (Kweka Reach–aligned)

- **Primary font:** Inter. Load from Google Fonts: `family=Inter:wght@300;400;500;600;700` (Kweka Reach; Kweka Axis matches).
- **Fallback stack:** `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif`.
- **Screen / card title:** Large, bold, dark: `text-xl font-bold text-slate-900 leading-tight` (e.g. "Activity Monitoring", "Activity Overview").
- **Header sub-label (under title):** Smaller, lighter, relaxed line spacing: `text-sm text-slate-600 leading-relaxed` (e.g. "Monitor FFA activities and their status").
- **Secondary / meta line:** Even smaller, light gray: `text-xs text-slate-500 leading-relaxed` (e.g. last sync, record counts).
- **Filter labels (Kweka Reach):** Uppercase, medium-light gray, smaller: `text-xs font-semibold text-slate-500 uppercase tracking-widest`. Do **not** use `font-black` for filter labels; use `font-semibold` for the Reach look.
- **Filter input text:** `text-sm font-medium text-slate-900`; placeholder `text-slate-400`.
- **Section labels in cards:** `text-xs font-semibold text-slate-500 uppercase tracking-widest` or `text-[10px] font-semibold text-slate-500 uppercase tracking-widest` for very compact labels.

### Dropdown and input heights (unified — must follow)

**Rule:** All dropdowns and form inputs use the **same height** across the app — filters, forms, modals, drawers. Match the filter row height (Territory, Region, Zone, BU, Date range).

| Context | Height | Tailwind |
|---------|--------|----------|
| **All dropdowns** (filters, forms, modals) | 40px | `min-h-10` |
| **All text inputs** (search, form fields) | 40px | `min-h-10` |
| **Date inputs** | 40px | `min-h-10` |

- **StyledSelect:** Always `min-h-10` (filter row style).
- **SearchableDropdown:** `min-h-10` (used in full-page forms — must match filter dropdowns). Supports `openUpwards` prop (default `false`); form dropdowns open downward. Option hover: `hover:bg-primary/10 hover:text-primary` for teal accent.
- **Filter row dropdowns** (Territory, Region, Zone, BU, Date range): `min-h-10`.
- **Form dropdowns** (Village, HQ, Sub-district, etc.): `min-h-10` (same as filters).

Do **not** use `min-h-12` for dropdowns or inputs in list pages or form modals. Use `min-h-10` for consistency with filter rows.

### No default boxes (Kweka Reach–aligned)

**Rule:** Do **not** use native OS-styled inputs, heavy rounded corners, or chunky "box" styling. Use Kweka Reach style throughout:

- **Form inputs:** `rounded-lg border border-slate-200 bg-white` — light, thin borders; no `rounded-xl` on inputs.
- **Dropdowns:** Use **StyledSelect** or **SearchableDropdown** only (never native `<select>`). Trigger: `rounded-lg`, `min-h-10` (all contexts — match filter row).
- **Dropdown direction:** Dropdowns near the bottom of the viewport (e.g. **Rows per page** in pagination footer) must open **upwards** (`openUpwards={true}`) to avoid viewport cut-off when the page doesn't scroll. StyledSelect supports `openUpwards` prop; use it for footer/bottom-placed dropdowns (Kweka Reach–aligned).
- **Search fields:** Same as form inputs — `rounded-lg`, `border-slate-200`, `min-h-10`.
- **Buttons:** Primary/secondary use `rounded-2xl`; filter/action buttons may use `rounded-lg` for consistency with inputs when in filter rows.

### Filters (Kweka Reach–aligned)

- **Filter label:** `text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1` (or `mb-1.5`). Same for all filter sections (DATE RANGE, TERRITORY, REGION, ZONE, BU).
- **Filter inputs and dropdowns:** Use **StyledSelect** (not native `<select>`) for hierarchy filters. White background, thin border, **slightly rounded**: `rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-900`; height `min-h-10`. Focus `focus:ring-2 focus:ring-primary/20 focus:border-primary`.
- **Hierarchy filter order:** When present, use this order: **Territory → Region → Zone → BU**. Each as a single StyledSelect with “All …” as first option.
- **Filter grid & column widths:** Reserve space so date range and dropdowns don’t overlap. Use explicit columns, e.g. `grid-cols-[minmax(300px,1.2fr)_minmax(180px,1fr)_minmax(180px,1fr)_minmax(180px,1fr)_minmax(180px,1fr)] gap-4`: date range column min 300px, Territory/Region/Zone/BU columns min 180px each; `gap-4` between columns. Add `min-w-0` on each cell for correct overflow.
- **Date range filter:** Trigger wide enough for all presets and long ranges (`min-w-[300px]`); dropdown panel with **From** and **To** inputs **side by side** (2-column grid); presets on the left of the panel.
- **Placement:** Filters live inside the list-page header card, below the title row, shown when "Filters" is toggled on. Order in header: **Filters** button, then **Refresh**, then other actions.

### Brand and layout

- **Product name (short):** Kweka Axis  
- **Sub-label (above screen title):** `text-[10px] font-black text-primary uppercase tracking-[0.2em]`  
- **Logo mark:** `w-10 h-10 bg-primary rounded-xl`, icon `text-slate-900` 20px  
- **Page background:** `#F8FAFC` (body); main content `bg-slate-50`  
- **Brand accent (Kweka Reach / Kweka Axis aligned):** `focus:ring-primary/20`, `focus:border-primary`, `bg-primary/10`, `text-primary` for selected options  
- **App header:** Dark bar `bg-slate-900`; brand `text-[10px] font-black text-primary`; page title `text-xl font-black text-white`; active tab/item `text-primary font-bold`; inactive tabs `text-slate-400`; Logout `text-red-400 hover:text-red-300` (no hover background)  
- **App shell & scroll:** Top bar and secondary nav stay **fixed**; the **main content** (including the Info bar) scrolls. Root: `h-screen overflow-hidden`; wrapper below header: `overflow-hidden`; main: `overflow-y-auto overflow-x-hidden min-w-0`. The Info bar is inside main and scrolls with the page. Top bar: `sticky top-0`. No vertical sidebar; use horizontal secondary nav (Kweka Reach style).  
- **Cards:** `bg-white rounded-3xl border border-slate-200 shadow-sm`; card header `bg-slate-50 border-b border-slate-200`, title `text-lg font-bold text-slate-900`  
- **List page pattern:** One white header card with title (left), **Filters** and **Refresh** (right, Filters first), filter panel below when toggled  
- **Form controls (general):** `min-h-10 rounded-lg border-slate-200 focus:ring-2 focus:ring-primary/20 focus:border-primary`; labels use filter label style above (`text-xs font-semibold text-slate-500 uppercase tracking-widest`)  
- **Buttons:** Shared `Button`; variants primary (`bg-primary`), secondary, danger, ghost; `rounded-2xl`, `font-bold`; form footer buttons use `h-10`  
- **Tables:** Header `bg-slate-100`, `text-[10px] font-semibold text-slate-500 uppercase tracking-widest`; body `border-slate-100 hover:bg-slate-50`  
- **Badges:** `inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold border`; semantic colours (teal/amber/red/slate)  
- **Add/Edit forms:** Full-page pattern with adjustable columns, sections in 2 columns, fields grouped by section. See "Add/Edit form — full-page screen design specification" for full spec.
- **KPI boxes (Kweka Reach–style):** White card `bg-white rounded-3xl border border-slate-200 shadow-sm`; semantic colour only on **icon background** and **metric value** (e.g. teal for positive, red for negative, slate for neutral). Layout: icon left in coloured rounded container (`w-10 h-10 rounded-xl bg-{semantic} text-white`), then label (uppercase `text-xs font-medium text-slate-700`) and large value (`text-3xl font-bold text-{semantic}-600`). Optional info icon top-right `text-slate-400`.
- **Weather (dashboard):** Two cards side by side. **Current weather card:** white background `bg-white border border-slate-200`; label `text-slate-500`; **current temperature** highlighted — large `text-4xl font-black`, teal underline `border-b-2 border-primary`; `max-w-sm`, `rounded-2xl`, `p-3`. **Forecast card:** separate card — `bg-white rounded-2xl border border-slate-200 shadow-sm`, "Next 5 days" grid; same row with `flex flex-wrap gap-3`. Map can extend into 2nd quadrant.

## Shared components (kweka-sales-client)

**Reference repo paths:** In kweka-sales-client, shared UI lives under `components/` and `components/shared/`. Config for page-level content (e.g. info banners) lives in `constants/`. When applying to another Kweka app, copy or reimplement these; keep the same Tailwind classes and props so behavior matches.

- **`components/AppTopBar.js`** – Primary top bar: logo, "KWEKA AXIS" (`text-[10px] font-black text-primary`), page title (`text-xl font-black text-white`); user name (`text-slate-300`), role with chevron, "→ Logout" (`text-red-400`). Height ~64px min, `bg-slate-900`, no border below. Layout: `max-w-7xl mx-auto px-4 sm:px-6` so logo and title align with first nav item.
- **`components/SecondaryNavBar.js`** – Responsive nav bar: tablet+ (≥768px) horizontal tabs; mobile (<768px) hamburger with slide-out drawer. `bg-slate-900`, no line between top bar and tabs. Same `max-w-7xl mx-auto px-4 sm:px-6` for alignment. Active tab: teal line **above** bottom edge (`absolute bottom-2 left-0 right-0 h-0.5 bg-primary`), `text-primary font-bold`. Inactive: `text-slate-400`, hover `text-white`.
- **`components/shared/GlobalMessageBar.js`** – Info banner (distinct from header). Kweka Reach style: `bg-blue-50 border-blue-200 rounded-2xl`, title `text-blue-900`, body `text-blue-700`, icon `text-blue-600`. Renders inside the scrollable main on all pages; **scrolls with the page** (not fixed).  
- **`components/shared/Button.js`** – Primary, secondary, danger, ghost; sizes sm/md/lg  
- **`components/shared/ConfirmDialog.js`** – Confirmation modal for delete and other critical actions. Replaces `window.confirm`. See "ConfirmDialog" and "Delete modal" spec above.
- **`components/shared/StyledSelect.js`** – Single-select dropdown (focus `ring-primary/20`, selected `bg-primary/10 text-primary`). Always `min-h-10 rounded-lg` (matches filter row; form dropdowns must match). Supports `openUpwards` prop for footer dropdowns — use when dropdown is near bottom of viewport to avoid cut-off.
- **`components/SearchableDropdown.js`** – Searchable dropdown for form fields (Village, HQ, Territory, etc.). `min-h-10 rounded-lg`. Supports `openUpwards` prop (default `false`); form dropdowns open downward. Selected option: `bg-primary/10 text-primary`; unselected hover: `hover:bg-primary/10 hover:text-primary` for teal accent.
- **`components/SearchableMultiSelect.js`** – Searchable multi-select for choosing multiple options (e.g. TM territory allocation). Use when a field requires selecting one or more items from a long list. `min-h-10 rounded-lg`; search input filters options; selected items shown as pills; supports `openUpwards` for bottom-placed dropdowns.
- **`components/shared/InfoBanner.js`** – Legacy: teal tint in-card banner. Page context now lives in **GlobalMessageBar**; use GlobalMessageBar for Kweka Reach alignment.
- **Yellow/amber banner:** For detailed logic or troubleshooting, use `bg-amber-50 border-amber-200 rounded-xl` with `text-amber-900` title and `text-amber-800` body. See "Yellow / amber banner" above.  
- **`components/shared/ListPageHeader.js`** – List page header card with title, Filters, Refresh, and optional filter panel. Context message is in GlobalMessageBar.  
- **`components/FilterPanel.js`** – Supports `embedded={true}` for in-card filter panel; uses shared Button and slate/teal styling  
- **`components/DateRangeFilter.js`** – One trigger (`min-w-[300px]`), panel with presets (left) and From/To dates side by side + Cancel/Apply (right); YTD = 1 Apr last year to today

## List page + full-page Add/Edit pattern (Kweka Reach–aligned)

- **Page card:** `bg-white rounded-2xl border border-slate-200 shadow-sm min-w-0 overflow-hidden`.  
- **Context message:** In **GlobalMessageBar** (top blue bar), not inside the card.  
- **Header row:** Title `text-xl font-bold text-slate-900 leading-tight`, subtitle `text-sm text-slate-600 leading-relaxed`, record pill `inline-flex … px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600`. Right: search (`h-10 rounded-lg border-slate-200`, clear button when filled), **Filters** (Button secondary, `h-10`; toggles to "Hide filters" when open), Export icon (`h-10 w-10`), **Add** (Button primary, `h-10 rounded-lg hover:-translate-y-0.5`). All action bar elements use `h-10` for height consistency.
- **Filter panel:** When Filters is toggled on, show a panel below the header row with `mt-4 pt-4 border-t border-slate-200`. Use page-specific filter dropdowns (e.g. Village: State, District, Sub-district, HQ) as StyledSelect with "All …" as first option. Filters apply to both table and Export. Grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4`.
- **Export/Download:** Export icon exports current filtered data to Excel (XLSX). Same search + filter criteria as table. Success/error toast per Toast spec.
- **Table container:** Table in `rounded-2xl border border-slate-200 shadow-sm`; thead `sticky top-0 z-10 bg-slate-100`, headers `text-[10px] font-semibold uppercase tracking-widest text-slate-500`; sort placeholder when column not sorted; row borders `border-slate-100`, hover `hover:bg-slate-50`. **Actions:** icon-only Edit (pencil) and Delete (trash); focus ring `focus:ring-primary/20` (Edit), `focus:ring-red-500/20` (Delete).
- **Table: no horizontal scroll, resizable columns:** Use `table-fixed` with pixel widths for columns. **Resizable columns:** Each header has a resize handle (right edge, `w-1.5 h-full cursor-col-resize hover:bg-primary/30`); drag to adjust width. Store widths in state; enforce `min-width: 60px`. **Compact:** `px-2 py-2` for cells; `truncate` for long text. **Actions column:** Fixed width (e.g. 80px), not resizable.
- **Pagination:** Below table; "Showing X to Y of Z results" on left; **Rows per page** dropdown (`h-10 rounded-lg border-slate-200`) with options 10, 25, 50, 100; page buttons on right. Rows per page uses StyledSelect with `openUpwards` so the panel opens upward and is not cut off at viewport bottom. When rows-per-page changes, reset to page 1.  
- **Add/Edit:** Navigate to full-page form (Village, HQ, Territory, Manager, FDA). No drawer or modal. Add button and Edit action trigger `onNavigate` / `onNavigateToEdit` to form page. Save/Cancel returns to list.

---

## Village Master Data — reference implementation

Use Village Master Data as the reference for list pages and Add/Edit forms. **All Add New [Entity] and Edit [Entity] forms must follow the Add/Edit Village page layout and functionalities.** Replicate its structure for HQ, Territory, Manager, FDA, and any future entities.

### Village list page (Village Master Data)

| Element | Appearance | Colors / Tailwind |
|---------|------------|-------------------|
| **Page card** | White, rounded, shadow | `bg-white rounded-2xl border border-slate-200 shadow-sm min-w-0 overflow-hidden` |
| **Back link** | Left, above title, shaded pill | `bg-slate-100 border-slate-200 rounded-2xl px-4 py-2`; icon `w-5 h-5` |
| **Page title** | Large, bold, dark | `text-2xl sm:text-[28px] font-bold text-slate-900` — "Village Master Data" |
| **Subtitle** | Below title, grey | `text-sm text-slate-600` — "Manage village master data and locations" |
| **Record pill** | Rounded pill, light grey | `inline-flex px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600` — "34 records" |
| **Search input** | White, bordered, icon left | `h-10 pl-9 pr-9 rounded-lg border border-slate-200 text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-primary/20 focus:border-primary` |
| **Filters button** | Secondary, grey | Button secondary `h-10 rounded-lg`; toggles "Filters" / "Hide filters" |
| **Export icon** | Grey, bordered square | `h-10 w-10 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:border-slate-300` |
| **Add New Village** | **Primary teal** | `bg-primary text-white`; `h-10 rounded-lg hover:-translate-y-0.5`; icon + text |
| **Filter panel** | Below header, border-top | `mt-4 pt-4 border-t border-slate-200`; label `text-xs font-semibold text-slate-500 uppercase tracking-widest` |
| **Filter dropdowns** | StyledSelect, "All States" etc. | `min-h-10`; grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4` |
| **Table** | White, rounded, bordered | `rounded-2xl border border-slate-200 shadow-sm`; thead `bg-slate-100`; headers `text-[10px] font-semibold uppercase tracking-widest text-slate-500` |
| **Table rows** | White, hover grey | `bg-white hover:bg-slate-50`; cells `text-slate-700`; village name `font-bold text-slate-900` |
| **Edit icon** | Grey, hover teal | `text-slate-500 hover:text-primary hover:bg-primary/10`; focus `focus:ring-primary/20` |
| **Delete icon** | Grey, hover red | `text-slate-500 hover:text-red-600 hover:bg-red-50`; focus `focus:ring-red-500/20` |
| **Empty state** | Dashed border, grey | `bg-slate-50 rounded-2xl border-dashed border-slate-200`; icon `text-slate-400`; text `text-slate-600` |

**Info banner (GlobalMessageBar):** Above the page card. `bg-blue-50 border-blue-200 rounded-2xl`; title "Village Master"; body explains hierarchy and Excel upload. Renders from `pageInfoBanners.js`.

### Village form page (Add New Village / Edit Village)

| Element | Appearance | Colors / Tailwind |
|---------|------------|-------------------|
| **Form card** | White, teal left bar, tall | `bg-white rounded-2xl border border-slate-200 border-l-4 border-l-primary shadow-sm overflow-visible min-h-[min(85vh,720px)]` |
| **Back link** | "Back to Villages" (3rd level → 2nd level) | Same pill style as list page |
| **Title** | Bold, dark | `text-2xl font-bold text-slate-900` — "Add New Village" / "Edit Village" |
| **Subtitle** | Grey | `text-sm text-slate-500` — "Create a new village entry" / "Update village details and location" |
| **Entry Mode** | Right-aligned, two pills | Label `text-xs font-semibold text-slate-500 uppercase tracking-widest`; active `bg-primary text-white`; inactive `bg-white border border-slate-200 text-slate-700`; pills `h-9 px-3 rounded-full text-sm font-medium` |
| **Section headers** | Teal bar left, grey bg | `pl-3 border-l-4 border-l-primary bg-slate-50 text-slate-800 rounded-r-lg py-2`; title `text-xs font-bold uppercase tracking-widest`; icon `w-4 h-4 text-slate-600` |
| **Geography section** | MapPinIcon | Village, Sub-district, District, State — SearchableDropdown |
| **Company section** | BuildingIcon | HQ, Focus Village (radio: Primary/Secondary) |
| **Location section** | MapIcon | Latitude, Longitude (read-only), Pincode, "Select on Map" button |
| **Form inputs** | Bordered, focus teal | `min-h-10 px-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-primary/20 focus:border-primary`; error `border-red-500` |
| **Select on Map** | Outlined, teal accent | `border border-slate-200 text-primary hover:bg-primary/10 rounded-lg h-10` |
| **Save button** | Primary teal | `bg-primary text-white`; `min-w-[120px] h-10` |
| **Cancel button** | Secondary | `border border-slate-200 text-slate-600` |
| **Delete button** | Danger red | `bg-red-600 text-white`; shown only when editing |

**Layout:** Two columns on desktop (`grid grid-cols-1 lg:grid-cols-2 lg:gap-6`). Left: Geography. Right: Company + Location. Border between columns: `lg:border-r border-slate-200`.

**Colors summary:** Primary teal (`#14b8a6`) for Add button, active Entry Mode, section bars, focus rings, Save button, Edit hover. Slate for text, borders, backgrounds. Red for Delete and errors.

### Add/Edit form — required layout and functionalities (all entities)

**Rule:** Every Add New [Entity] and Edit [Entity] form (Village, HQ, Territory, Manager, FDA, etc.) must match the Village form in:

| Requirement | Specification |
|-------------|---------------|
| **Layout** | Full-page form; card with teal left bar; two-column grid on desktop; sections with teal bar + icon + uppercase title |
| **Back link** | Label must indicate destination screen. 3rd level (form) → "Back to [Entity]" (e.g. "Back to Villages"); 2nd level (list) → "Back to [Section]" (e.g. "Back to Master Data"). Shaded pill. |
| **Title** | "Add New [Entity]" / "Edit [Entity]" |
| **Subtitle** | Entity-specific (e.g. "Create a new village entry") |
| **Entry Mode** | Manual Entry and Upload Excel pills; right-aligned with title; always visible |
| **Manual Entry** | Fields grouped into logical sections (e.g. Geography, Company, Location); SearchableDropdown for selects; `min-h-10` inputs |
| **Upload Excel** | Same 3-step flow (info bar, template + upload, map + preview, success); entity-specific ExcelUpload component |
| **Action buttons** | Save (primary), Cancel (secondary), Delete (danger, when editing); right-aligned; `min-w-[120px] h-10` |
| **Validation** | Required fields marked with *; inline error messages; toast for save/delete success or failure |
| **Delete** | ConfirmDialog before delete; only shown when editing |

**Entities:** Village, HQ, Territory, Manager, FDA, Activity Types, Other Data, Manager Map (where Add/Edit applies).

---

## Add/Edit form — full-page screen design specification

Use this specification for all Add/Edit forms (Village, HQ, Territory, Manager, FDA, Excel upload flows). **Centered modal and sliding drawer are replaced by full-page forms** with adjustable columns, sections in distinct 2 columns, and fields grouped by section. **Village form is the canonical reference** — all entity forms must follow it.

### Full-page form (standard for all entities)

**Pattern:** Add/Edit form as a separate page (not modal or drawer). Navigate to form page; Save/Cancel returns to list. **Design goals:** Adjustable columns, sections in distinct 2 columns, fields grouped by section, compact layout, title left.

| Element | Specification | Tailwind |
|---------|---------------|----------|
| **Card** | White, rounded, teal accent, dropdown-friendly | `bg-white rounded-2xl border border-slate-200 border-l-4 border-l-primary shadow-sm min-w-0 overflow-visible min-h-[min(85vh,720px)]` |
| **Padding** | Compact | `px-6 py-5` |
| **Back link** | Left, above title | `BackToMenuLink` with label indicating destination. 3rd level: "Back to [Entity]"; 2nd level: "Back to [Section]". Shaded pill style |
| **Title** | Left, bold | `text-2xl font-bold text-slate-900` |
| **Subtitle** | Below title | `text-sm text-slate-500 mt-0.5` |
| **Entry Mode** | Right-aligned with title (same row) | `flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4`; Entry Mode on right |
| **Entry Mode tabs** | Compact pills | `h-9 px-3 rounded-full text-sm font-medium`; active `bg-primary text-white` |
| **Form layout** | Adjustable columns, sections in 2 columns | `grid grid-cols-1 lg:grid-cols-2 lg:gap-6`; left column: one section group; right column: another section group. Fields grouped by section. |
| **Section headers** | Teal bar, compact | `pl-3 border-l-4 border-l-primary bg-slate-50 rounded-r-lg py-2` |
| **No scroll** | Form fits viewport | Compact spacing (`space-y-4`, `pb-4`, `pt-4`); avoid `overflow-y-auto` on form |
| **Action buttons** | Right-aligned, standard size | `flex justify-end gap-3`; `min-w-[120px] h-10`; Save (primary), Cancel (secondary), Delete (danger when editing) |

**Entities using full-page form:** Village, HQ, Territory, Manager, FDA (Employee Master).

**TM (Territory Manager) multi-territory:** When role is TM, use **SearchableMultiSelect** for territory assignment (proximity-based allocation). Do not use a plain checkbox list; the searchable multi-select improves UX for long territory lists.

### Section headers (Geography, Company, Location, etc.)

| Element | Specification | Tailwind |
|---------|---------------|----------|
| **Container** | Row with icon, title, light gray background | `flex items-center gap-3 mb-4 pl-3 border-l-4 border-l-primary bg-slate-100 text-slate-800 rounded-r-lg py-2.5 border-b border-slate-200/60` |
| **Teal vertical bar (primary)** | Left of section header, 16px | `border-l-4 border-l-primary` |
| **Icon** | 16px, slate, before title | `w-4 h-4 shrink-0 text-slate-600` |
| **Title** | Uppercase, bold | `text-sm font-bold uppercase tracking-widest whitespace-nowrap` |
| **Background** | Light slate | `bg-slate-100` |
| **Text** | Dark slate | `text-slate-800` |

**Icon mapping:** Geography → MapPinIcon; Company → BuildingIcon; Location → MapIcon.

### Entry mode (Manual Entry / Upload Excel)

| Element | Specification | Tailwind |
|---------|---------------|----------|
| **Placement** | Right-aligned with title (same row) | `sm:flex-row sm:justify-between` with Entry Mode on right |
| **Visibility** | Always visible regardless of current mode or map state | Do not hide when map is shown or when Upload Excel is active |
| **Label** | Above tabs | `block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2` |
| **Active tab** | Primary teal, white text | `bg-primary text-white` |
| **Inactive tab** | Light background, dark text, border | `bg-surface border border-slate-200 text-on-surface` |
| **Tab shape** | Pill, min height | `rounded-full px-4 py-2 min-h-10 text-sm font-medium` |
| **Icon** | Left of text | `w-4 h-4 shrink-0` |

**Behavior:** On Cancel or Back, reset mode to Manual Entry and hide any map view so the form opens in a consistent initial state when revisited.

### Info bar (within form — e.g. "How to add villages via Excel")

| Element | Specification | Tailwind |
|---------|---------------|----------|
| **Container** | Light blue, rounded | `bg-blue-50 border border-blue-200 rounded-2xl p-4 flex gap-4` |
| **Icon circle** | Blue background | `w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0` |
| **Icon** | Blue | `w-5 h-5 text-blue-600` |
| **Title** | Bold, dark blue | `text-sm font-bold text-blue-900 mb-1` |
| **Body** | Bullet list, blue | `text-sm text-blue-700 leading-relaxed space-y-1 list-disc list-inside` |

### Excel upload flow (unified for all entities)

**All Excel upload components** (FDA, Village, HQ, Territory, Manager, Activity, OtherData, ManagerMap) must follow the same 3-step flow:

| Step | Content | Specification |
|------|---------|---------------|
| **Info bar** | Always visible at top | `bg-blue-50 border border-blue-200 rounded-2xl p-4 flex gap-4`; icon in `bg-blue-100` circle; title "How to add [Entity] via Excel"; 3 bullets: (1) Download template and fill columns, (2) Upload file, (3) Map columns then upload |
| **Step 1** | Two bordered cards | Card 1: "1. Get the template" — teal icon, Download Template button. Card 2: "2. Upload your Excel file" — blue icon, dashed-border "Choose file" label with hidden input |
| **Step 2** | Map + Preview + Upload | Amber icon + "Map your columns"; grid of StyledSelect per field; Preview table; "Upload [Entity]" button |
| **Step 3** | Success + Back | Teal success card with checkmark; "Back to [Entity]" button (short label, e.g. "Back to Villages") |

**Components:** ExcelUploadFDA, ExcelUploadVillage, ExcelUploadHQ, ExcelUploadTerritory, ExcelUploadManager, ExcelUploadActivity, ExcelUploadOtherData, ExcelUploadManagerMap.

### Upload/Download template sections (numbered steps)

| Element | Specification | Tailwind |
|---------|---------------|----------|
| **Section card** | White, bordered, rounded | `border border-slate-200 rounded-xl p-5 bg-white shadow-sm` |
| **Icon container** | Colored circle (teal for download, blue for upload) | `w-10 h-10 rounded-xl bg-teal-100` or `bg-blue-100` |
| **Icon** | Semantic color | `w-5 h-5 text-teal-600` or `text-blue-600` |
| **Step title** | Bold | `text-sm font-bold text-slate-900` |
| **Description** | Smaller, gray | `text-xs text-slate-600` |
| **Action button** | Download: border; Upload: dashed file input | `rounded-lg border border-slate-200` or `border-2 border-dashed border-slate-200` |

### Slate color palette (form elements)

| Use | Tailwind |
|-----|----------|
| Section header background | `bg-slate-100` |
| Section header text | `text-slate-800` |
| Input borders | `border-slate-200` |
| Labels | `text-slate-700`, `text-slate-500` |
| Placeholder | `text-slate-400` |
| Body text | `text-slate-900` |
| Dividers | `border-slate-200` |
| Light gray backgrounds | `bg-slate-50` |

### Helper text (form fields)

**Rule:** Keep helper text under **10 words**. Use `text-xs text-slate-500`; place below field with `mt-1` or `mt-1.5`.

### Form inputs and dropdowns

| Element | Specification | Tailwind |
|---------|---------------|----------|
| **Height** | Unified | `min-h-10` |
| **Padding** | Compact | `px-3 py-2` |
| **Border (inactive)** | Light, consistent | `rounded-lg border border-slate-200` |
| **Focus** | Primary ring (20% opacity) | `focus:ring-2 focus:ring-primary/20 focus:border-primary` |
| **Input text** | Unified size | `text-sm` |
| **Labels** | Uppercase, compact | `text-xs font-semibold text-slate-500 uppercase tracking-widest` |

### Form consistency (color, thickness, height)

| Rule | Specification |
|------|---------------|
| **Inactive borders** | Use `border-slate-200` for all inputs, dropdowns, secondary buttons, toggle tabs. Do not mix `border-outline` or `border-slate-300`. |
| **Focus ring** | Use `ring-2 ring-primary/20` for inputs, dropdowns, and StyledSelect when open/focused. Consistent 2px ring at 20% opacity. |
| **Component heights** | All inputs, dropdowns, toggle buttons, and footer action buttons: `h-10` (40px exact). Use `h-10` for fixed height; `min-h-10` only when content may grow. |
| **Font sizes** | Labels: `text-xs`; input/placeholder/button text: `text-sm`. |

### Action buttons (footer)

| Button | Specification | Tailwind |
|--------|---------------|----------|
| **Save Changes** | Primary, teal | `bg-primary`; `text-white font-bold rounded-2xl h-10` |
| **Cancel** | Secondary | `border border-slate-200 text-slate-600 min-h-10` |
| **Delete** | Danger | `bg-red-600 text-white min-h-10` |
| **Select on Map** | Primary accent | `border-slate-200 text-primary hover:bg-primary/10 min-h-10`; active: `border-primary bg-primary/10` |

### Map + form layout (when map is shown)

| Element | Specification |
|---------|---------------|
| **Layout** | Flex row: map left, form right |
| **Map** | `flex-1 min-w-0` |
| **Form** | `flex-1 min-w-0 overflow-y-auto p-6` |
| **Floating location card** | Bottom of map: `absolute bottom-3 left-3 right-3 z-[2000] bg-white/95 backdrop-blur-sm rounded-xl border border-slate-200 shadow-lg p-3` |

### Checklist for full-page Add/Edit forms (all entities — match Village form)

- [ ] Teal vertical bar (primary) on left edge of panel (`border-l-4 border-l-primary`)
- [ ] Section headers: teal bar + icon + uppercase title; `bg-slate-100`
- [ ] Entry mode tabs: pill shape; active `bg-primary`, inactive `border`; always visible; reset to Manual Entry on Cancel or Back
- [ ] Info bar (when needed): `bg-blue-50 border-blue-200 rounded-2xl`; icon in `bg-blue-100` circle
- [ ] Upload/Download sections: numbered steps, icon in colored circle, card `rounded-xl border-slate-200`
- [ ] All dropdowns/inputs: `min-h-10`
- [ ] Slate palette for backgrounds, borders, text
- [ ] Footer: Save (primary), Cancel (secondary), Delete (danger when editing)
- [ ] **Full-page form:** Title left; Entry Mode right-aligned with title; adjustable columns; sections in distinct 2 columns; fields grouped by section; no scroll; compact spacing; card `min-h-[min(85vh,720px)]` and `overflow-visible` for dropdowns; Manual Entry + Upload Excel; Save/Cancel/Delete (when editing). **Must match Add/Edit Village layout and functionalities.**

---

## List pages — content width and layout

**Content width (Village page reference):** All Master Data list pages (Village, HQ, Territory, Employee, FDA, Manager, Other Data) must use the same width as Village Master Data. Use `mx-[15px]` so the page card spreads across the width with only 15px margin on each side. **Village Master Data is the reference implementation** — match its layout.

**Dashboard:** The dashboard (both Select Workspace and Activity Overview views) must follow the same width rule: wrap content in `mx-[15px]` for 15px horizontal margin on each side. Use `rounded-2xl` for the Select Workspace card (consistent with list pages).

| Requirement | Specification |
|-------------|---------------|
| **Page card wrapper** | Wrap the page card in `mx-[15px]`: `<div className="mx-[15px]"><div className="bg-white rounded-2xl border border-slate-200 shadow-sm min-w-0 overflow-hidden">...</div></div>` — 15px horizontal margin on each side. |

## List pages — no scroll, controlled row width

**Rule:** All Master Data list pages must fit within the viewport without horizontal scroll. Row and column widths must be controlled.

| Requirement | Specification |
|-------------|---------------|
| **Page card** | `bg-white rounded-2xl border border-slate-200 shadow-sm min-w-0 overflow-hidden` |
| **Sections** | Header row (title, record pill, search, Filters, Export, Add) → Filter panel (when toggled) → Summary cards (if any, e.g. Total/Active/Inactive) → Table → Pagination |
| **No horizontal scroll** | Table must not overflow; use `table-fixed w-full` with explicit column widths; no `overflow-x-auto` on table wrapper |
| **Row width** | Use `table-fixed`; set column widths via `<col>` or inline styles; cells use `truncate` for long text; compact `px-2 py-2` |
| **Container** | Table wrapper: `overflow-hidden` or `min-w-0`; parent card: `min-w-0 overflow-hidden` |
| **Summary cards** | When present (e.g. Employee Master): `grid grid-cols-2 sm:grid-cols-4 gap-4`; compact `p-4` |

## Data tables — resizable columns (optional), no horizontal scroll (required)

Apply to list tables (FDA, Village, Territory, etc.) for consistent layout and **no horizontal scroll**.

| Element | Specification | Tailwind / Notes |
|---------|---------------|------------------|
| **Layout** | Fixed table, controlled widths | `table-fixed w-full` |
| **Column widths** | Explicit widths (percent or px) | Use `<colgroup><col style={{ width: 'X%' }} /></colgroup>` or th/td style; ensure total fits container |
| **No overflow** | Table wrapper | `overflow-hidden` or `min-w-0`; do **not** use `overflow-x-auto` |
| **Resize handle** | Optional; right edge of header | `absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-primary/30` |
| **Min width** | Prevent over-shrinking | `min-width: 60px` per column |
| **Cell padding** | Compact | `px-2 py-2` |
| **Long text** | Truncate | `truncate block max-w-0` on cell content (max-w-0 needed with table-fixed for truncate to work) |
| **Actions column** | Fixed width | `w-20` or `width: 80px` |

---

## Checklist for each new screen

- [ ] **App shell:** Root `h-screen overflow-hidden`; only main content scrolls (`overflow-y-auto`); top bar and secondary nav stay fixed (top bar `sticky top-0`). Use horizontal nav (Kweka Reach), not vertical sidebar.
- [ ] **Intelligent design:** Secondary nav switches by screen width: horizontal tabs ≥768px, hamburger + slide-out drawer <768px.  
- [ ] Page uses `bg-slate-50` (or same body background) and `max-w-7xl mx-auto` where appropriate  
- [ ] Screen title is `text-xl font-bold text-slate-900` with optional `text-sm text-slate-600` subtitle (Kweka Reach)  
- [ ] **Info banner:** Use `bg-blue-50 border-blue-200 rounded-2xl` with `text-blue-900` title and `text-blue-700` body. Info bar scrolls with the page (inside main). Section header summary must not repeat info banner verbatim.  
- [ ] List/detail screens: header is one white card `rounded-3xl border border-slate-200` with title left, **Filters** and **Refresh** right (Filters first, then Refresh), filter panel below when Filters is on  
- [ ] **Filter labels** use `text-xs font-semibold text-slate-500 uppercase tracking-widest` (Kweka Reach)  
- [ ] **Filter dropdowns** use **StyledSelect** (not native select); hierarchy order: Territory → Region → Zone → BU; `min-h-10` (form dropdowns must match)  
- [ ] **Filter grid** uses reserved column widths (date range min 300px, others min 180px) and `gap-4` so fields don’t overlap; cells have `min-w-0`  
- [ ] **Date range:** Single trigger (wide enough for presets), panel with From/To side by side and presets on left  
- [ ] All text inputs/dates/dropdowns use `min-h-10`, `rounded-lg`, `focus:ring-primary/20 focus:border-primary` (unified height — match filter row)  
- [ ] Buttons use the shared Button component (primary/secondary, sm for header actions)  
- [ ] Cards use `rounded-3xl` (or `rounded-2xl` for small blocks), `border border-slate-200 shadow-sm`  
- [ ] Section/filter labels use `font-semibold` + `uppercase tracking-widest` + `text-slate-500`; Inter everywhere  
- [ ] **App header:** `bg-slate-900`; logo + "KWEKA AXIS" (`text-[10px] font-black text-primary`) + page title (`text-xl font-black text-white`); active nav `text-primary font-bold` with teal line above bottom edge; Logout `text-red-400`; logo/title align with first nav item via `max-w-7xl mx-auto px-4 sm:px-6`
- [ ] **Dashboard:** Weather widget compact (`max-w-sm`), 1st quadrant only; map extends into 2nd quadrant; KPI boxes white card with semantic icon + value only
