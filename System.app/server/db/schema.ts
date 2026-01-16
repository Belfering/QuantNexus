import { sqliteTable, text, integer, real, blob } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'

// ============================================
// USERS
// ============================================
export const users = sqliteTable('users', {
  id: text('id').primaryKey(), // UUID or simple ID like '1', '3', etc.
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name'),
  role: text('role', { enum: ['user', 'engineer', 'sub_admin', 'main_admin', 'partner'] }).default('user'),
  isPartnerEligible: integer('is_partner_eligible', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  lastLoginAt: integer('last_login_at', { mode: 'timestamp' }),
})

// ============================================
// BOTS (Trading Strategies)
// ============================================
export const bots = sqliteTable('bots', {
  id: text('id').primaryKey(), // UUID
  ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),

  // Visibility & Tags (stored as JSON string)
  visibility: text('visibility', { enum: ['private', 'nexus_eligible', 'nexus', 'atlas'] }).default('private'),
  tags: text('tags'), // JSON array as string: '["Nexus", "tag1"]'

  // The actual strategy payload (JSONB equivalent)
  payload: text('payload').notNull(), // JSON string of FlowNode

  // Partner Program
  fundSlot: integer('fund_slot'),

  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  publishedAt: integer('published_at', { mode: 'timestamp' }),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
})

// ============================================
// BOT METRICS (Denormalized for fast queries)
// ============================================
export const botMetrics = sqliteTable('bot_metrics', {
  botId: text('bot_id').primaryKey().references(() => bots.id, { onDelete: 'cascade' }),

  // Core metrics
  cagr: real('cagr'),
  maxDrawdown: real('max_drawdown'),
  calmarRatio: real('calmar_ratio'),
  sharpeRatio: real('sharpe_ratio'),
  sortinoRatio: real('sortino_ratio'),
  treynorRatio: real('treynor_ratio'),
  volatility: real('volatility'),
  winRate: real('win_rate'),
  avgTurnover: real('avg_turnover'),
  avgHoldings: real('avg_holdings'),
  tradingDays: integer('trading_days'),

  // Backtest metadata
  backtestStartDate: text('backtest_start_date'),
  backtestEndDate: text('backtest_end_date'),
  lastBacktestAt: integer('last_backtest_at', { mode: 'timestamp' }),

  // Ranking helpers
  cagrRank: integer('cagr_rank'),
  calmarRank: integer('calmar_rank'),
  sharpeRank: integer('sharpe_rank'),

  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// ============================================
// BOT EQUITY CURVES
// ============================================
export const botEquityCurves = sqliteTable('bot_equity_curves', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  botId: text('bot_id').notNull().references(() => bots.id, { onDelete: 'cascade' }),
  date: text('date').notNull(), // ISO date string
  equity: real('equity').notNull(),
  drawdown: real('drawdown'),
})

// ============================================
// WATCHLISTS
// ============================================
export const watchlists = sqliteTable('watchlists', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

export const watchlistBots = sqliteTable('watchlist_bots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  watchlistId: text('watchlist_id').notNull().references(() => watchlists.id, { onDelete: 'cascade' }),
  botId: text('bot_id').notNull().references(() => bots.id, { onDelete: 'cascade' }),
  addedAt: integer('added_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// ============================================
// PORTFOLIOS (User Investments)
// ============================================
export const portfolios = sqliteTable('portfolios', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  cashBalance: real('cash_balance').default(100000),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

export const portfolioPositions = sqliteTable('portfolio_positions', {
  id: text('id').primaryKey(),
  portfolioId: text('portfolio_id').notNull().references(() => portfolios.id, { onDelete: 'cascade' }),
  botId: text('bot_id').notNull().references(() => bots.id),
  costBasis: real('cost_basis').notNull(),
  shares: real('shares').notNull(),
  entryDate: integer('entry_date', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  exitDate: integer('exit_date', { mode: 'timestamp' }),
  exitValue: real('exit_value'),
})

// ============================================
// USER PREFERENCES / UI STATE
// ============================================
export const userPreferences = sqliteTable('user_preferences', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  theme: text('theme').default('dark'),
  colorScheme: text('color_scheme').default('sapphire'),
  uiState: text('ui_state'), // JSON string
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// ============================================
// ADMIN: ELIGIBILITY REQUIREMENTS
// ============================================
export const eligibilityRequirements = sqliteTable('eligibility_requirements', {
  id: text('id').primaryKey(),
  metric: text('metric').notNull(), // 'cagr', 'max_drawdown', 'live_months', etc.
  comparison: text('comparison').notNull(), // 'at_least', 'at_most'
  value: real('value').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// ============================================
// ADMIN: CONFIG
// ============================================
export const adminConfig = sqliteTable('admin_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(), // JSON string
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedBy: text('updated_by').references(() => users.id),
})

// ============================================
// METRIC VARIABLES (Documentation/Reference)
// ============================================
export const metricVariables = sqliteTable('metric_variables', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  variableName: text('variable_name').notNull().unique(), // Exact name in code (e.g., 'cagr', 'maxDd')
  displayName: text('display_name'), // Human readable (e.g., 'CAGR', 'Max Drawdown')
  description: text('description'), // What it calculates
  formula: text('formula'), // Calculation formula
  sourceFile: text('source_file'), // Where it's calculated
  category: text('category'), // e.g., 'returns', 'risk', 'volatility'
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// ============================================
// SAVED SHARDS (Filtered Branch Collections)
// ============================================
export const savedShards = sqliteTable('saved_shards', {
  id: text('id').primaryKey(), // e.g., "shard-1234567890"
  ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),

  // Source tracking
  sourceJobIds: text('source_job_ids').notNull(), // JSON array of job IDs
  loadedJobType: text('loaded_job_type').notNull(), // 'chronological' | 'rolling'

  // Filtered data (deep copies of branches)
  branches: text('branches').notNull(), // JSON array of branch objects
  branchCount: integer('branch_count').notNull(),

  // Filter metadata (for display)
  filterSummary: text('filter_summary'), // e.g., "Top 10 by Sharpe from RSI Opt"

  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
})

// ============================================
// RELATIONS
// ============================================
export const usersRelations = relations(users, ({ many, one }) => ({
  bots: many(bots),
  watchlists: many(watchlists),
  portfolio: one(portfolios),
  preferences: one(userPreferences),
  savedShards: many(savedShards),
}))

export const savedShardsRelations = relations(savedShards, ({ one }) => ({
  owner: one(users, { fields: [savedShards.ownerId], references: [users.id] }),
}))

export const botsRelations = relations(bots, ({ one, many }) => ({
  owner: one(users, { fields: [bots.ownerId], references: [users.id] }),
  metrics: one(botMetrics),
  equityCurves: many(botEquityCurves),
  watchlistEntries: many(watchlistBots),
  positions: many(portfolioPositions),
}))

export const watchlistsRelations = relations(watchlists, ({ one, many }) => ({
  owner: one(users, { fields: [watchlists.ownerId], references: [users.id] }),
  bots: many(watchlistBots),
}))

export const watchlistBotsRelations = relations(watchlistBots, ({ one }) => ({
  watchlist: one(watchlists, { fields: [watchlistBots.watchlistId], references: [watchlists.id] }),
  bot: one(bots, { fields: [watchlistBots.botId], references: [bots.id] }),
}))

export const portfoliosRelations = relations(portfolios, ({ one, many }) => ({
  owner: one(users, { fields: [portfolios.ownerId], references: [users.id] }),
  positions: many(portfolioPositions),
}))

export const portfolioPositionsRelations = relations(portfolioPositions, ({ one }) => ({
  portfolio: one(portfolios, { fields: [portfolioPositions.portfolioId], references: [portfolios.id] }),
  bot: one(bots, { fields: [portfolioPositions.botId], references: [bots.id] }),
}))

// ============================================
// TYPE EXPORTS
// ============================================
export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Bot = typeof bots.$inferSelect
export type NewBot = typeof bots.$inferInsert
export type BotMetrics = typeof botMetrics.$inferSelect
export type Watchlist = typeof watchlists.$inferSelect
export type Portfolio = typeof portfolios.$inferSelect
export type PortfolioPosition = typeof portfolioPositions.$inferSelect
export type MetricVariable = typeof metricVariables.$inferSelect
export type NewMetricVariable = typeof metricVariables.$inferInsert
export type SavedShard = typeof savedShards.$inferSelect
export type NewSavedShard = typeof savedShards.$inferInsert
