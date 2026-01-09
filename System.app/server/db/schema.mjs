import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'

// ============================================
// USERS
// ============================================
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  email: text('email').unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name'),
  role: text('role', { enum: ['user', 'engineer', 'sub_admin', 'main_admin', 'partner'] }).default('user'),
  isPartnerEligible: integer('is_partner_eligible', { mode: 'boolean' }).default(false),
  emailVerified: integer('email_verified', { mode: 'boolean' }).default(false),
  status: text('status').default('pending_verification'), // pending_verification, active, suspended
  tier: text('tier').default('free'), // free, pro, premium
  inviteCodeUsed: text('invite_code_used'),
  termsAcceptedAt: integer('terms_accepted_at', { mode: 'timestamp' }),
  privacyAcceptedAt: integer('privacy_accepted_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  lastLoginAt: integer('last_login_at', { mode: 'timestamp' }),
  // UI Preferences (stored directly on user for simplicity)
  theme: text('theme').default('dark'),
  colorScheme: text('color_scheme').default('slate'),
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
// WAITLIST ENTRIES
// ============================================
export const waitlistEntries = sqliteTable('waitlist_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  position: integer('position').notNull(),
  referralCode: text('referral_code'),
  referredBy: integer('referred_by'),
  status: text('status').default('pending'), // pending, invited, registered, unsubscribed
  source: text('source'), // How they found us
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  invitedAt: integer('invited_at', { mode: 'timestamp' }),
  registeredAt: integer('registered_at', { mode: 'timestamp' }),
})

// ============================================
// INVITE CODES
// ============================================
export const inviteCodes = sqliteTable('invite_codes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').notNull().unique(),
  waitlistId: integer('waitlist_id'),
  createdBy: text('created_by'),
  maxUses: integer('max_uses').default(1),
  useCount: integer('use_count').default(0),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// ============================================
// EMAIL VERIFICATION TOKENS
// ============================================
export const emailVerificationTokens = sqliteTable('email_verification_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// ============================================
// USER SESSIONS (for JWT refresh tokens)
// ============================================
export const userSessions = sqliteTable('user_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  refreshTokenHash: text('refresh_token_hash').notNull(),
  deviceInfo: text('device_info'),
  ipAddress: text('ip_address'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// ============================================
// OAUTH ACCOUNTS (Google, Discord, GitHub)
// ============================================
export const oauthAccounts = sqliteTable('oauth_accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider', { enum: ['google', 'discord', 'github'] }).notNull(),
  providerAccountId: text('provider_account_id').notNull(),
  email: text('email'),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// ============================================
// TICKER REGISTRY (Tiingo Master List)
// ============================================
export const tickerRegistry = sqliteTable('ticker_registry', {
  ticker: text('ticker').primaryKey(),
  name: text('name'),                      // Company name (e.g., "Apple Inc.")
  description: text('description'),        // Company description
  exchange: text('exchange'),              // NYSE, NASDAQ, AMEX, ARCA, BATS
  assetType: text('asset_type'),           // Stock, ETF (Mutual Funds excluded)
  currency: text('currency'),              // USD, CNY, etc.
  startDate: text('start_date'),           // First available date in Tiingo
  endDate: text('end_date'),               // Last available date in Tiingo
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  lastSynced: text('last_synced'),         // When we last downloaded OHLCV data
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// ============================================
// OPTIMIZATION JOBS (Branch Generation Results)
// ============================================
export const optimizationJobs = sqliteTable('optimization_jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  botId: text('bot_id').notNull(),
  botName: text('bot_name').notNull(),
  status: text('status').notNull(), // 'running' | 'completed' | 'error' | 'cancelled'
  totalBranches: integer('total_branches').notNull(),
  completedBranches: integer('completed_branches').notNull(),
  passingBranches: integer('passing_branches').notNull(),
  startTime: integer('start_time').notNull(), // Unix timestamp in ms
  endTime: integer('end_time'),
  errorMessage: text('error_message'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

export const optimizationResults = sqliteTable('optimization_results', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  jobId: integer('job_id').notNull().references(() => optimizationJobs.id, { onDelete: 'cascade' }),
  branchId: text('branch_id').notNull(),
  parameterLabel: text('parameter_label').notNull(), // e.g., "window=14, threshold=70"
  parameterValues: text('parameter_values').notNull(), // JSON stringified Record<string, number>
  // IS Metrics (In-Sample)
  isCagr: real('is_cagr'),
  isSharpe: real('is_sharpe'),
  isCalmar: real('is_calmar'),
  isMaxDrawdown: real('is_max_drawdown'),
  isSortino: real('is_sortino'),
  isTreynor: real('is_treynor'),
  isBeta: real('is_beta'),
  isVolatility: real('is_volatility'),
  isWinRate: real('is_win_rate'),
  isAvgTurnover: real('is_avg_turnover'),
  isAvgHoldings: real('is_avg_holdings'),
  // OOS Metrics (Out-of-Sample)
  oosCagr: real('oos_cagr'),
  oosSharpe: real('oos_sharpe'),
  oosCalmar: real('oos_calmar'),
  oosMaxDrawdown: real('oos_max_drawdown'),
  oosSortino: real('oos_sortino'),
  oosTreynor: real('oos_treynor'),
  oosBeta: real('oos_beta'),
  oosVolatility: real('oos_volatility'),
  oosWinRate: real('oos_win_rate'),
  oosAvgTurnover: real('oos_avg_turnover'),
  oosAvgHoldings: real('oos_avg_holdings'),
  // Status
  passed: integer('passed', { mode: 'boolean' }).notNull(),
  failedRequirements: text('failed_requirements'), // JSON array
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
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

export const optimizationJobsRelations = relations(optimizationJobs, ({ many }) => ({
  results: many(optimizationResults),
}))

export const optimizationResultsRelations = relations(optimizationResults, ({ one }) => ({
  job: one(optimizationJobs, { fields: [optimizationResults.jobId], references: [optimizationJobs.id] }),
}))
