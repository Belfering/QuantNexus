# PRD 002 - Community Tab (Watchlists View)

## Metadata
- ID: 002
- Title: Community tab watchlists view
- Status: draft
- Owner:
- Depends on: watchlists data model + backtest metrics (implemented)
- Created: 2025-12-15
- Last updated: 2025-12-17

## Summary
Add a grid-based Community tab: left shows system “Top Community Bots” placeholders, middle columns host news/search placeholders, and right shows personal watchlist placeholders. From the metric areas, users can add bots to a personal watchlist or open them in Analyze. Community-marked bots cannot expose code or go to Build.

## Goals
- Provide a predictable navigation area for curated and user-created lists.
- Respect per-user scope while still surfacing system lists to all users.
- Ship an initial placeholder layout while wiring data.

## Non-goals
- Social features (comments, likes, follows) unless explicitly added.

## UX / UI
- Page uses a 4-column by 3-row grid (equal widths/heights):
  - Column 1: header "Top Community Bots" at the top; below it, three equal-height bubbles stacked vertically:
    - "Top community bots by CAGR" (sortable table header only; empty rows until data is wired)
    - "Top community bots by Calmar Ratio" (sortable table header only; empty rows until data is wired)
    - "Top community bots by Sharpe Ratio" (sortable table header only; empty rows until data is wired)
  - Columns 2-3 (double width): two bubbles stacked vertically; top bubble spans two rows with text "News and Select Bots"; bottom bubble spans one row with text "Search for other community bots by metrics or by Builder's names."
  - Column 4: header "Personal Watchlists" at the top; below it, two equal-height bubbles:
    - Watchlist Zone #1: dropdown to select any saved watchlist, then show bots in a sortable table
    - Watchlist Zone #2: dropdown to select any saved watchlist, then show bots in a sortable table
- Each table (both Top Community and Personal Watchlists) uses the same sortable columns:
  - `Name`
  - `Tags`
  - `OOS CAGR`
  - `OOS MaxDD`
  - `OOS Sharpe`
- In each bubble, the table header should sit directly under the bubble title and rows should populate downward (avoid bottom-anchoring behavior).
- Community tab displays **only OOS stats** (no historical metrics in this view).
- Predefined watchlists (system) back the metric-based sections; placeholders swap to computed lists when data exists: `BrianE`, `Best CAGR`, `Best Sharpe`, `Best CAGR/DD`.
- Custom watchlists for the logged-in user appear in the right column bubbles via selector.
- Each list shows bot names it contains and allows removing a bot from that watchlist.
- Actions on community bots: `Add to my watchlist` and `View in Analyze`. No “Go to Build” for community-marked bots (code hidden).

## Data Model / State
- Uses per-user watchlists from the current app state.
- System lists are computed from saved bots + backtest results but still visible to all users.

## Acceptance Criteria
- Community tab renders the 4x3 grid layout with the specified section titles.
- Metric sections are ready to swap placeholders for computed lists (`Best CAGR`, `Best Sharpe`, `Best CAGR/DD`, `BrianE`) when data is available.
- Left column Top Community bubbles show the sortable header columns but no rows until data is wired.
- Right column Watchlist zones each have a dropdown to select any saved watchlist and show bots in that watchlist in a sortable table (Name/Tags/OOS CAGR/OOS MaxDD/OOS Sharpe).
- From a community list entry, user can add to a personal watchlist and open in Analyze; “Go to Build” is not available for community-marked bots.
- Community-marked bots do not expose code in this view.

## Open Questions
- Should the predefined lists be clickable (navigating to a list detail view) or just visible sections?
- How many bots per list are shown in v1 (e.g., top 10)?

## Implementation Notes / Recommended UI & Libraries
- Layout: responsive grid; collapse to stacked sections on small screens while preserving the placeholder order.
- Lists: virtualize if counts grow (e.g., `react-window`/`react-virtualized`); otherwise paginated sections.
- Actions: buttons per row for `Add to my watchlist` and `View in Analyze`; hide/remove any Build action for community bots.
- Indicators: badge on community bots to signal code hidden; tooltip to explain why Build is unavailable.
- Data: reuse backtest metrics; cache/fetch via TanStack Query.


