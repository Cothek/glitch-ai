# Glitch UI — Design System

Dark premium design system for Glitch's internal tooling. Vanilla CSS custom properties, zero external dependencies, no build step. Designed for admin panels, dashboards, and management interfaces.

## Quick Start

```html
<link rel="stylesheet" href="./tokens.css">
<link rel="stylesheet" href="./components.css">
<link rel="stylesheet" href="./layout.css">
```

Import in order: tokens first, then components, then layout.

## File Structure

| File | Purpose |
|------|---------|
| `tokens.css` | Design tokens — colors, typography, spacing, shadows, radius, transitions, z-index |
| `components.css` | Component styles — button, badge, table, modal, card, input, select, tabs, toast, spinner, empty state |
| `layout.css` | Layout utilities — page shell, grid, flex, responsive, spacing, text, border |
| `index.html` | Component showcase / reference page — open in browser to see all components |

## Design Decisions

- **Style**: Dark premium — deep neutrals, restrained purple accent
- **Accent**: Purple (`#a855f7`) — Glitch's brand color
- **Font**: System font stack (no external deps)
- **Density**: Dashboard-dense — internal tools show lots of data
- **Motion**: Hover states only, no entrance animations
- **Build**: Vanilla CSS custom properties, no build step

## Component Reference

### Button — `.gl-btn`

Primary action element. Available in 4 variants and 3 sizes.

| Variant | Class | Use |
|---------|-------|-----|
| Primary | `.gl-btn` | Default call to action |
| Secondary | `.gl-btn-secondary` | Alternative action |
| Ghost | `.gl-btn-ghost` | Low emphasis action |
| Danger | `.gl-btn-danger` | Destructive action |

Sizes: `.gl-btn-sm`, `.gl-btn-md` (default), `.gl-btn-lg`.

Icon-only button: `.gl-btn-icon` — square aspect ratio, same size classes.

```html
<button class="gl-btn">Primary</button>
<button class="gl-btn gl-btn-secondary">Secondary</button>
<button class="gl-btn gl-btn-ghost">Ghost</button>
<button class="gl-btn gl-btn-danger">Danger</button>
<button class="gl-btn gl-btn-sm">Small</button>
<button class="gl-btn gl-btn-lg">Large</button>
<button class="gl-btn gl-btn-icon" aria-label="Settings">⚙</button>
```

### Badge — `.gl-badge`

Status and tier labels. Available in 9 color variants plus a dot indicator.

| Variant | Class | Use |
|---------|-------|-----|
| Free | `.gl-badge-free` | Free tier label |
| Budget | `.gl-badge-budget` | Budget tier label |
| Mid | `.gl-badge-mid` | Mid tier label |
| Premium | `.gl-badge-premium` | Premium tier label |
| Success | `.gl-badge-success` | Positive status |
| Warning | `.gl-badge-warning` | Warning status |
| Error | `.gl-badge-error` | Error status |
| Info | `.gl-badge-info` | Informational |
| Neutral | `.gl-badge-neutral` | Default / muted |

Dot indicator: `.gl-badge-dot` — small colored dot, same variant classes.

```html
<span class="gl-badge gl-badge-free">Free</span>
<span class="gl-badge gl-badge-premium">Premium</span>
<span class="gl-badge gl-badge-success">Active</span>
<span class="gl-badge-dot gl-badge-success">Online</span>
```

### Card — `.gl-card`

Content container with header/body/footer sections. 3 variants.

| Variant | Class | Use |
|---------|-------|-----|
| Default | `.gl-card` | Standard content container |
| Accent | `.gl-card-accent` | Purple top border highlight |
| Elevated | `.gl-card-elevated` | Raised shadow for emphasis |

```html
<div class="gl-card">
  <div class="gl-card-header">Card Title</div>
  <div class="gl-card-body">Card content goes here.</div>
  <div class="gl-card-footer">
    <button class="gl-btn">Action</button>
  </div>
</div>

<div class="gl-card gl-card-accent">
  <div class="gl-card-header">Accent Card</div>
  <div class="gl-card-body">Purple top border highlight.</div>
</div>
```

### Table — `.gl-table`

Full-width data table with sticky headers, hover rows, and sortable columns.

```html
<table class="gl-table">
  <thead>
    <tr>
      <th class="gl-table-sortable">Name <span class="gl-table-sort-icon">↑</span></th>
      <th>Status</th>
      <th>Actions</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Item</td>
      <td><span class="gl-badge gl-badge-success">Active</span></td>
      <td><button class="gl-btn gl-btn-ghost gl-btn-sm">Edit</button></td>
    </tr>
  </tbody>
</table>

<!-- Empty state -->
<div class="gl-table-empty">
  <p>No results found.</p>
</div>
```

### Modal — `.gl-modal-backdrop` + `.gl-modal`

Overlay dialog with backdrop. 3 sizes.

| Size | Class |
|------|-------|
| Small | `.gl-modal-sm` |
| Medium | `.gl-modal` (default) |
| Large | `.gl-modal-lg` |

```html
<div class="gl-modal-backdrop">
  <div class="gl-modal">
    <div class="gl-modal-header">
      <h2>Modal Title</h2>
      <button class="gl-btn gl-btn-ghost gl-btn-icon" aria-label="Close">&times;</button>
    </div>
    <div class="gl-modal-body">
      <p>Modal content goes here.</p>
    </div>
    <div class="gl-modal-footer">
      <button class="gl-btn gl-btn-ghost">Cancel</button>
      <button class="gl-btn">Confirm</button>
    </div>
  </div>
</div>
```

### Input — `.gl-input`

Text input with hover, focus, disabled, and error states.

| Variant | Class | Use |
|---------|-------|-----|
| Default | `.gl-input` | Standard text input |
| Search | `.gl-input-search` | Search field with icon |
| Error | `.gl-input.gl-input-error` | Validation error state |
| Disabled | `.gl-input[disabled]` | Disabled state |

Icon wrapper: `.gl-input-wrapper` — positions an icon inside the input.

```html
<div class="gl-input-wrapper">
  <span class="gl-input-icon">🔍</span>
  <input class="gl-input gl-input-search" type="search" placeholder="Search...">
</div>
<input class="gl-input" type="text" placeholder="Name">
<input class="gl-input gl-input-error" type="text" value="Invalid input">
<input class="gl-input" type="text" disabled value="Disabled">
```

### Select — `.gl-select`

Styled dropdown matching the input aesthetic.

```html
<select class="gl-select">
  <option>Option 1</option>
  <option>Option 2</option>
</select>
<select class="gl-select gl-input-error">
  <option>Error state</option>
</select>
```

### Tabs — `.gl-tabs-bar` + `.gl-tab`

Tab navigation in two styles.

| Style | Class | Use |
|-------|-------|-----|
| Underline | `.gl-tabs-bar` | Default — underline indicator |
| Pill | `.gl-tabs-pills` | Filled pill tabs |

```html
<div class="gl-tabs-bar" role="tablist">
  <button class="gl-tab active" role="tab">Active</button>
  <button class="gl-tab" role="tab">Inactive</button>
  <button class="gl-tab" role="tab">Disabled</button>
</div>

<div class="gl-tabs-pills" role="tablist">
  <button class="gl-tab active" role="tab">Pill 1</button>
  <button class="gl-tab" role="tab">Pill 2</button>
</div>
```

### Toast — `.gl-toast`

Notification with left border accent. 4 variants.

| Variant | Class | Use |
|---------|-------|-----|
| Success | `.gl-toast-success` | Green left border |
| Warning | `.gl-toast-warning` | Yellow left border |
| Error | `.gl-toast-error` | Red left border |
| Info | `.gl-toast-info` | Blue left border |

```html
<div class="gl-toast gl-toast-success">
  <span class="gl-toast-icon">✓</span>
  <div class="gl-toast-content">
    <p class="gl-toast-title">Saved</p>
    <p class="gl-toast-message">Changes applied successfully.</p>
  </div>
  <button class="gl-toast-dismiss" aria-label="Dismiss">&times;</button>
</div>
```

### Spinner — `.gl-spinner`

CSS-only rotating border animation. 3 sizes.

| Size | Class |
|------|-------|
| Small | `.gl-spinner-sm` |
| Medium | `.gl-spinner` (default) |
| Large | `.gl-spinner-lg` |

```html
<div class="gl-spinner gl-spinner-sm" aria-label="Loading"></div>
<div class="gl-spinner" aria-label="Loading"></div>
<div class="gl-spinner gl-spinner-lg" aria-label="Loading"></div>
```

### Empty State — `.gl-empty`

Centered empty state with icon, title, description, and optional action.

```html
<div class="gl-empty">
  <div class="gl-empty-icon">📂</div>
  <h3 class="gl-empty-title">No data yet</h3>
  <p class="gl-empty-desc">Get started by creating your first item.</p>
  <button class="gl-btn">Create Item</button>
</div>
```

## Layout Utilities

### Page Shell
```html
<div class="gl-page">
  <div class="gl-page-header">
    <h1>Page Title</h1>
    <div class="gl-flex gl-gap-2">
      <button class="gl-btn">Action</button>
    </div>
  </div>
  <div class="gl-page-content">
    <!-- Page content -->
  </div>
</div>
```

### Grid
```html
<div class="gl-grid gl-grid-cols-2 gl-gap-4">
  <div class="gl-card">Column 1</div>
  <div class="gl-card">Column 2</div>
</div>
```

| Class | Columns |
|-------|---------|
| `.gl-grid-cols-1` | 1 column |
| `.gl-grid-cols-2` | 2 columns |
| `.gl-grid-cols-3` | 3 columns |
| `.gl-grid-cols-4` | 4 columns |

### Flex
```html
<div class="gl-flex gl-items-center gl-justify-between gl-gap-4">
  <h2>Section Title</h2>
  <button class="gl-btn">Action</button>
</div>
```

| Class | Value |
|-------|-------|
| `.gl-flex` | `display: flex` |
| `.gl-flex-col` | `flex-direction: column` |
| `.gl-items-center` | `align-items: center` |
| `.gl-justify-between` | `justify-content: space-between` |
| `.gl-gap-1` through `-6` | `gap: 4px` through `24px` |

### Text
```html
<p class="gl-text-sm gl-text-muted">Small muted text</p>
<h2 class="gl-text-2xl gl-font-bold">Large heading</h2>
```

| Class | Purpose |
|-------|---------|
| `.gl-text-xs` through `-3xl` | Font size scale |
| `.gl-font-normal`, `-medium`, `-semibold`, `-bold` | Font weight |
| `.gl-text-muted` | Muted secondary text |
| `.gl-text-accent` | Purple accent text |
| `.gl-text-danger` | Red error text |
| `.gl-text-success` | Green success text |

### Spacing
```html
<div class="gl-p-4 gl-m-2">Padded and margined</div>
<div class="gl-mx-auto" style="max-width: 800px">Centered container</div>
```

Scale: `gl-p-1` (4px) through `gl-p-8` (32px). Same for `gl-m-*` and `gl-gap-*`.

### Border & Display
```html
<div class="gl-border gl-rounded-lg">Bordered card</div>
<div class="gl-hidden gl-sm:block">Visible on sm+ screens</div>
```

| Class | Purpose |
|-------|---------|
| `.gl-border` | 1px solid border (subtle) |
| `.gl-rounded-sm`, `-md`, `-lg`, `-xl`, `-full` | Border radius scale |
| `.gl-hidden` | `display: none` |
| `.gl-block` | `display: block` |
| `.gl-sm:block` | `display: block` on sm+ |
| `.gl-md:hidden` | `display: none` on md+ |

## Usage Guidelines

- Always import `tokens.css` first, then `components.css`, then `layout.css`
- Use `var(--glitch-*)` tokens for custom styles
- All interactive elements need `:focus-visible` styles
- Respect `prefers-reduced-motion`
- No external dependencies — system fonts only

## Viewing the Showcase

Open `index.html` in any browser to see all components with live examples and code snippets.

---

**License**: MIT — part of the Glitch AI project
