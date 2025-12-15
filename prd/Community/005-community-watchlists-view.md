# PRD 005 — Community Tab (Watchlists View)

## Metadata
- ID: 005
- Title: Community tab watchlists view
- Status: draft
- Owner:
- Depends on: PRD 004 (watchlists data model), PRD 007 (backtest metrics)
- Created: 2025-12-15
- Last updated: 2025-12-15

## Summary
Add a two-column Community tab: left shows system “Top Community Bots by [metric]” watchlists; right shows a personal watchlist bubble with a selector to switch between the user’s watchlists. From the left, users can add bots to a personal watchlist or open them in Analyze. Community-marked bots cannot expose code or go to Build (no “go to Build” action).

## Goals
- Provide a predictable navigation area for curated and user-created lists.
- Respect per-user scope while still surfacing system lists to all users.

## Non-goals
- Social features (comments, likes, follows) unless explicitly added.

## UX / UI
- Two-column layout:
  - Left: “Top Community Bots by [metric]” lists (system/predefined).
  - Right: personal watchlist bubble with a selector at top to switch among the user’s watchlists.
- Predefined watchlists (system) always appear: `BrianE`, `Best CAGR`, `Best CAGR/DD`, `Best Sharpe` (computed, not placeholders).
- Custom watchlists for the logged-in user appear in the right bubble via selector.
- Each list shows bot names it contains and allows removing a bot from that watchlist.
- Actions on community bots: `Add to my watchlist` and `View in Analyze`. No “Go to Build” for community-marked bots (code hidden).

## Data Model / State
- Uses per-user watchlists from PRD 004.
- System lists are computed from saved bots + backtest results (PRD 007) but still visible to all users.

## Acceptance Criteria
- Community tab displays the 4 predefined watchlists on the left; computed from saved bots using backtest metrics:
  - `Best CAGR`: sort descending by CAGR.
  - `Best Sharpe`: sort descending by Sharpe (definition TBD in PRD 007).
  - `Best CAGR/DD`: sort descending by `CAGR / MaxDrawdownAbs` (definition TBD in PRD 007).
  - `BrianE`: system-curated list (implementation detail TBD).
- Right bubble shows the logged-in user’s watchlists with a selector to switch between them; lists bots and supports remove.
- From a community list entry, user can add to a personal watchlist and open in Analyze; “Go to Build” is not available for community-marked bots.
- Community-marked bots do not expose code in this view.

## Open Questions
- Should the predefined lists be clickable (navigating to a list detail view) or just visible sections?
- How many bots per list are shown in v1 (e.g., top 10)?

## Implementation Notes / Recommended UI & Libraries
- Layout: responsive two-column; stack on small screens with system lists first, personal bubble second.
- Lists: virtualize if counts grow (e.g., `react-window`/`react-virtualized`); otherwise paginated sections.
- Actions: buttons per row for “Add to my watchlist” (opens PRD 004 combobox) and “View in Analyze”; hide/remove any Build action for community bots.
- Indicators: badge on community bots to signal code hidden; tooltip to explain why Build is unavailable.
- Data: reuse backtest metrics from PRD 007; cache/fetch via TanStack Query.
