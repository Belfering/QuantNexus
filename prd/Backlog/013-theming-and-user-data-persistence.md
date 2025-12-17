# PRD 013 - Theming Toggle + Per-Profile Persistence

## Metadata
- ID: 013
- Title: Theming toggle + per-profile persistence
- Status: draft
- Owner:
- Depends on:
- Created: 2025-12-15
- Last updated: 2025-12-15

## Summary
Add a global light/dark mode toggle next to the `System.app` brand and introduce per-profile storage for bots/layouts so profiles reliably reload saved work. Provide a lightweight, clearable persistence layer (e.g., user-data temp folder) to avoid recreating profiles during testing.

## Goals
- Quick theming switch visible at top-left beside the brand.
- Persist bots/layouts per profile id so reopening profile `1` or `9` restores prior state.
- Make stored data easy to clear for testing (temp folder or clear-data control).

## Non-goals
- Multi-tenant auth beyond current simulated users.
- Cloud sync or cross-device storage (local-only for now).

## UX / UI
- Header: add `Light/Dark` toggle next to `System.app`; show current mode state.
- Persistence controls: add `Clear saved data` per profile somewhere unobtrusive (e.g., settings menu or user badge dropdown).
- On load: auto-restore last saved bots/layouts for the active profile; show a brief toast if nothing is saved.

## Data Model / State
- Theme: `theme` in UI state (`light` | `dark`), persisted per profile (switching profiles restores each profile’s theme).
- Profile data root: per-profile storage (local-only) containing:
  - Saved bots with metadata (name, tags such as `private`, `builderId`).
  - Layout/graph state for Build tab.
  - UI prefs (collapsed/expanded, selected watchlist, etc.).
- Provide a clear function to wipe the active profile’s stored data without touching other users.

## Acceptance Criteria
- Toggle appears next to `System.app`, switches theme app-wide, and persists selection between sessions.
- Saving/loading bots/layouts works per profile; reopening profile restores its saved data without recreating bots.
- A clear-data action wipes the active profile’s stored data (including theme) and confirms completion.

## Open Questions
- Storage medium: plain JSON files in a temp folder vs IndexedDB/localStorage; pick one and document wipe steps.

## Implementation Notes / Recommended UI & Libraries
- Theme: use CSS variables with a root class toggle; persist in the active profile’s UI state.
- Persistence: wrap existing stores in a profile-aware persistence layer (localStorage/IndexedDB/filesystem JSON). Expose a `clearProfileData(profileId)` helper and wire it to UI.
- Guard against git-ignored data loss: store outside tracked paths (e.g., `System.app/userData/`) and ensure `.gitignore` covers it.
