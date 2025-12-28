import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'

// ============================================
// USERS
// ============================================
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name'),
  role: text('role', { enum: ['user', 'admin', 'partner'] }).default('user'),
  isPartnerEligible: integer('is_partner_eligible', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  lastLoginAt: integer('last_login_at', { mode: 'timestamp' }),
})

// ============================================
// BOTS (Trading Strategies)
// ============================================
export const bots = sqliteTable('bots', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  visibility: text('visibility', { enum: ['private', 'nexus_eligible', 'nexus', 'atlas'] }).default('private'),
  tags: text('tags'),
  payload: text('payload').notNull(),
  fundSlot: integer('fund_slot'),
  backtestMode: text('backtest_mode').default('CC'), // OO, CC, CO, OC
  backtestCostBps: integer('backtest_cost_bps').default(5), // Transaction cost in basis points
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
  backtestStartDate: text('backtest_start_date'),
  backtestEndDate: text('backtest_end_date'),
  lastBacktestAt: integer('last_backtest_at', { mode: 'timestamp' }),
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
  date: text('date').notNull(),
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
  uiState: text('ui_state'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// ============================================
// CALL CHAINS (Reusable Strategy Components)
// ============================================
export const callChains = sqliteTable('call_chains', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  root: text('root').notNull(), // JSON payload of FlowNode
  collapsed: integer('collapsed', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// ============================================
// ADMIN: ELIGIBILITY REQUIREMENTS
// ============================================
export const eligibilityRequirements = sqliteTable('eligibility_requirements', {
  id: text('id').primaryKey(),
  metric: text('metric').notNull(),
  comparison: text('comparison').notNull(),
  value: real('value').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// ============================================
// ADMIN: CONFIG
// ============================================
export const adminConfig = sqliteTable('admin_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedBy: text('updated_by').references(() => users.id),
})

// ============================================
// RELATIONS
// ============================================
export const usersRelations = relations(users, ({ many, one }) => ({
  bots: many(bots),
  watchlists: many(watchlists),
  callChains: many(callChains),
  portfolio: one(portfolios),
  preferences: one(userPreferences),
}))

export const botsRelations = relations(bots, ({ one, many }) => ({
  owner: one(users, { fields: [bots.ownerId], references: [users.id] }),
  metrics: one(botMetrics, { fields: [bots.id], references: [botMetrics.botId] }),
  equityCurves: many(botEquityCurves),
  watchlistEntries: many(watchlistBots),
  positions: many(portfolioPositions),
}))

export const botMetricsRelations = relations(botMetrics, ({ one }) => ({
  bot: one(bots, { fields: [botMetrics.botId], references: [bots.id] }),
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

export const callChainsRelations = relations(callChains, ({ one }) => ({
  owner: one(users, { fields: [callChains.ownerId], references: [users.id] }),
}))
