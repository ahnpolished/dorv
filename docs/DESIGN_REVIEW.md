# Design Review — dorv v0.3.0

Performed 2026-07-04 against the v0.3.0 rewrite worktree.
All surfaces audited: GitHub buttons, GDoc buttons, Options page.

---

## 1. Current UI Inventory

### 1.1 GitHub-side buttons (`github-buttons.content.tsx`)

Injected inline next to each markdown file header in the PR Files Changed tab.

| State | Visual | Interaction |
|-------|--------|-------------|
| `loading` | Hidden (null render) | — |
| `no-creds` | 📄 button, 0.5 opacity | Click → open options page |
| `no-doc` | 📄 button, orange tint | Click → create Google Doc |
| `linked` | 📄 + 🔄 buttons, side by side | Open doc / sync |
| Error | ⚠️ emoji with tooltip | Hover for error text |

**Token usage:** `--dorv-*` CSS custom properties via `tokens.css`. Font: DM Sans (from extension's font stack), not GitHub Primer.

### 1.2 GDoc-side buttons (`gdoc-buttons.content.tsx`)

Injected onto each unsynced comment card in the Google Docs comment sidebar.

| State | Visual | Interaction |
|-------|--------|-------------|
| Unsaved | "Push to GitHub" button, Google Blue (#1a73e8) | Click → push comment |
| Pushing | "Pushing…" disabled | — |
| Synced | "✓ synced to GitHub" green text | — |
| Error | "dorv: <message>" red text | — |

**Token usage:** Hardcoded values (not tokens.css). Font: Google Sans, 11px. Color: #1a73e8. ✅ Respects Linear specs.

### 1.3 Options page (`options.html` + `options.tsx` + `options.css`)

Standalone extension page accessible via `chrome-extension://<id>/options.html`.

| Section | Contents |
|---------|----------|
| Header | dorv SVG logo (48px), "dorv" eyebrow in mono, h1 "Extension Settings" |
| GitHub Auth | PAT password input, "Validate & Save" button |
| Google Auth | Profile card (avatar + name + email), Connect/Disconnect button |
| Advanced | Backend URL input, "Save Backend URL" button, "Set by IT" badge |

**Token usage:** Imports `tokens.css` + `animations.css`. Colors: light bg (#f1f5f9), white cards, orange accent (#f97316). Font: DM Sans, Geist Mono for code. Skeleton loader on initial mount.

### 1.4 Design tokens (`lib/design/tokens.css`)

Well-structured CSS custom properties covering backgrounds, text, borders, radii, shadows, fonts, and semantic states (error, warning, success). Dual-targeted to `:root` (options page) and `:host` (shadow DOM — for the now-removed sidebar). Dark-mode tokens (#111827 backgrounds) are present but only the options page uses light-token overrides.

### 1.5 Animations (`lib/design/animations.css`)

Keyframe-based, all CSS, no JS library. Includes spin, slide-in, pulse, fade-in, check-draw, and shimmer. `prefers-reduced-motion` respected. Good system.

---

## 2. UX Pain Points

### P0 – Critical usability

**2.1 GitHub buttons are invisible and undiscoverable.**
The file buttons render at `opacity: 0.5` with emoji-only icons (📄 🔄 ⚠️) and no text labels. On hover they go to `opacity: 1` with a subtle background. This is nearly invisible against GitHub's busy diff UI. A new user scanning a PR file list has zero chance of discovering these buttons without prior knowledge. The original side panel was prominent; the v0.3.0 buttons are camouflaged.

**2.2 Same icon for "Create Doc" and "Open Doc".**
Both states render 📄. The only visual difference is tint color (orange vs default). There is no way to distinguish "I need to create a doc for this file" from "I've already linked a doc" without clicking.

**2.3 No stale-PR warning in the button UI.**
The architecture tracks `isStale` but the file buttons never surface it. There's a `.dorv-stale-badge` CSS class with a pulse animation defined in `animations.css`, but nothing in the React component renders it. Users won't know their doc content is out of date.

### P1 – Polish gaps

**2.4 Skeleton loader renders wrong theme.**
The options page skeleton uses `var(--dorv-border)` and `var(--dorv-bg-elevated)` which are dark-theme tokens (#111827 range). On the light options page, the shimmer renders as a dark gradient on a light background — visually broken and unprofessional.

**2.5 GDoc buttons are very small.**
11px font, 2px padding, tiny hit target. On high-DPI displays or for users with less-than-perfect vision, these are hard to read and hard to click. Google Docs' own comment UI uses ~13px text with generous padding.

**2.6 No transition between `no-doc` and `linked` states.**
When a doc is created, the button disappears and reappears via React re-render. The `.dorv-state-enter` fade-in fires but the button _changes shape_ (single button → two buttons) without a smooth transition. The layout pops.

**2.7 Error states are emoji-only with no recovery action.**
When create or sync fails, the UI shows ⚠️ with a tooltip. There's no "retry" button, no error message visible without hover, and no way to dismiss the error. The user has to reload the page.

**2.8 Options page has no navigation or context.**
The options page is a dead-end. There's no link back to GitHub, no status overview of linked PRs, no "what's next" guidance. After setting up auth, the user sees... nothing. They have to remember to go back to a PR and find the buttons.

### P2 – Visual inconsistency

**2.9 Mixed design languages across surfaces.**
- GitHub buttons: dorv's own design tokens (orange, DM Sans) — doesn't match GitHub Primer
- GDoc buttons: Google Sans, Google Blue (#1a73e8) — ✅ matches Google Docs
- Options page: dorv orange + light theme — its own thing

This is partly by design (match the host surface), but the GitHub buttons don't actually match GitHub. They use dorv tokens when they should use Primer.

**2.10 Logo is dark-theme on light background.**
The `dorv.svg` icon has a #111827 background fill. On the options page's white card, this creates a dark rectangle that clashes with the light theme. The icon should have a transparent or adaptive background.

---

## 3. Design Recommendations

### 3.1 GitHub buttons — make them visible and GitHub-native

**Problem:** Buttons are too subtle (emoji-only, 0.5 opacity).

**Fix:** Adopt GitHub Primer styling for the GitHub surface:

```css
/* Replace current inline emoji buttons with Primer-styled pill buttons */
.dorv-file-btn-el {
  /* Match GitHub's button styling */
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
  font-weight: 500;
  line-height: 20px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--color-btn-border, #d0d7de);
  background: var(--color-btn-bg, #f6f8fa);
  color: var(--color-btn-text, #24292f);
  opacity: 1; /* No hidden buttons */
}

/* State-specific Primer classes */
.dorv-file-btn-create {
  background: #ddf4ff;      /* GitHub's info/blue subtle */
  border-color: #54aeff;
  color: #0969da;
}
.dorv-file-btn-sync {
  background: #dafbe1;      /* GitHub's success/green subtle */
  border-color: #4ac26b;
  color: #1a7f37;
}
.dorv-file-btn-open {
  color: #0969da;           /* Link blue */
}

/* On hover — match Primer's hover states */
.dorv-file-btn-el:hover:not(:disabled) {
  background: var(--color-btn-hover-bg, #f3f4f6);
}
```

Add text labels:
- `no-doc`: "Create Doc" (not just 📄)
- `linked`: "Open Doc" + "Sync" (not just 📄 + 🔄)
- Error: "Retry" button next to ⚠️

**Scope:** ~30 lines of CSS replacement in the `injectStylesOnce()` template literal, plus React label changes in `FileButton`.

### 3.2 Differentiate Create vs Open icons

Use distinct icons or text labels per state. Minimum viable change:
- `no-doc`: `+` or document-plus icon → "Create Doc"
- `linked`: document-check icon → "Open Doc"
- `syncing`: spinner animation (already exists as `.dorv-spinning`)

If sticking with emoji for MVP:
- `no-doc`: ➕ (plus)
- `linked`: 📄 (document) 
- `sync`: 🔄 (keep)

### 3.3 Surface stale-PR state in buttons

Add a `stale` variant to the `linked` state:

```tsx
{view.kind === "linked" && view.mapping.isStale && (
  <span className="dorv-stale-badge" title="Doc content is stale — PR has new commits">
    ⚡
  </span>
)}
```

Use the existing `.dorv-stale-badge` pulse animation from `animations.css`.

**Scope:** ~5 lines in `FileButton` component.

### 3.4 Fix options page skeleton loader

Replace dark-theme shimmer tokens with light-theme equivalents:

```css
/* In options.css, override .dorv-skeleton for light theme */
.dorv-skeleton {
  animation: dorv-shimmer 1.4s ease-in-out infinite;
  background: linear-gradient(
    90deg,
    #e2e8f0 25%,    /* was var(--dorv-border) — dark */
    #f1f5f9 50%,    /* was var(--dorv-bg-elevated) — dark */
    #e2e8f0 75%
  );
  background-size: 200% 100%;
  border-radius: 6px;
}
```

**Scope:** ~10 lines in `options.css`.

### 3.5 Add post-setup guidance to options page

After a user connects GitHub + Google, show a "next steps" card:

```html
<section class="onboarding-next">
  <h2>You're all set</h2>
  <p>Open any GitHub PR with markdown files. Look for the 
     <strong>Create Doc</strong> button next to each .md file header.</p>
  <a href="https://github.com/ahnpolished/dorv/pulls" 
     class="cta-link">View your PRs →</a>
</section>
```

**Scope:** ~15 lines of JSX in `options.tsx`, gated on `googleConnected && githubPat`.

### 3.6 Smooth state transitions on GitHub buttons

Add a CSS transition to the button container for layout changes:

```css
.dorv-file-btn {
  transition: all 0.15s ease;
}
```

And in the React component, use a key on the state wrapper to trigger enter/exit animations:

```tsx
<span key={view.kind} className="dorv-file-btn dorv-state-enter">
```

**Scope:** 2 CSS lines + 1 JSX attribute.

### 3.7 GDoc button sizing

Increase from 11px/2px padding to 12px/4px padding:

```css
.dorv-push-btn {
  font-size: 12px;
  padding: 3px 10px;
}
```

**Scope:** 2 CSS lines in `ensureStyleInjected()`.

### 3.8 Adaptive logo background

Replace hardcoded dark fill with a transparent version or use CSS:

```css
.options-logo {
  background: #111827;  /* Match the icon's expected bg */
  padding: 4px;
  border-radius: 12px;
}
```

Or, simpler: add a light-background variant SVG (`dorv-light.svg`) and use it conditionally.

**Scope:** 4 CSS lines or one new SVG.

---

## 4. Ahnpolished Org Bar Checklist

Per Linear specs and AGENTS.md: "UI should feel slick and no-fuss (GitHub Primer on GH surfaces; Google Sans / #1a73e8 on Docs side panel)."

| Surface | Spec | Current | Gap |
|---------|------|---------|-----|
| GitHub buttons | GitHub Primer | Custom dorv tokens (orange, DM Sans) | ❌ Rewrite to Primer |
| GDoc buttons | Google Sans, #1a73e8 | ✅ Matches | None |
| Options page | Ahnpolished polish | DM Sans + orange, decent | Skeleton broken, no nav |
| Icon / branding | dorv orange (#f97316) + white/black | ✅ dorv.svg uses correct colors | Dark bg on light cards |
| Animations | Smooth, no jank | ✅ prefers-reduced-motion gated | None — animation system is solid |
| Typography | DM Sans (display), Geist Mono (code) | ✅ Options uses both | GitHub buttons should use system/Primer |

### Must-fix (before dogfood):
1. GitHub buttons: switch to Primer styling + text labels
2. Differentiate Create vs Open button icons
3. Fix skeleton loader (dark on light)
4. Add stale-PR indicator to buttons

### Should-fix (before Phase 1 rollout):
5. Add post-setup guidance to options page
6. Smooth button state transitions
7. GDoc button sizing
8. Adaptive logo background

### Nice-to-have (Phase 2+):
9. Options page PR status overview
10. Keyboard shortcuts for sync
11. Dark mode support for options page

---

## 5. Implementation Priority

| # | Fix | Effort | Impact | Issue |
|---|-----|--------|--------|-------|
| 1 | GitHub Primer buttons + text labels | ~30 lines | P0 discoverability | New |
| 2 | Create vs Open icon differentiation | ~5 lines | P0 clarity | New |
| 3 | Skeleton loader light theme | ~10 lines | P1 visual | New |
| 4 | Stale PR indicator | ~5 lines | P1 trust | New |
| 5 | Post-setup options guidance | ~15 lines | P1 onboarding | New |
| 6 | State transition smoothing | ~3 lines | P2 polish | New |
| 7 | GDoc button sizing | ~2 lines | P2 polish | New |
| 8 | Logo background fix | ~4 lines | P2 consistency | New |

**Total estimated effort:** ~70 lines changed across 4 files.
**Files touched:** `github-buttons.content.tsx`, `gdoc-buttons.content.tsx`, `options.css`, `options.tsx`.

None of these recommendations require backend, storage, or adapter changes.
They are pure CSS + minimal React label changes.
