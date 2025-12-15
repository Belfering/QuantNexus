# PRD 003 — Analyze Tab (Collapsible Bot Cards + Performance)

## Metadata
- ID: 003
- Title: Analyze tab (collapsible bot cards + performance)
- Status: draft
- Owner:
- Depends on: PRD 004 (watchlists), PRD 007 (backtesting)
- Created: 2025-12-15
- Last updated: 2025-12-15

## Summary
Rename `Bot Database` to `Analyze` and render bots as collapsible cards instead of click-to-open. Cards default collapsed; expanding shows performance metrics and a visual backtest equity curve. The view is scoped to the currently logged-in account and lists that user’s watchlisted bots with optional filtering by watchlist. Keep `Open in Build Tab` always visible, plus `Add to Watchlist`.

## Goals
- Make it easy to scan many bots quickly (collapsed cards).
- Evaluate a bot without leaving the tab (expanded metrics + chart).
- Keep `Open in Build Tab` clear and always available.
- Add `Add to Watchlist` with searchable selection and create-new.
- Respect per-user data (login determines bots/watchlists shown).

## Non-goals
- Building the backtesting engine itself (see PRD 007).
- Full watchlist management UI beyond what’s required for `Add to Watchlist` (see PRD 004).

## UX / UI

### Tab name
- Tab label: `Analyze`

### Bot list layout
- Bots shown: all bots on the current user’s watchlists (de-duplicated).
- Filter control at top: dropdown/select for `All` or any watchlist belonging to the current user.
- Each bot row becomes a card with:
  - Left: collapse/expand control (chevron).
  - Title: bot name.
  - Watchlist tags: one chip per watchlist membership with `x` to remove that bot from that watchlist.
  - Actions (always visible): `Open in Build Tab`, `Add to Watchlist`.

### Default state
- Cards start collapsed.
- Collapsed/expanded state persists across sessions (per user).

### Expanded content
- Header line: collapse/expand, bot name, watchlist tags (with remove), same actions as collapsed.
- Real Stats zone: Open in Build (navigates + loads bot), amount invested, buy/sell button, CAGR since investment started, MaxDD since investment started.
- Historical stats: non-interactive equity curve with drawdown overlay and benchmark label.
- Historical backtest zone: the Build “top metrics” block duplicated under the charts (placeholder until Build PRDs wire full metrics).
- Backtest results must reflect correct strategy execution (conditions, tickers, dates); not mock numbers. Expansion may auto-run a backtest if no cached results exist for current inputs.

### Watchlist add flow
- Click `Add to Watchlist` opens a menu/dialog with:
  - `Create New Watchlist`
  - Existing watchlists (searchable/writable input with autocomplete).
- Bots can belong to multiple watchlists but only once per watchlist.

## Data Model / State
- Scoped to logged-in user (see PRD 004 auth).
- Adds per-user `collapsed` UI state for Analyze.
- Uses watchlist membership from PRD 004.
- Performance summary + timeseries source: local compute vs stored (TBD).

## Implementation Notes / Recommended UI & Libraries
- Use existing chart lib (`lightweight-charts`) for equity + drawdown overlay; prefer non-interactive snapshot mode here.
- Data fetch/caching: TanStack Query for backtest results per bot/watchlist filter with request dedupe and stale-time tuning.
- Persistent UI state: localStorage keyed by user for collapsed/expanded state and last-selected watchlist filter.
- Watchlist tags: pill chips with keyboard focus states; removal should be instant and optimistic (roll back on failure).
- Add-to-watchlist menu: combobox pattern (Downshift or Radix Select/Combobox) with typeahead; allow inline create-new.
- Empty/loading: skeleton rows for cards; inline error banners per card when backtest fetch fails.

## Acceptance Criteria
- Tab label reads `Analyze`.
- Bot list entries render as collapsible cards, default collapsed, scoped to current user’s watchlists.
- Filter by watchlist works; `All` shows all bots across the user’s watchlists (de-duped).
- Collapsed card shows bot name, expand/collapse, watchlist tags with remove, and actions (`Open in Build Tab`, `Add to Watchlist`).
- Expanded card shows Real Stats zone (Open in Build, amount invested, buy/sell, CAGR since investment, MaxDD since investment), historical equity + drawdown chart with benchmark label, and the historical backtest metrics block.
- `Open in Build Tab` is visible while collapsed and opens that bot in Build.
- `Add to Watchlist` offers create-new and existing watchlists with type-to-filter autocomplete; bots can be on multiple watchlists but not duplicated within one.

## Open Questions
- Equity curve benchmark choice for the overlay.
- Should auto-run-on-expand be debounced/throttled when rapidly expanding multiple bots?
