# PRD 004 — Watchlists (Create + Add Bots + Autocomplete + Per-User)

## Metadata
- ID: 004
- Title: Watchlists (create + add bots + autocomplete)
- Status: draft
- Owner:
- Depends on:
- Created: 2025-12-15
- Last updated: 2025-12-15

## Summary
Introduce user-scoped watchlists that can contain bots. Provide the minimal feature set to create a watchlist, add a bot to existing or new watchlists via a searchable/writable input, and keep bots de-duplicated within a watchlist while allowing membership in multiple lists. Add a lightweight login gate (accounts “1”/“9” with matching passwords) so each account sees its own watchlists and saved bots.

## Goals
- Fast “add bot to watchlist” workflow.
- Simple, reliable per-user persistence across sessions.
- Support adding a bot to more than one watchlist; prevent duplicates within a single watchlist.
- Support removing a bot from a watchlist anywhere watchlists are shown.
- Simulated login at app launch; wrong password yields an error.

## Non-goals
- Full watchlist management UI (rename, delete, reorder, sharing) unless explicitly added.
- Social/sharing/permissions model unless explicitly added.

## UX / UI

### Login (admin)
- On app/admin launch, prompt for username and password.
- Allowed accounts: username `1` with password `1`; username `9` with password `9`.
- Incorrect combos show an error; successful login continues to app and scopes data to that user.

### Add to Watchlist control
- Menu/dialog includes:
  - `Create New Watchlist`
  - Existing watchlists list
  - Writable/searchable input that filters and autocompletes existing watchlists.
- Selecting `Create New Watchlist` prompts for a name, creates it, and adds the bot.
- “Default” watchlist is always present; freeform new name allowed.

### Build tab integration
- Change “Save” to “Save to Watchlist”.
- Clicking opens dropdown with `Default`, any saved watchlists, and a freeform new name entry.
- Bots can be added to multiple watchlists, but only once per watchlist.

### Membership rules
- A bot may belong to many watchlists.
- A bot may appear only once within any single watchlist (prevent duplicates).
- Removing from a watchlist is available wherever tags are shown (Analyze, Community).

## Data Model / State
- `User` (simulated login): id in {1, 9}; drives isolation of watchlists and saved bots.
- `Watchlist`:
  - `id`
  - `name`
  - `botIds[]`
  - `userId` (ownership)
- Storage: local persistence (per-user) unless/until backend storage exists.
- “Default” watchlist is created per user if absent.

## Acceptance Criteria
- Login prompt appears on launch; only accounts 1/1 and 9/9 succeed; other combos error.
- User sees only their watchlists and saved bots after login.
- User can type to filter watchlists and select one.
- User can create a new watchlist and immediately add a bot to it.
- Watchlists persist across reloads (per user).
- A bot can be added to multiple watchlists, but only once per watchlist (duplicates prevented).
- Remove-from-watchlist is available where tags are shown (Analyze cards, Community lists).
- Build tab “Save to Watchlist” dropdown shows Default, existing lists, and accepts a new name.

## Open Questions
- Should watchlists store bot IDs, bot names, or payload snapshots? (default: IDs; resolve name from saved bot).
- Should default watchlists be deletable/renamable?
- How to handle merge conflicts if backend storage is later added?

## Implementation Notes / Recommended UI & Libraries
- Login prompt: simple modal or gate screen; form validation via `react-hook-form` + `zod`; show current user badge and `Logout` in header; logout clears per-user session and returns to prompt.
- State/persistence: per-user store (e.g., Zustand or TanStack Query + localStorage persistence) keyed by user id for watchlists and saved bots.
- Add-to-watchlist UI: combobox/select with typeahead (Radix Select/Combobox or Downshift); ensure dedupe before commit.
- Default watchlist: auto-create per user on login; keep immutable name unless otherwise decided.
- Concurrency safety: optimistic update with rollback on failure; keep ID-based membership to avoid name collisions.
