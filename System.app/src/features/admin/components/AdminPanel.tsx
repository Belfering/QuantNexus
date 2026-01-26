// src/features/admin/components/AdminPanel.tsx
// Main admin panel component with tabs for Atlas Overview, Nexus Maintenance, Ticker Data, Trading Control, User Management

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { API_BASE } from '@/constants'
import {
  METRIC_LABELS,
  type SavedBot,
  type AdminStatus,
  type AdminAggregatedStats,
  type AdminConfig,
  type TreasuryFeeBreakdown,
  type TreasuryState,
  type EligibilityRequirement,
  type EligibilityMetric,
  type UserId,
} from '@/types'
import { AdminDataPanel } from './AdminDataPanel'
import { useAuthStore, useUIStore, useBotStore } from '@/stores'
import { TickerSearchModal, type TickerMetadata } from '@/shared/components/TickerSearchModal'

export interface AdminPanelProps {
  // Callbacks
  onTickersUpdated?: (tickers: string[]) => void
  onRefreshNexusBots?: () => Promise<void>
  onPrewarmComplete?: () => void
  updateBotInApi: (userId: UserId, bot: SavedBot) => Promise<boolean>
}

export function AdminPanel({
  onTickersUpdated,
  onRefreshNexusBots,
  onPrewarmComplete,
  updateBotInApi,
}: AdminPanelProps) {
  // ─── Stores ───────────────────────────────────────────────────────────────────
  const { userId } = useAuthStore()
  const { adminTab, setAdminTab } = useUIStore()
  const { savedBots, setSavedBots } = useBotStore()
  // Helper to get auth token from either localStorage or sessionStorage
  const getAuthToken = () => localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken')

  const [, setStatus] = useState<AdminStatus | null>(null)
  const [, setTickers] = useState<string[]>([])
  const [parquetTickers, setParquetTickers] = useState<string[]>([])
  const [tickerMetadataMap, setTickerMetadataMap] = useState<Map<string, TickerMetadata>>(new Map())
  const [error, setError] = useState<string | null>(null)

  // Atlas Overview state
  const [adminStats, setAdminStats] = useState<AdminAggregatedStats | null>(null)
  const [adminConfig, setAdminConfig] = useState<AdminConfig>({ atlasFeePercent: 0, partnerProgramSharePercent: 0, eligibilityRequirements: [], atlasFundSlots: [] })
  const [savedConfig, setSavedConfig] = useState<AdminConfig>({ atlasFeePercent: 0, partnerProgramSharePercent: 0, eligibilityRequirements: [], atlasFundSlots: [] })
  const [feeBreakdown, setFeeBreakdown] = useState<TreasuryFeeBreakdown>({ atlasFeesTotal: 0, privateFeesTotal: 0, nexusFeesTotal: 0, nexusPartnerPaymentsTotal: 0 })
  const [treasury, setTreasury] = useState<TreasuryState>({ balance: 100000, entries: [] })
  const [configSaving, setConfigSaving] = useState(false)
  const [treasuryPeriod, setTreasuryPeriod] = useState<'1D' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL'>('ALL')

  // Eligibility requirements state
  const [eligibilityRequirements, setEligibilityRequirements] = useState<EligibilityRequirement[]>([])
  const [liveMonthsValue, setLiveMonthsValue] = useState(0)
  const [newMetric, setNewMetric] = useState<EligibilityMetric>('cagr')
  const [newComparison, setNewComparison] = useState<'at_least' | 'at_most'>('at_least')
  const [newMetricValue, setNewMetricValue] = useState(0)
  const [eligibilitySaving, setEligibilitySaving] = useState(false)

  // FRD-014: Cache management state
  const [cacheStats, setCacheStats] = useState<{ entryCount: number; totalSizeBytes: number; lastRefreshDate: string | null; currentDataDate: string } | null>(null)
  const [cacheRefreshing, setCacheRefreshing] = useState(false)
  const [prewarmRunning, setPrewarmRunning] = useState(false)

  // Ticker Registry state
  const [registryStats, setRegistryStats] = useState<{ total: number; active: number; syncedToday: number; pending: number; lastSync: string | null } | null>(null)
  const [registrySyncing, setRegistrySyncing] = useState(false)
  const [registryMsg, setRegistryMsg] = useState<string | null>(null)
  const [runningDownloadJobs, setRunningDownloadJobs] = useState<{ full?: string; recent?: string; prices?: string; metadata?: string }>({})
  const [jobLogs, setJobLogs] = useState<{ full?: string[]; recent?: string[]; prices?: string[]; metadata?: string[] }>({})

  // Tiingo API Key state
  const [tiingoKeyStatus, setTiingoKeyStatus] = useState<{ hasKey: boolean; loading: boolean }>({ hasKey: false, loading: true })
  const [tiingoKeyInput, setTiingoKeyInput] = useState('')
  const [tiingoKeySaving, setTiingoKeySaving] = useState(false)

  // Sync Schedule state (for simplified admin panel)
  const [syncSchedule, setSyncSchedule] = useState<{
    config: {
      enabled: boolean
      updateTime?: string
      timezone?: string
      batchSize?: number
      sleepSeconds?: number
      tiingoSleepSeconds?: number
      tiingo5d?: {
        enabled: boolean
        updateTime: string
        timezone: string
      }
      tiingoFull?: {
        enabled: boolean
        updateTime: string
        timezone: string
        dayOfMonth: number
      }
    }
    lastSync: {
      yfinance?: { date: string; status: string; syncedCount?: number; tickerCount?: number; timestamp?: string } | null
      tiingo?: { date: string; status: string; syncedCount?: number; tickerCount?: number; timestamp?: string } | null
      tiingo_5d?: { date: string; status: string; syncedCount?: number; tickerCount?: number; timestamp?: string } | null
      tiingo_full?: { date: string; status: string; syncedCount?: number; tickerCount?: number; timestamp?: string } | null
    } | null
    status: { isRunning: boolean; schedulerActive: boolean; currentJob?: { pid: number | null; syncedCount: number; tickerCount: number; startedAt: number; phase?: string; source?: string; mode?: string } }
  } | null>(null)
  const [syncKilling, setSyncKilling] = useState(false)

  // Time picker menu state
  const [timePickerOpen, setTimePickerOpen] = useState<'5d' | 'full' | null>(null)
  const [tempTime5d, setTempTime5d] = useState('18:00')
  const [tempTimeFull, setTempTimeFull] = useState('18:00')

  // Helper function to format time (24h to 12h AM/PM)
  const formatTime = (time24: string): string => {
    const [hours, minutes] = time24.split(':').map(Number)
    const period = hours >= 12 ? 'PM' : 'AM'
    const hours12 = hours % 12 || 12
    return `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`
  }

  // Trading Control state (broker credentials, dry run, live trading)
  // Paper Trading credentials
  const [paperCredentials, setPaperCredentials] = useState<{
    hasCredentials: boolean
    baseUrl: string
    updatedAt?: number
  } | null>(null)
  const [paperApiKey, setPaperApiKey] = useState('')
  const [paperApiSecret, setPaperApiSecret] = useState('')
  const [paperSaving, setPaperSaving] = useState(false)
  const [paperTesting, setPaperTesting] = useState(false)
  const [paperAccount, setPaperAccount] = useState<{
    equity: number
    cash: number
    buyingPower: number
    status: string
  } | null>(null)
  const [paperError, setPaperError] = useState<string | null>(null)

  // Live Trading credentials
  const [liveCredentials, setLiveCredentials] = useState<{
    hasCredentials: boolean
    baseUrl: string
    updatedAt?: number
  } | null>(null)
  const [liveApiKey, setLiveApiKey] = useState('')
  const [liveApiSecret, setLiveApiSecret] = useState('')
  const [liveSaving, setLiveSaving] = useState(false)
  const [liveTesting, setLiveTesting] = useState(false)
  const [liveAccount, setLiveAccount] = useState<{
    equity: number
    cash: number
    buyingPower: number
    status: string
  } | null>(null)
  const [liveError, setLiveError] = useState<string | null>(null)

  // Legacy compatibility aliases
  const brokerCredentials = paperCredentials
  const brokerAccount = paperAccount
  const brokerError = paperError || liveError
  const [dryRunCashReserve, setDryRunCashReserve] = useState(0)
  const [dryRunCashMode, setDryRunCashMode] = useState<'dollars' | 'percent'>('dollars')
  const [dryRunResult, setDryRunResult] = useState<{
    mode: string
    executionMode?: string
    executedAt?: string
    timestamp: string
    account: { equity: number; cash: number; reservedCash: number; adjustedEquity: number }
    positions: Array<{ ticker: string; targetPercent: number; price: number | null; limitPrice?: number; shares: number; value: number; error?: string; skipped?: boolean; reason?: string; orderId?: string; status?: string }>
    summary: { totalAllocated: number; unallocated: number; allocationPercent: number; positionCount: number }
    botBreakdown?: Array<{ botId: string; botName: string; investment: number; weight: string; date: string; allocations: Record<string, number>; usedLivePrices?: boolean }>
    mergedAllocations?: Record<string, number>
    totalInvested?: number
    usedLivePrices?: boolean
  } | null>(null)
  const [dryRunRunning, setDryRunRunning] = useState(false)
  const [executionMode, setExecutionMode] = useState<'simulate' | 'execute-paper' | 'execute-live' | null>(null)
  const [showLiveConfirmation, setShowLiveConfirmation] = useState(false)

  // Price data quality (for degraded mode indicator)
  const [priceDataQuality, setPriceDataQuality] = useState<{
    degradedMode: boolean
    primaryCount: number
    fallbackCount: number
    emergencyCount: number
    totalTickers: number
  } | null>(null)

  // Registry tickers (all tickers from Tiingo master list)
  const [registryTickers, setRegistryTickers] = useState<string[]>([])

  // Missing tickers download state
  const [missingDownloadJob, setMissingDownloadJob] = useState<{ jobId: string; status: string; saved: number; total: number } | null>(null)

  // User Management state (super admin only)
  type AdminUser = { id: string; username: string; email: string; displayName: string | null; role: string; status: string; createdAt: number; lastLoginAt: number | null; isSuperAdmin: boolean }
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([])
  const [adminUsersLoading, setAdminUsersLoading] = useState(false)
  const [adminUsersError, setAdminUsersError] = useState<string | null>(null)

  // Atlas Systems state (super admin only - from private atlas-private.db)
  type AtlasSystemLocal = {
    id: string
    ownerId: string
    ownerName: string
    ownerEmail: string
    name: string
    description: string | null
    visibility: string
    fundSlot: number | null
    tags: string[]
    createdAt: string
    updatedAt: string
    metrics: {
      cagr: number | null
      maxDrawdown: number | null
      sharpeRatio: number | null
      sortinoRatio: number | null
    } | null
  }
  const [atlasSystems, setAtlasSystems] = useState<AtlasSystemLocal[]>([])
  const [atlasSystemsLoading, setAtlasSystemsLoading] = useState(false)
  const [atlasSystemsError, setAtlasSystemsError] = useState<string | null>(null)

  // Variable Library state (FRD-035)
  type MetricVariable = {
    id: number
    variableName: string
    displayName: string | null
    description: string | null
    formula: string | null
    sourceFile: string | null
    category: string | null
    createdAt: string
  }
  const [metricVariables, setMetricVariables] = useState<MetricVariable[]>([])
  const [variablesLoading, setVariablesLoading] = useState(false)
  const [variablesError, setVariablesError] = useState<string | null>(null)

  // Sanitize ticker for filename comparison (matches Python download.py sanitize_filename)
  const sanitizeTickerForFilename = (ticker: string) =>
    ticker.replace(/[/\\:*?"<>|]/g, '-').toUpperCase()

  // Compute missing tickers (in registry but not in parquet files)
  const missingTickers = useMemo(() => {
    if (registryTickers.length === 0) return []
    // Parquet filenames are already sanitized (e.g., BC-PC.parquet from BC/PC)
    const parquetSet = new Set(parquetTickers.map(t => t.toUpperCase()))
    // Compare sanitized registry tickers against parquet filenames
    return registryTickers.filter(t => !parquetSet.has(sanitizeTickerForFilename(t))).sort()
  }, [registryTickers, parquetTickers])

  // Click-away listener to close time picker menu
  useEffect(() => {
    if (!timePickerOpen) return

    const handleClickAway = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // Close if clicking outside the time picker menu
      if (!target.closest('.time-picker-menu') && !target.closest('.time-picker-trigger')) {
        setTimePickerOpen(null)
      }
    }

    document.addEventListener('mousedown', handleClickAway)
    return () => document.removeEventListener('mousedown', handleClickAway)
  }, [timePickerOpen])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setError(null)
      try {
        const [s, t] = await Promise.all([fetch('/api/status'), fetch('/api/tickers')])
        const sPayload = (await s.json()) as AdminStatus | { error: string }
        const tPayload = (await t.json()) as { tickers: string[] } | { error: string }
        if (cancelled) return
        if (!s.ok) throw new Error('error' in sPayload ? sPayload.error : `Status failed (${s.status})`)
        if (!t.ok) throw new Error('error' in tPayload ? tPayload.error : `Tickers failed (${t.status})`)
        const tickersList = (tPayload as { tickers: string[] }).tickers || []
        setStatus(sPayload as AdminStatus)
        setTickers(tickersList)
        onTickersUpdated?.(tickersList)
      } catch (e) {
        if (cancelled) return
        setError(String((e as Error)?.message || e))
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])


  useEffect(() => {
    if (adminTab !== 'Ticker Data') return
    let cancelled = false
    const run = async () => {
      try {
        const res = await fetch('/api/parquet-tickers')
        const payload = (await res.json()) as { tickers: string[] } | { error: string }
        if (!res.ok) return
        if (cancelled) return
        setParquetTickers(('tickers' in payload ? payload.tickers : []) || [])
      } catch {
        if (cancelled) return
        setParquetTickers([])
      }

      // FRD-014: Also fetch cache stats
      try {
        const cacheRes = await fetch(`${API_BASE}/admin/cache/stats`, {
          headers: { Authorization: `Bearer ${getAuthToken()}` }
        })
        if (cacheRes.ok && !cancelled) {
          setCacheStats(await cacheRes.json())
        }
      } catch {
        // Ignore cache stats errors
      }

      // Fetch ticker registry stats
      try {
        const regRes = await fetch('/api/tickers/registry/stats', {
          headers: { Authorization: `Bearer ${getAuthToken()}` }
        })
        if (regRes.ok && !cancelled) {
          setRegistryStats(await regRes.json())
        }
      } catch {
        // Ignore registry stats errors
      }

      // Fetch Tiingo API key status
      try {
        const keyRes = await fetch('/api/admin/tiingo-key')
        if (keyRes.ok && !cancelled) {
          const keyData = await keyRes.json()
          setTiingoKeyStatus({ hasKey: keyData.hasKey, loading: false })
        } else {
          setTiingoKeyStatus({ hasKey: false, loading: false })
        }
      } catch {
        setTiingoKeyStatus({ hasKey: false, loading: false })
      }

      // Fetch sync schedule status
      try {
        const schedRes = await fetch('/api/admin/sync-schedule', {
          headers: { Authorization: `Bearer ${getAuthToken()}` }
        })
        if (schedRes.ok && !cancelled) {
          setSyncSchedule(await schedRes.json())
        }
      } catch {
        // Ignore schedule errors
      }

      // Fetch all registry tickers (for missing tickers calculation) and metadata
      try {
        const regMetaRes = await fetch('/api/tickers/registry/metadata', {
          headers: { Authorization: `Bearer ${getAuthToken()}` }
        })
        if (regMetaRes.ok && !cancelled) {
          const data = await regMetaRes.json()
          if (data.tickers) {
            setRegistryTickers(data.tickers.map((t: { ticker: string }) => t.ticker))

            // Build metadata map for ticker search modal
            const metadataMap = new Map<string, TickerMetadata>()
            for (const ticker of data.tickers) {
              if (ticker.name || ticker.assetType || ticker.exchange) {
                metadataMap.set(ticker.ticker.toUpperCase(), {
                  name: ticker.name,
                  assetType: ticker.assetType,
                  exchange: ticker.exchange,
                })
              }
            }
            setTickerMetadataMap(metadataMap)
          }
        }
      } catch {
        // Ignore errors
      }
    }
    void run()

    // Poll sync status every 2 seconds for faster UI updates during downloads
    const pollInterval = setInterval(async () => {
      try {
        const schedRes = await fetch('/api/admin/sync-schedule', {
          headers: { Authorization: `Bearer ${getAuthToken()}` }
        })
        if (schedRes.ok) {
          const data = await schedRes.json()
          // Verbose polling log - commented out to reduce noise
          // console.log('[Polling] Fetched schedule:', {
          //   tiingo5d: data.config?.tiingo5d?.updateTime,
          //   tiingoFull: data.config?.tiingoFull?.updateTime
          // })
          setSyncSchedule(data)
          // Also refresh registry stats if job is running
          if (data.status?.isRunning) {
            const regRes = await fetch('/api/tickers/registry/stats', {
              headers: { Authorization: `Bearer ${getAuthToken()}` }
            })
            if (regRes.ok) {
              setRegistryStats(await regRes.json())
            }
          }
        }
      } catch {
        // Ignore errors
      }
    }, 2000)

    return () => {
      cancelled = true
      clearInterval(pollInterval)
    }
  }, [adminTab])

  // Check if current user is super admin and fetch users for User Management tab
  useEffect(() => {
    // Check super admin status on mount
    const checkSuperAdmin = async () => {
      try {
        const res = await fetch('/api/admin/me', {
          headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        })
        if (res.ok) {
          const data = await res.json()
          setIsSuperAdmin(data.isSuperAdmin === true)
        }
      } catch {
        setIsSuperAdmin(false)
      }
    }
    void checkSuperAdmin()
  }, [])

  useEffect(() => {
    if (adminTab !== 'User Management' || !isSuperAdmin) return
    let cancelled = false

    const fetchAdminUsers = async () => {
      setAdminUsersLoading(true)
      setAdminUsersError(null)
      try {
        const res = await fetch('/api/admin/users', {
          headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || 'Failed to fetch users')
        }
        if (cancelled) return
        const data = await res.json()
        setAdminUsers(data.users || [])
      } catch (e) {
        if (cancelled) return
        setAdminUsersError(String((e as Error)?.message || e))
      } finally {
        if (!cancelled) setAdminUsersLoading(false)
      }
    }
    void fetchAdminUsers()

    return () => { cancelled = true }
  }, [adminTab, isSuperAdmin])

  // Fetch Atlas Systems when tab is active
  useEffect(() => {
    if (adminTab !== 'Atlas Systems' || !isSuperAdmin) return
    let cancelled = false

    const fetchAtlasSystems = async () => {
      setAtlasSystemsLoading(true)
      setAtlasSystemsError(null)
      try {
        const res = await fetch('/api/admin/systems/atlas', {
          headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || 'Failed to fetch atlas systems')
        }
        const data = await res.json()
        if (!cancelled) setAtlasSystems(data.systems || [])
      } catch (e) {
        if (!cancelled) setAtlasSystemsError(String((e as Error)?.message || e))
      } finally {
        if (!cancelled) setAtlasSystemsLoading(false)
      }
    }

    void fetchAtlasSystems()
    return () => { cancelled = true }
  }, [adminTab, isSuperAdmin])

  // Fetch broker credentials for Trading Control tab
  useEffect(() => {
    if (adminTab !== 'Trading Control') return
    let cancelled = false

    const fetchBrokerCredentials = async () => {
      try {
        const res = await fetch(`${API_BASE}/admin/broker/credentials`, {
          headers: { Authorization: `Bearer ${getAuthToken()}` }
        })
        if (!res.ok) return
        if (cancelled) return
        const data = await res.json()
        // Set paper credentials
        setPaperCredentials(data.paper || { hasCredentials: false, baseUrl: 'https://paper-api.alpaca.markets' })
        // Set live credentials
        setLiveCredentials(data.live || { hasCredentials: false, baseUrl: 'https://api.alpaca.markets' })
      } catch {
        // Ignore errors - credentials may not exist yet
      }
    }
    void fetchBrokerCredentials()

    return () => { cancelled = true }
  }, [adminTab])

  // Fetch admin data for Atlas Overview
  useEffect(() => {
    if (adminTab !== 'Atlas Overview') return
    let cancelled = false

    const fetchAdminData = async () => {
      try {
        const [statsRes, treasuryRes] = await Promise.all([
          fetch('/api/admin/aggregated-stats'),
          fetch('/api/admin/treasury')
        ])

        if (cancelled) return

        const statsData = (await statsRes.json()) as { stats: AdminAggregatedStats; config: AdminConfig; feeBreakdown: TreasuryFeeBreakdown } | { error: string }
        const treasuryData = (await treasuryRes.json()) as { treasury: TreasuryState } | { error: string }

        if (statsRes.ok && 'stats' in statsData) {
          setAdminStats(statsData.stats)
          const config = statsData.config || { atlasFeePercent: 0, partnerProgramSharePercent: 0, eligibilityRequirements: [] }
          setAdminConfig(config)
          setSavedConfig(config)
          if (statsData.feeBreakdown) {
            setFeeBreakdown(statsData.feeBreakdown)
          }
        }
        if (treasuryRes.ok && 'treasury' in treasuryData) {
          setTreasury(treasuryData.treasury)
        }
      } catch (e) {
        console.error('Failed to fetch admin data:', e)
      }
    }

    fetchAdminData()
    // Poll every 30 seconds
    const interval = setInterval(fetchAdminData, 30000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [adminTab])

  const handleSaveConfig = useCallback(async () => {
    setConfigSaving(true)
    try {
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(adminConfig)
      })
      if (!res.ok) throw new Error('Failed to save config')
      setSavedConfig({ ...adminConfig })
    } catch (e) {
      console.error('Failed to save config:', e)
    } finally {
      setConfigSaving(false)
    }
  }, [adminConfig])

  // Atlas Fund Slot handlers
  const handleAddAtlasSlot = useCallback(async (botId: string) => {
    // Add to Atlas Fund Slots
    const newSlots = [...adminConfig.atlasFundSlots, botId]
    setAdminConfig(prev => ({ ...prev, atlasFundSlots: newSlots }))

    // Update bot tags: remove 'Private', add 'Atlas'
    const bot = savedBots.find(b => b.id === botId)
    if (!bot) return

    const updatedBot: SavedBot = {
      ...bot,
      tags: [...(bot.tags || []).filter(t => t !== 'Private' && t !== 'Atlas Eligible'), 'Atlas']
    }
    setSavedBots(prev => prev.map(b => b.id === botId ? updatedBot : b))

    // Sync bot tags to API
    try {
      if (userId) await updateBotInApi(userId, updatedBot)
    } catch (e) {
      console.error('Failed to sync Atlas bot tags:', e)
    }

    // Save config to server
    try {
      await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...adminConfig, atlasFundSlots: newSlots })
      })
      setSavedConfig(prev => ({ ...prev, atlasFundSlots: newSlots }))
    } catch (e) {
      console.error('Failed to save Atlas slots:', e)
    }

    // Refresh allNexusBots after API updates complete so other users see the new Atlas system
    if (onRefreshNexusBots) {
      try {
        await onRefreshNexusBots()
      } catch (e) {
        console.error('Failed to refresh Nexus bots:', e)
      }
    }
  }, [adminConfig, savedBots, onRefreshNexusBots, userId])

  const handleRemoveAtlasSlot = useCallback(async (botId: string) => {
    // Remove from Atlas Fund Slots
    const newSlots = adminConfig.atlasFundSlots.filter(id => id !== botId)
    setAdminConfig(prev => ({ ...prev, atlasFundSlots: newSlots }))

    // Update bot tags: remove 'Atlas', add 'Private'
    const bot = savedBots.find(b => b.id === botId)
    if (!bot) return

    const updatedBot: SavedBot = {
      ...bot,
      tags: [...(bot.tags || []).filter(t => t !== 'Atlas'), 'Private']
    }
    setSavedBots(prev => prev.map(b => b.id === botId ? updatedBot : b))

    // Sync bot tags to API
    try {
      if (userId) await updateBotInApi(userId, updatedBot)
    } catch (e) {
      console.error('Failed to sync Atlas bot tags:', e)
    }

    // Save config to server
    try {
      await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...adminConfig, atlasFundSlots: newSlots })
      })
      setSavedConfig(prev => ({ ...prev, atlasFundSlots: newSlots }))
    } catch (e) {
      console.error('Failed to save Atlas slots:', e)
    }

    // Refresh allNexusBots after API updates complete so other users see the removal
    if (onRefreshNexusBots) {
      try {
        await onRefreshNexusBots()
      } catch (e) {
        console.error('Failed to refresh Nexus bots:', e)
      }
    }
  }, [adminConfig, savedBots, onRefreshNexusBots, userId])

  // Execute trades now (Simulate, Paper, or Live)
  const executeNow = useCallback(async (mode: 'simulate' | 'execute-paper' | 'execute-live') => {
    setDryRunRunning(true)
    setPaperError(null)
    setLiveError(null)
    setDryRunResult(null)
    setExecutionMode(mode)

    try {
      const res = await fetch(`${API_BASE}/admin/live/dry-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken()}` },
        body: JSON.stringify({
          cashReserve: dryRunCashReserve,
          cashMode: dryRunCashMode,
          mode, // 'execute-paper' or 'execute-live'
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to execute trades')
      setDryRunResult(data)

      // Update price data quality if present
      if (data.priceMetadata) {
        setPriceDataQuality(data.priceMetadata)
      }

      // Show success message
      if (mode === 'execute-live') {
        console.log('✅ Live execution completed:', data.positions?.length, 'orders')
      } else if (mode === 'simulate') {
        console.log('✅ Simulation completed:', data.positions?.length, 'positions (no orders placed)')
      } else {
        console.log('✅ Paper execution completed:', data.positions?.length, 'orders')
      }
    } catch (e) {
      const errorMsg = String((e as Error)?.message || e)
      if (mode === 'execute-live') {
        setLiveError(errorMsg)
      } else {
        setPaperError(errorMsg)
      }
      console.error('Execution failed:', e)
    } finally {
      setDryRunRunning(false)
      setExecutionMode(null)
      setShowLiveConfirmation(false)
    }
  }, [dryRunCashReserve, dryRunCashMode])

  // Get admin's bots that are available to add to Atlas Fund
  // Show ALL admin bots that aren't already tagged as Atlas
  const adminBots = savedBots.filter(b => b.builderId === userId && !b.tags?.includes('Atlas'))
  const availableForAtlas = adminBots.filter(b => !adminConfig.atlasFundSlots.includes(b.id))
  const atlasFundBots = adminConfig.atlasFundSlots
    .map(id => savedBots.find(b => b.id === id))
    .filter((b): b is SavedBot => b !== undefined)

  // Fetch eligibility requirements for Nexus Maintenance tab
  useEffect(() => {
    if (adminTab !== 'Nexus Maintenance') return
    let cancelled = false

    const fetchEligibility = async () => {
      try {
        const res = await fetch('/api/admin/eligibility')
        if (!res.ok) return
        const data = (await res.json()) as { eligibilityRequirements: EligibilityRequirement[] }
        if (cancelled) return
        setEligibilityRequirements(data.eligibilityRequirements || [])
        // Set live months value from existing requirement
        const liveMonthsReq = data.eligibilityRequirements.find(r => r.type === 'live_months')
        if (liveMonthsReq) setLiveMonthsValue(liveMonthsReq.value)
      } catch (e) {
        console.error('Failed to fetch eligibility:', e)
      }
    }

    fetchEligibility()
    return () => { cancelled = true }
  }, [adminTab])

  // Auto-load Variable Library data when tab is selected (FRD-035)
  useEffect(() => {
    if (adminTab !== 'Variable Library' || !isSuperAdmin) return
    let cancelled = false

    const fetchVariables = async () => {
      setVariablesLoading(true)
      setVariablesError(null)
      try {
        const token = getAuthToken()
        const res = await fetch(`${API_BASE}/admin/variables`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) {
          const errText = await res.text()
          throw new Error(errText || 'Failed to load variables')
        }
        const data = await res.json()
        if (cancelled) return
        setMetricVariables(data.variables || [])
      } catch (e) {
        if (cancelled) return
        setVariablesError(String((e as Error)?.message || e))
      } finally {
        if (!cancelled) setVariablesLoading(false)
      }
    }

    fetchVariables()
    return () => { cancelled = true }
  }, [adminTab, isSuperAdmin])

  // Poll running download jobs and auto-clear when complete
  useEffect(() => {
    const jobIds = Object.values(runningDownloadJobs).filter(Boolean)
    if (jobIds.length === 0) return

    const checkJobs = async () => {
      for (const [mode, jobId] of Object.entries(runningDownloadJobs)) {
        if (!jobId) continue
        try {
          const res = await fetch(`/api/download/${jobId}`)
          if (res.ok) {
            const job = await res.json()
            console.log(`[${mode}] Job status:`, job.status, `logs: ${job.logs?.length || 0}`)

            // Update logs
            if (job.logs && Array.isArray(job.logs)) {
              setJobLogs(prev => ({ ...prev, [mode]: job.logs }))
            }

            if (job.status === 'done' || job.status === 'error') {
              // Job finished, keep logs visible for 30 seconds
              setTimeout(() => {
                setRunningDownloadJobs(prev => ({ ...prev, [mode]: undefined }))
              }, 30000)

              if (job.status === 'error') {
                setRegistryMsg(`${mode} job failed: ${job.error || 'Unknown error'}`)
                console.error(`[${mode}] Job failed:`, job.error)
                console.error(`[${mode}] Full logs:`, job.logs)
              } else {
                setRegistryMsg(`${mode} job completed`)
                console.log(`[${mode}] Job completed`)
                console.log(`[${mode}] Full logs:`, job.logs)
                console.log(`[${mode}] Final events:`, job.events)
              }
            }
          } else {
            console.error(`[${mode}] Failed to fetch job status:`, res.status)
          }
        } catch (e) {
          console.error(`[${mode}] Error polling job:`, e)
        }
      }
    }

    // Poll immediately, then every 1 second
    checkJobs()
    const interval = setInterval(checkJobs, 1000)
    return () => clearInterval(interval)
  }, [runningDownloadJobs])

  const saveEligibilityRequirements = useCallback(async (reqs: EligibilityRequirement[]) => {
    setEligibilitySaving(true)
    try {
      const res = await fetch('/api/admin/eligibility', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eligibilityRequirements: reqs })
      })
      if (!res.ok) throw new Error('Failed to save eligibility')
      setEligibilityRequirements(reqs)
    } catch (e) {
      console.error('Failed to save eligibility:', e)
    } finally {
      setEligibilitySaving(false)
    }
  }, [])

  const handleSaveLiveMonths = useCallback(() => {
    const existingReqs = eligibilityRequirements.filter(r => r.type !== 'live_months')
    const newReqs: EligibilityRequirement[] = [
      { id: 'live_months', type: 'live_months', value: liveMonthsValue },
      ...existingReqs
    ]
    saveEligibilityRequirements(newReqs)
  }, [liveMonthsValue, eligibilityRequirements, saveEligibilityRequirements])

  const handleAddMetricRequirement = useCallback(() => {
    const newReq: EligibilityRequirement = {
      id: `metric-${Date.now()}`,
      type: 'metric',
      metric: newMetric,
      comparison: newComparison,
      value: newMetricValue
    }
    const newReqs = [...eligibilityRequirements, newReq]
    saveEligibilityRequirements(newReqs)
  }, [newMetric, newComparison, newMetricValue, eligibilityRequirements, saveEligibilityRequirements])

  const handleRemoveRequirement = useCallback((id: string) => {
    const newReqs = eligibilityRequirements.filter(r => r.id !== id)
    saveEligibilityRequirements(newReqs)
  }, [eligibilityRequirements, saveEligibilityRequirements])

  // User Management: Change user role (main_admin or sub_admin)
  const handleChangeRole = useCallback(async (targetUserId: string, newRole: string) => {
    try {
      const res = await fetch(`/api/admin/users/${targetUserId}/role`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getAuthToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ role: newRole })
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to change role')
      }
      // Update local state
      setAdminUsers(prev => prev.map(u => u.id === targetUserId ? { ...u, role: newRole } : u))
    } catch (e) {
      setAdminUsersError(String((e as Error)?.message || e))
    }
  }, [])

  // Trading Settings Card Component
  const TradingSettingsCard = useCallback(() => {
    const [settings, setSettings] = useState({
      maxAllocationPercent: 99.0,
      fallbackTicker: 'SGOV',
      cashReserveMode: 'dollars' as 'dollars' | 'percent',
      cashReserveAmount: 0,
      minutesBeforeClose: 10,
      pairedTickers: [] as string[][],
      enabled: false,
      marketHoursCheckHour: 4,
    })
    const [schedulerStatus, setSchedulerStatus] = useState<{
      isRunning: boolean
      schedulerActive: boolean
      enabledUserCount: number
      nextExecutionTime: string
      isTradingDay: boolean
    } | null>(null)
    const [settingsLoading, setSettingsLoading] = useState(true)
    const [settingsSaving, setSettingsSaving] = useState(false)
    const [settingsError, setSettingsError] = useState<string | null>(null)
    const [manualExecuting, setManualExecuting] = useState(false)
    const [newPair, setNewPair] = useState(['', ''])
    const [tickerModalOpen, setTickerModalOpen] = useState(false)

    // Fetch settings and scheduler status on mount
    useEffect(() => {
      let cancelled = false

      const fetchData = async () => {
        try {
          // Fetch trading settings
          const settingsRes = await fetch(`${API_BASE}/admin/trading/settings`, {
            headers: { Authorization: `Bearer ${getAuthToken()}` },
          })
          if (settingsRes.ok) {
            const data = await settingsRes.json()
            if (!cancelled) {
              setSettings({
                maxAllocationPercent: data.maxAllocationPercent ?? 99.0,
                fallbackTicker: data.fallbackTicker || 'SGOV',
                cashReserveMode: data.cashReserveMode || 'dollars',
                cashReserveAmount: data.cashReserveAmount ?? 0,
                minutesBeforeClose: data.minutesBeforeClose ?? 10,
                pairedTickers: data.pairedTickers || [],
                enabled: data.enabled ?? false,
                marketHoursCheckHour: data.marketHoursCheckHour ?? 4,
              })
            }
          }

          // Fetch scheduler status
          const statusRes = await fetch(`${API_BASE}/admin/trading/scheduler/status`, {
            headers: { Authorization: `Bearer ${getAuthToken()}` },
          })
          if (statusRes.ok) {
            const status = await statusRes.json()
            if (!cancelled) {
              setSchedulerStatus(status)
            }
          }
        } catch (e) {
          if (!cancelled) {
            setSettingsError(String((e as Error)?.message || e))
          }
        } finally {
          if (!cancelled) {
            setSettingsLoading(false)
          }
        }
      }

      void fetchData()
      return () => { cancelled = true }
    }, [])

    const saveSettings = async () => {
      setSettingsSaving(true)
      setSettingsError(null)
      try {
        const res = await fetch(`${API_BASE}/admin/trading/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken()}` },
          body: JSON.stringify(settings),
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || 'Failed to save settings')
        }
      } catch (e) {
        setSettingsError(String((e as Error)?.message || e))
      } finally {
        setSettingsSaving(false)
      }
    }

    const triggerManualExecution = async () => {
      if (!confirm('This will execute trades for ALL enabled users. Continue?')) return
      setManualExecuting(true)
      setSettingsError(null)
      try {
        const res = await fetch(`${API_BASE}/admin/trading/scheduler/trigger`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${getAuthToken()}` },
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to trigger execution')
        alert(`Execution completed: ${JSON.stringify(data.result?.summary || data.message)}`)
      } catch (e) {
        setSettingsError(String((e as Error)?.message || e))
      } finally {
        setManualExecuting(false)
      }
    }

    const addPairedTicker = () => {
      if (newPair[0] && newPair[1]) {
        setSettings(prev => ({
          ...prev,
          pairedTickers: [...prev.pairedTickers, [newPair[0].toUpperCase(), newPair[1].toUpperCase()]],
        }))
        setNewPair(['', ''])
      }
    }

    const removePairedTicker = (index: number) => {
      setSettings(prev => ({
        ...prev,
        pairedTickers: prev.pairedTickers.filter((_, i) => i !== index),
      }))
    }

    if (settingsLoading) {
      return <Card className="p-6"><div className="text-muted-foreground">Loading trading settings...</div></Card>
    }

    return (
      <Card className="p-6">
        <div className="font-bold mb-4 flex items-center gap-2">
          Trading Settings & Scheduler
          {settings.enabled && (
            <span className="px-2 py-0.5 rounded text-xs bg-green-500/20 text-green-500">
              Enabled
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Configure automated trading execution. The scheduler runs X minutes before market close on trading days.
        </p>

        {settingsError && (
          <div className="text-destructive text-sm p-3 bg-destructive/10 rounded-lg mb-4">
            {settingsError}
          </div>
        )}

        {/* Scheduler Status */}
        {schedulerStatus && (
          <div className="mb-6 p-4 bg-muted/50 rounded-lg">
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">Scheduler</div>
                <div className={`font-bold ${schedulerStatus.schedulerActive ? 'text-green-500' : 'text-muted-foreground'}`}>
                  {schedulerStatus.schedulerActive ? 'Active' : 'Inactive'}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Next Execution</div>
                <div className="font-bold">{schedulerStatus.nextExecutionTime}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Trading Day</div>
                <div className={`font-bold ${schedulerStatus.isTradingDay ? 'text-green-500' : 'text-yellow-500'}`}>
                  {schedulerStatus.isTradingDay ? 'Yes' : 'No (Weekend/Holiday)'}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Status</div>
                <div className={`font-bold ${schedulerStatus.isRunning ? 'text-yellow-500' : 'text-muted-foreground'}`}>
                  {schedulerStatus.isRunning ? 'Executing...' : 'Idle'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Enable Toggle */}
        <div className="mb-6 flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer" title="When enabled, the scheduler automatically executes trades for all invested bots at the configured time">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => setSettings(prev => ({ ...prev, enabled: e.target.checked }))}
              className="w-4 h-4"
            />
            <span className="text-sm font-medium">
              Enable Automated Trading
              <span className="ml-1 cursor-help text-muted-foreground/60">ⓘ</span>
            </span>
          </label>
          <span className="text-xs text-muted-foreground">
            (When enabled, trades execute automatically at scheduled time)
          </span>
        </div>

        {/* Market Hours Check Time */}
        <div className="mb-4">
          <label className="text-sm text-muted-foreground mb-1 block" title="What time (hour in ET) to check Alpaca API for today's market hours (handles early close days and holidays)">
            Market Hours Check Time (ET)
            <span className="ml-1 cursor-help text-muted-foreground/60">ⓘ</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={settings.marketHoursCheckHour}
              onChange={(e) => setSettings(prev => ({ ...prev, marketHoursCheckHour: parseInt(e.target.value) || 4 }))}
              min={0}
              max={23}
              className="w-24 px-3 py-2 rounded border border-border bg-background text-sm"
              title="Hour (0-23) in Eastern Time when to fetch today's market hours from Alpaca (default: 4 AM)"
            />
            <span className="text-sm text-muted-foreground">
              :00 (checks daily for early close days and holidays)
            </span>
          </div>
        </div>

        {/* Settings Grid */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div>
            <label className="text-sm text-muted-foreground mb-1 block" title="How many minutes before market close (4:00 PM ET) to execute trades automatically">
              Minutes Before Close
              <span className="ml-1 cursor-help text-muted-foreground/60">ⓘ</span>
            </label>
            <input
              type="number"
              value={settings.minutesBeforeClose}
              onChange={(e) => setSettings(prev => ({ ...prev, minutesBeforeClose: parseInt(e.target.value) || 10 }))}
              min={1}
              max={60}
              className="w-full px-3 py-2 rounded border border-border bg-background text-sm"
              title="Trades execute at 3:50 PM ET if set to 10 minutes"
            />
          </div>
          <div>
            <label className="text-sm text-muted-foreground mb-1 block" title="Maximum percentage of equity to deploy (remainder stays as cash buffer)">
              Max Allocation %
              <span className="ml-1 cursor-help text-muted-foreground/60">ⓘ</span>
            </label>
            <input
              type="number"
              value={settings.maxAllocationPercent}
              onChange={(e) => setSettings(prev => ({ ...prev, maxAllocationPercent: parseFloat(e.target.value) || 100 }))}
              min={50}
              max={100}
              step={0.5}
              className="w-full px-3 py-2 rounded border border-border bg-background text-sm"
              title="Set to 95% to keep 5% in cash as a buffer"
            />
          </div>
          <div>
            <label className="text-sm text-muted-foreground mb-1 block" title="Ticker to buy if a target ticker is unavailable (404 or other error)">
              Fallback Ticker
              <span className="ml-1 cursor-help text-muted-foreground/60">ⓘ</span>
            </label>
            <button
              type="button"
              onClick={() => setTickerModalOpen(true)}
              className="w-full px-3 py-2 rounded border border-border bg-background text-sm text-left hover:bg-muted/50 transition-colors font-mono"
              title="Click to search for a fallback ticker"
            >
              {settings.fallbackTicker || 'SGOV'}
            </button>
          </div>
          <div>
            <label className="text-sm text-muted-foreground mb-1 block" title="Cash to reserve before calculating allocations (won't be invested)">
              Cash Reserve
              <span className="ml-1 cursor-help text-muted-foreground/60">ⓘ</span>
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                value={settings.cashReserveAmount}
                onChange={(e) => setSettings(prev => ({ ...prev, cashReserveAmount: parseFloat(e.target.value) || 0 }))}
                min={0}
                className="flex-1 px-3 py-2 rounded border border-border bg-background text-sm"
                title={settings.cashReserveMode === 'dollars' ? 'Fixed dollar amount to keep as cash' : 'Percentage of equity to keep as cash'}
              />
              <select
                value={settings.cashReserveMode}
                onChange={(e) => setSettings(prev => ({ ...prev, cashReserveMode: e.target.value as 'dollars' | 'percent' }))}
                className="w-16 px-2 py-2 rounded border border-border bg-background text-sm"
                title="Choose between fixed dollar amount ($) or percentage (%)"
              >
                <option value="dollars">$</option>
                <option value="percent">%</option>
              </select>
            </div>
          </div>
        </div>

        {/* Paired Tickers */}
        <div className="mb-6">
          <label className="text-sm text-muted-foreground mb-2 block" title="If both tickers in a pair appear in allocations, only the one with higher allocation is kept (e.g., SPY-SH means if both are present, only buy the one with higher %, skip the other)">
            Paired Tickers
            <span className="ml-1 cursor-help text-muted-foreground/60">ⓘ</span>
            <span className="text-xs ml-2 opacity-75">(e.g., SPY-SH: if both present, keep higher allocation, remove lower)</span>
          </label>
          <div className="flex flex-wrap gap-2 mb-2">
            {settings.pairedTickers.map((pair, i) => (
              <span key={i} className="px-2 py-1 bg-muted rounded text-sm flex items-center gap-1">
                {pair[0]}-{pair[1]}
                <button onClick={() => removePairedTicker(i)} className="text-destructive hover:text-destructive/80">×</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newPair[0]}
              onChange={(e) => setNewPair([e.target.value.toUpperCase(), newPair[1]])}
              placeholder="SPY"
              className="w-20 px-2 py-1 rounded border border-border bg-background text-sm"
            />
            <span className="text-muted-foreground">-</span>
            <input
              type="text"
              value={newPair[1]}
              onChange={(e) => setNewPair([newPair[0], e.target.value.toUpperCase()])}
              placeholder="SH"
              className="w-20 px-2 py-1 rounded border border-border bg-background text-sm"
            />
            <Button size="sm" variant="outline" onClick={addPairedTicker} disabled={!newPair[0] || !newPair[1]}>
              Add
            </Button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button onClick={saveSettings} disabled={settingsSaving}>
            {settingsSaving ? 'Saving...' : 'Save Settings'}
          </Button>
          <Button
            variant="outline"
            onClick={triggerManualExecution}
            disabled={manualExecuting || !settings.enabled}
          >
            {manualExecuting ? 'Executing...' : 'Execute Now'}
          </Button>
        </div>

        {/* Ticker Search Modal for Fallback Ticker */}
        <TickerSearchModal
          open={tickerModalOpen}
          onClose={() => setTickerModalOpen(false)}
          onSelect={(ticker) => {
            setSettings(prev => ({ ...prev, fallbackTicker: ticker }))
            setTickerModalOpen(false)
          }}
          tickerOptions={parquetTickers}
          tickerMetadata={tickerMetadataMap}
          allowedModes={['tickers']}
        />
      </Card>
    )
  }, [])

  // Trade Execution History Component
  const TradeExecutionHistory = useCallback(() => {
    const [executions, setExecutions] = useState<Array<{
      id: number
      executionDate: string
      status: string
      targetAllocations: Record<string, number>
      executedOrders: Array<{ symbol: string; side: string; qty: number; success: boolean }>
      errors: string[]
      createdAt: number
    }>>([])
    const [historyMode, setHistoryMode] = useState<'paper' | 'live'>('paper')
    const [historyLoading, setHistoryLoading] = useState(true)
    const [expandedExecution, setExpandedExecution] = useState<number | null>(null)

    useEffect(() => {
      let cancelled = false

      const fetchExecutions = async () => {
        setHistoryLoading(true)
        try {
          const res = await fetch(`${API_BASE}/admin/trading/executions?mode=${historyMode}&limit=20`, {
            headers: { Authorization: `Bearer ${getAuthToken()}` },
          })
          if (res.ok) {
            const data = await res.json()
            if (!cancelled) {
              setExecutions(data.executions || [])
            }
          }
        } catch (e) {
          console.error('Failed to fetch executions:', e)
        } finally {
          if (!cancelled) {
            setHistoryLoading(false)
          }
        }
      }

      void fetchExecutions()
      return () => { cancelled = true }
    }, [historyMode])

    return (
      <Card className="p-6">
        <div className="font-bold mb-4 flex items-center gap-4">
          Trade Execution History
          <div className="flex gap-2">
            <button
              className={`px-3 py-1 rounded text-sm ${historyMode === 'paper' ? 'bg-yellow-500/20 text-yellow-500' : 'bg-muted text-muted-foreground'}`}
              onClick={() => setHistoryMode('paper')}
            >
              Paper
            </button>
            <button
              className={`px-3 py-1 rounded text-sm ${historyMode === 'live' ? 'bg-green-500/20 text-green-500' : 'bg-muted text-muted-foreground'}`}
              onClick={() => setHistoryMode('live')}
            >
              Live
            </button>
          </div>
        </div>

        {historyLoading ? (
          <div className="text-muted-foreground">Loading execution history...</div>
        ) : executions.length === 0 ? (
          <div className="text-muted-foreground">No {historyMode} executions yet.</div>
        ) : (
          <div className="space-y-2">
            {executions.map(exec => (
              <div key={exec.id} className="border border-border rounded-lg overflow-hidden">
                <button
                  className="w-full p-4 flex items-center justify-between hover:bg-muted/50 text-left"
                  onClick={() => setExpandedExecution(expandedExecution === exec.id ? null : exec.id)}
                >
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-medium">{exec.executionDate}</span>
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      exec.status === 'success' ? 'bg-green-500/20 text-green-500' :
                      exec.status === 'partial' ? 'bg-yellow-500/20 text-yellow-500' :
                      'bg-destructive/20 text-destructive'
                    }`}>
                      {exec.status}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {exec.executedOrders?.length || 0} orders
                    </span>
                  </div>
                  <span className="text-muted-foreground">{expandedExecution === exec.id ? '▲' : '▼'}</span>
                </button>

                {expandedExecution === exec.id && (
                  <div className="p-4 border-t border-border bg-muted/30 space-y-4">
                    {/* Target Allocations */}
                    <div>
                      <div className="text-sm font-medium mb-2">Target Allocations</div>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(exec.targetAllocations || {})
                          .filter(([, pct]) => pct > 0.5)
                          .sort((a, b) => b[1] - a[1])
                          .map(([ticker, pct]) => (
                            <span key={ticker} className="px-2 py-1 bg-background rounded text-xs">
                              {ticker} {(pct as number).toFixed(1)}%
                            </span>
                          ))}
                      </div>
                    </div>

                    {/* Executed Orders */}
                    {exec.executedOrders && exec.executedOrders.length > 0 && (
                      <div>
                        <div className="text-sm font-medium mb-2">Executed Orders</div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Side</TableHead>
                              <TableHead>Symbol</TableHead>
                              <TableHead className="text-right">Qty</TableHead>
                              <TableHead>Status</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {exec.executedOrders.map((order, i) => (
                              <TableRow key={i}>
                                <TableCell className={order.side === 'sell' ? 'text-destructive' : 'text-green-500'}>
                                  {order.side?.toUpperCase()}
                                </TableCell>
                                <TableCell className="font-medium">{order.symbol}</TableCell>
                                <TableCell className="text-right">{order.qty}</TableCell>
                                <TableCell>
                                  <span className={order.success ? 'text-green-500' : 'text-destructive'}>
                                    {order.success ? 'Filled' : 'Failed'}
                                  </span>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}

                    {/* Errors */}
                    {exec.errors && exec.errors.length > 0 && (
                      <div>
                        <div className="text-sm font-medium text-destructive mb-2">Errors</div>
                        <ul className="text-xs text-destructive list-disc list-inside">
                          {exec.errors.map((err, i) => (
                            <li key={i}>{err}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="text-xs text-muted-foreground">
                      Executed at: {new Date(exec.createdAt * 1000).toLocaleString()}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    )
  }, [])


  return (
    <>
      {/* Subtab Navigation */}
      <div className="flex gap-2 mb-6">
        {(['Atlas Overview', 'Nexus Maintenance', 'Ticker Data'] as const).map((t) => (
          <button
            key={t}
            className={`tab-btn ${adminTab === t ? 'active' : ''}`}
            onClick={() => setAdminTab(t)}
          >
            {t}
          </button>
        ))}
        {/* Trading Control tab - only visible to main admin (super admin) */}
        {isSuperAdmin && (
          <button
            className={`tab-btn ${adminTab === 'Trading Control' ? 'active' : ''}`}
            onClick={() => setAdminTab('Trading Control')}
          >
            Trading Control
          </button>
        )}
        {/* User Management tab - only visible to main admin (super admin) */}
        {isSuperAdmin && (
          <button
            className={`tab-btn ${adminTab === 'User Management' ? 'active' : ''}`}
            onClick={() => setAdminTab('User Management')}
          >
            User Management
          </button>
        )}
        {isSuperAdmin && (
          <button
            className={`tab-btn ${adminTab === 'Atlas Systems' ? 'active' : ''}`}
            onClick={() => setAdminTab('Atlas Systems')}
          >
            Atlas Systems
          </button>
        )}
        {isSuperAdmin && (
          <button
            className={`tab-btn ${adminTab === 'Variable Library' ? 'active' : ''}`}
            onClick={() => setAdminTab('Variable Library')}
          >
            Variable Library
          </button>
        )}
      </div>

      {adminTab === 'Atlas Overview' && (
        <div className="space-y-6">
          <div className="font-black text-lg">Atlas Overview</div>

          {/* Fee Configuration Section */}
          <Card className="p-6">
            <div className="font-bold mb-4">Fee Configuration</div>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <div className="text-sm text-muted mb-1">Atlas Fee %</div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={adminConfig.atlasFeePercent}
                    onChange={(e) => setAdminConfig(prev => ({
                      ...prev,
                      atlasFeePercent: parseFloat(e.target.value) || 0
                    }))}
                    className="w-20 px-2 py-1 rounded border border-border bg-background text-sm"
                  />
                  <span>%</span>
                  <Button
                    size="sm"
                    onClick={() => void handleSaveConfig()}
                    disabled={configSaving}
                  >
                    {configSaving ? 'Saving...' : 'Save'}
                  </Button>
                </div>
                <div className="text-xs text-muted mt-1">
                  Currently: {savedConfig.atlasFeePercent}%
                </div>
              </div>
              <div>
                <div className="text-sm text-muted mb-1">Partner Program Share %</div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={adminConfig.partnerProgramSharePercent}
                    onChange={(e) => setAdminConfig(prev => ({
                      ...prev,
                      partnerProgramSharePercent: parseFloat(e.target.value) || 0
                    }))}
                    className="w-20 px-2 py-1 rounded border border-border bg-background text-sm"
                  />
                  <span>%</span>
                  <Button
                    size="sm"
                    onClick={() => void handleSaveConfig()}
                    disabled={configSaving}
                  >
                    {configSaving ? 'Saving...' : 'Save'}
                  </Button>
                </div>
                <div className="text-xs text-muted mt-1">
                  Currently: {savedConfig.partnerProgramSharePercent}%
                </div>
              </div>
            </div>
          </Card>

          {/* Atlas Fund Zones - Admin Sponsored Systems */}
          <Card className="p-6">
            <div className="font-bold mb-4">Atlas Sponsored Systems</div>
            <div className="space-y-4">
              {/* Current Atlas Fund Slots */}
              <div className="grid grid-cols-5 gap-3">
                {atlasFundBots.length === 0 ? (
                  <div className="col-span-5 text-center py-6 text-muted border border-dashed border-border rounded-lg">
                    No Atlas systems yet. Add systems from the dropdown below.
                  </div>
                ) : (
                  atlasFundBots.map((bot, idx) => (
                    <div key={bot.id} className="p-3 bg-blue-500/10 rounded-lg border border-blue-500/30">
                      <div className="text-xs text-muted mb-1">Atlas #{idx + 1}</div>
                      <div className="font-bold text-sm truncate" title={bot.name}>{bot.name}</div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 w-full text-xs"
                        onClick={() => void handleRemoveAtlasSlot(bot.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  ))
                )}
              </div>

              {/* Add New Atlas System */}
              <div className="flex items-center gap-3">
                <select
                  className="flex-1 px-3 py-2 rounded border border-border bg-background text-sm"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) void handleAddAtlasSlot(e.target.value)
                  }}
                  disabled={availableForAtlas.length === 0}
                >
                  <option value="">
                    {availableForAtlas.length === 0
                      ? 'No systems available (create systems in Build tab first)'
                      : 'Select a system to add as Atlas...'}
                  </option>
                  {availableForAtlas.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>

              <div className="text-xs text-muted">
                Atlas systems appear in the "Select Systems" section of Nexus. Unlike Nexus systems, Atlas systems do not require eligibility metrics.
              </div>
            </div>
          </Card>

          {/* 5 Totals Grid */}
          <Card className="p-6">
            <div className="font-bold mb-4">System Statistics</div>
            <div className="grid grid-cols-5 gap-4">
              <div className="text-center p-4 bg-muted/30 rounded-lg">
                <div className="text-xs text-muted mb-1">Total Portfolio Values</div>
                <div className="text-lg font-black">
                  ${(adminStats?.totalPortfolioValue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
              </div>
              <div className="text-center p-4 bg-muted/30 rounded-lg">
                <div className="text-xs text-muted mb-1">Total Invested (All)</div>
                <div className="text-lg font-black">
                  ${(adminStats?.totalDollarsInvested ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
              </div>
              <div className="text-center p-4 bg-blue-500/10 rounded-lg border border-blue-500/30">
                <div className="text-xs text-muted mb-1">Invested in Atlas</div>
                <div className="text-lg font-black text-blue-500">
                  ${(adminStats?.totalInvestedAtlas ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
              </div>
              <div className="text-center p-4 bg-purple-500/10 rounded-lg border border-purple-500/30">
                <div className="text-xs text-muted mb-1">Invested in Nexus</div>
                <div className="text-lg font-black text-purple-500">
                  ${(adminStats?.totalInvestedNexus ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
              </div>
              <div className="text-center p-4 bg-gray-500/10 rounded-lg border border-gray-500/30">
                <div className="text-xs text-muted mb-1">Invested in Private</div>
                <div className="text-lg font-black text-gray-400">
                  ${(adminStats?.totalInvestedPrivate ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
              </div>
            </div>
            {adminStats && (
              <div className="text-xs text-muted mt-4">
                Last updated: {new Date(adminStats.lastUpdated).toLocaleString()} | Active users: {adminStats.userCount}
              </div>
            )}
          </Card>

          {/* Treasury Bill Holdings Section */}
          <Card className="p-6">
            <div className="font-bold mb-4">Treasury Bill Holdings</div>
            <div className="mb-4">
              <div className="text-sm text-muted mb-1">Current Balance</div>
              <div className="text-2xl font-black text-emerald-500">
                ${treasury.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>

            {/* Time Period Buttons */}
            <div className="flex gap-1 mb-4">
              {(['1D', '1M', '3M', '6M', 'YTD', '1Y', 'ALL'] as const).map((period) => (
                <Button
                  key={period}
                  size="sm"
                  variant={treasuryPeriod === period ? 'accent' : 'ghost'}
                  className="h-6 px-2 text-xs"
                  onClick={() => setTreasuryPeriod(period)}
                >
                  {period}
                </Button>
              ))}
            </div>

            {/* Treasury Equity Chart placeholder */}
            <div className="h-[200px] border border-border rounded-lg bg-muted/30 flex items-center justify-center text-muted text-sm mb-4">
              Treasury Equity Chart - Balance: ${treasury.balance.toLocaleString()}
              {treasury.entries.length > 0 && ` (${treasury.entries.length} entries)`}
            </div>

            {/* Fee Breakdowns */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="p-3 bg-blue-500/10 rounded-lg border border-blue-500/30">
                <div className="text-xs text-muted mb-1">Returns from Atlas Fees</div>
                <div className="text-lg font-bold text-emerald-500">
                  +${feeBreakdown.atlasFeesTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="p-3 bg-gray-500/10 rounded-lg border border-gray-500/30">
                <div className="text-xs text-muted mb-1">Returns from Private Fees</div>
                <div className="text-lg font-bold text-emerald-500">
                  +${feeBreakdown.privateFeesTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="p-3 bg-purple-500/10 rounded-lg border border-purple-500/30">
                <div className="text-xs text-muted mb-1">Returns from Nexus Fees</div>
                <div className="text-lg font-bold text-emerald-500">
                  +${feeBreakdown.nexusFeesTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="p-3 bg-red-500/10 rounded-lg border border-red-500/30">
                <div className="text-xs text-muted mb-1">Nexus Partner Payments</div>
                <div className="text-lg font-bold text-red-500">
                  -${feeBreakdown.nexusPartnerPaymentsTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            {/* Recent Fee Deposits */}
            <div>
              <div className="font-bold mb-2">Recent Transactions</div>
              <div className="max-h-[200px] overflow-auto border border-border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Date</th>
                      <th className="text-left px-3 py-2 font-medium">Type</th>
                      <th className="text-right px-3 py-2 font-medium">Amount</th>
                      <th className="text-left px-3 py-2 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {treasury.entries.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-center text-muted">
                          No transactions yet
                        </td>
                      </tr>
                    ) : (
                      treasury.entries.slice(-10).reverse().map((entry) => (
                        <tr key={entry.id} className="border-t border-border">
                          <td className="px-3 py-2">{new Date(entry.date).toLocaleDateString()}</td>
                          <td className="px-3 py-2 capitalize">{entry.type.replace('_', ' ')}</td>
                          <td className={`px-3 py-2 text-right ${entry.amount >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                            {entry.amount >= 0 ? '+' : ''}${entry.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="px-3 py-2 text-muted">{entry.description || '-'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>
        </div>
      )}

      {adminTab === 'Nexus Maintenance' && (
        <div className="space-y-6">
          <div className="font-black text-lg">Nexus Maintenance</div>

          {/* Partner Program Eligibility Requirements */}
          <Card className="p-6">
            <div className="font-bold mb-4">Partner Program Eligibility Requirements</div>
            <div className="grid grid-cols-2 gap-6">
              {/* Left Half - Add/Edit Requirements */}
              <div className="space-y-4">
                {/* Live Months Requirement */}
                <div className="p-4 bg-muted/30 rounded-lg">
                  <div className="text-sm font-medium mb-2">Live Duration Requirement</div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm">Must Be Live for</span>
                    <input
                      type="number"
                      min="0"
                      value={liveMonthsValue}
                      onChange={(e) => setLiveMonthsValue(parseInt(e.target.value) || 0)}
                      className="w-16 px-2 py-1 rounded border border-border bg-background text-sm"
                    />
                    <span className="text-sm">Months</span>
                    <Button
                      size="sm"
                      onClick={handleSaveLiveMonths}
                      disabled={eligibilitySaving}
                    >
                      {eligibilitySaving ? 'Saving...' : 'Save'}
                    </Button>
                  </div>
                </div>

                {/* Add Metric Requirement */}
                <div className="p-4 bg-muted/30 rounded-lg">
                  <div className="text-sm font-medium mb-2">Add Metric Requirement</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm">Must have</span>
                    <select
                      value={newMetric}
                      onChange={(e) => setNewMetric(e.target.value as EligibilityMetric)}
                      className="px-2 py-1 rounded border border-border bg-background text-sm"
                    >
                      {(Object.keys(METRIC_LABELS) as EligibilityMetric[]).map(m => (
                        <option key={m} value={m}>{METRIC_LABELS[m]}</option>
                      ))}
                    </select>
                    <span className="text-sm">of</span>
                    <select
                      value={newComparison}
                      onChange={(e) => setNewComparison(e.target.value as 'at_least' | 'at_most')}
                      className="px-2 py-1 rounded border border-border bg-background text-sm"
                    >
                      <option value="at_least">at least</option>
                      <option value="at_most">at most</option>
                    </select>
                    <input
                      type="number"
                      step="0.01"
                      value={newMetricValue}
                      onChange={(e) => setNewMetricValue(parseFloat(e.target.value) || 0)}
                      className="w-20 px-2 py-1 rounded border border-border bg-background text-sm"
                    />
                    <Button
                      size="sm"
                      onClick={handleAddMetricRequirement}
                      disabled={eligibilitySaving}
                    >
                      Add
                    </Button>
                  </div>
                </div>

                {/* ETFs Only Requirement */}
                <div className="p-4 bg-muted/30 rounded-lg">
                  <div className="text-sm font-medium mb-2">Asset Type Requirement</div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={eligibilityRequirements.some(r => r.type === 'etfs_only')}
                      onChange={(e) => {
                        if (e.target.checked) {
                          // Add ETFs Only requirement
                          const newReq: EligibilityRequirement = {
                            id: `etfs-only-${Date.now()}`,
                            type: 'etfs_only',
                            value: 1 // Just a placeholder value
                          }
                          saveEligibilityRequirements([...eligibilityRequirements, newReq])
                        } else {
                          // Remove ETFs Only requirement
                          saveEligibilityRequirements(eligibilityRequirements.filter(r => r.type !== 'etfs_only'))
                        }
                      }}
                      disabled={eligibilitySaving}
                      className="w-4 h-4 rounded border-border cursor-pointer"
                    />
                    <span className="text-sm">Require ETFs Only</span>
                  </label>
                  <div className="text-xs text-muted mt-1">
                    Systems must only contain ETF positions (no individual stocks)
                  </div>
                </div>
              </div>

              {/* Right Half - Saved Requirements List */}
              <div className="p-4 bg-muted/30 rounded-lg">
                <div className="text-sm font-medium mb-2">Current Requirements</div>
                {eligibilityRequirements.length === 0 ? (
                  <div className="text-sm text-muted">No requirements set</div>
                ) : (
                  <ol className="list-decimal list-inside space-y-2 text-sm">
                    {eligibilityRequirements.map((req) => (
                      <li key={req.id} className="flex items-center justify-between">
                        <span>
                          {req.type === 'live_months' ? (
                            <>Must be live for {req.value} months</>
                          ) : req.type === 'etfs_only' ? (
                            <>Must only contain ETF positions</>
                          ) : (
                            <>Must have {METRIC_LABELS[req.metric!]} of {req.comparison === 'at_least' ? 'at least' : 'at most'} {req.value}</>
                          )}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-red-500 hover:text-red-600"
                          onClick={() => handleRemoveRequirement(req.id)}
                        >
                          ×
                        </Button>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-3 gap-4">
            {/* Top 500 Nexus Systems */}
            <Card className="p-4 flex flex-col">
              <div className="font-bold text-center mb-3">Top 500 Nexus Systems by [metric]</div>
              <div className="flex-1 overflow-auto border border-border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-medium">Name</th>
                      <th className="text-right px-2 py-1.5 font-medium">CAGR</th>
                      <th className="text-right px-2 py-1.5 font-medium">MaxDD</th>
                      <th className="text-right px-2 py-1.5 font-medium">Sharpe</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td colSpan={4} className="px-2 py-8 text-center text-muted">
                        No Nexus systems yet
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Top 500 Private Systems */}
            <Card className="p-4 flex flex-col">
              <div className="font-bold text-center mb-3">Top 500 Private Systems by [metric]</div>
              <div className="flex-1 overflow-auto border border-border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-medium">Name</th>
                      <th className="text-right px-2 py-1.5 font-medium">CAGR</th>
                      <th className="text-right px-2 py-1.5 font-medium">MaxDD</th>
                      <th className="text-right px-2 py-1.5 font-medium">Sharpe</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td colSpan={4} className="px-2 py-8 text-center text-muted">
                        No Private systems yet
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Top 500 All Systems */}
            <Card className="p-4 flex flex-col">
              <div className="font-bold text-center mb-3">Top 500 All Systems by [metric]</div>
              <div className="flex-1 overflow-auto border border-border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-medium">Name</th>
                      <th className="text-right px-2 py-1.5 font-medium">CAGR</th>
                      <th className="text-right px-2 py-1.5 font-medium">MaxDD</th>
                      <th className="text-right px-2 py-1.5 font-medium">Sharpe</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td colSpan={4} className="px-2 py-8 text-center text-muted">
                        No systems yet
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}

      {adminTab === 'Ticker Data' && (
        <div className="space-y-6">
          {/* ========== STATUS OVERVIEW ========== */}
          <div className="grid grid-cols-3 gap-4">
            {/* Files Card */}
            <div className="p-4 rounded-lg bg-muted">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Parquet Files</div>
              <div className="text-3xl font-black">{parquetTickers.length.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground mt-1">
                Available for queries
              </div>
            </div>

            {/* Last Updated Card */}
            <div className="p-4 rounded-lg bg-muted">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Last Sync</div>
              <div className="text-lg font-bold">
                {syncSchedule?.lastSync?.date ?? registryStats?.lastSync ?? 'Never'}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {syncSchedule?.lastSync?.status === 'success' && syncSchedule?.lastSync?.syncedCount != null
                  ? `${syncSchedule.lastSync.syncedCount.toLocaleString()} tickers updated`
                  : syncSchedule?.lastSync?.status === 'error'
                  ? 'Last sync failed'
                  : 'No recent sync'}
              </div>
            </div>

            {/* Pending Card */}
            <div className="p-4 rounded-lg bg-muted">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Pending Download</div>
              <div className={`text-3xl font-black ${(registryStats?.pending ?? 0) > 0 ? 'text-warning' : 'text-success'}`}>
                {registryStats?.pending?.toLocaleString() ?? '...'}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                of {registryStats?.active?.toLocaleString() ?? '...'} active tickers
              </div>
            </div>
          </div>

          {/* ========== CURRENT JOB STATUS ========== */}
          {syncSchedule?.status?.isRunning && syncSchedule?.status?.currentJob && (
            <div className="p-4 rounded-lg bg-primary/10 border border-primary">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
                  <span className="font-bold">
                    {syncSchedule.status.currentJob.phase === 'preparing'
                      ? 'Preparing Download...'
                      : `${syncSchedule.status.currentJob.source === 'tiingo' ? 'Tiingo' : 'yFinance'} Download In Progress`}
                  </span>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={syncKilling}
                  onClick={async () => {
                    if (!confirm('Are you sure you want to stop the current download?')) return
                    setSyncKilling(true)
                    try {
                      const res = await fetch('/api/admin/sync-schedule/kill', { method: 'POST' })
                      const data = await res.json()
                      if (res.ok) {
                        setRegistryMsg(`Job stopped: ${data.message}`)
                        // Refresh status
                        const schedRes = await fetch('/api/admin/sync-schedule')
                        if (schedRes.ok) setSyncSchedule(await schedRes.json())
                      } else {
                        setRegistryMsg(`Error: ${data.error}`)
                      }
                    } catch (e) {
                      setRegistryMsg(`Error: ${e}`)
                    } finally {
                      setSyncKilling(false)
                    }
                  }}
                >
                  {syncKilling ? 'Stopping...' : 'Stop'}
                </Button>
              </div>
              {syncSchedule.status.currentJob.phase === 'preparing' ? (
                <div className="text-sm text-muted-foreground">
                  Fetching ticker list and preparing download...
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <div className="text-muted-foreground text-xs">Progress</div>
                      <div className="font-bold">
                        {syncSchedule.status.currentJob.syncedCount.toLocaleString()} / {syncSchedule.status.currentJob.tickerCount.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Elapsed</div>
                      <div className="font-bold">
                        {(() => {
                          const elapsed = Math.round((Date.now() - syncSchedule.status.currentJob.startedAt) / 1000)
                          if (elapsed < 60) return `${elapsed}s`
                          return `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
                        })()}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Rate</div>
                      <div className="font-bold">
                        {(() => {
                          const elapsed = (Date.now() - syncSchedule.status.currentJob.startedAt) / 1000
                          const rate = elapsed > 0 ? syncSchedule.status.currentJob.syncedCount / elapsed : 0
                          return `${rate.toFixed(1)}/sec`
                        })()}
                      </div>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-500"
                      style={{ width: `${syncSchedule.status.currentJob.tickerCount > 0 ? Math.min(100, (syncSchedule.status.currentJob.syncedCount / syncSchedule.status.currentJob.tickerCount) * 100) : 0}%` }}
                    />
                  </div>
                  {/* ETA */}
                  {syncSchedule.status.currentJob.syncedCount > 0 && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      {(() => {
                        const elapsed = (Date.now() - syncSchedule.status.currentJob.startedAt) / 1000
                        const rate = syncSchedule.status.currentJob.syncedCount / elapsed
                        const remaining = syncSchedule.status.currentJob.tickerCount - syncSchedule.status.currentJob.syncedCount
                        const eta = rate > 0 ? remaining / rate : 0
                        if (eta < 60) return `~${Math.round(eta)}s remaining`
                        if (eta < 3600) return `~${Math.round(eta / 60)}m remaining`
                        return `~${Math.round(eta / 3600)}h ${Math.round((eta % 3600) / 60)}m remaining`
                      })()}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ========== ACTIONS ========== */}
          <div className="flex gap-3 flex-wrap">
            {/* Refresh Ticker List */}
            <Button
              variant="outline"
              disabled={registrySyncing || syncSchedule?.status?.isRunning}
              onClick={async () => {
                setRegistrySyncing(true)
                setRegistryMsg(null)
                try {
                  const res = await fetch('/api/tickers/registry/sync', { method: 'POST' })
                  const data = await res.json()
                  if (res.ok) {
                    setRegistryMsg(`Registry updated: ${data.imported?.toLocaleString() ?? 0} tickers`)
                    const statsRes = await fetch('/api/tickers/registry/stats')
                    if (statsRes.ok) setRegistryStats(await statsRes.json())
                  } else {
                    setRegistryMsg(`Error: ${data.error}`)
                  }
                } catch (e) {
                  setRegistryMsg(`Error: ${e}`)
                } finally {
                  setRegistrySyncing(false)
                }
              }}
            >
              {registrySyncing ? 'Syncing...' : 'Refresh Tickers'}
            </Button>

            {/* yFinance Download - downloads all parquet tickers */}
            <Button
              variant={syncSchedule?.status?.isRunning && syncSchedule?.status?.currentJob?.source === 'yfinance' ? 'destructive' : 'default'}
              onClick={async () => {
                // If running yfinance, this becomes a stop button
                if (syncSchedule?.status?.isRunning && syncSchedule?.status?.currentJob?.source === 'yfinance') {
                  if (!confirm('Stop the running yFinance download?')) return
                  setRegistryMsg('Stopping download...')
                  try {
                    const res = await fetch('/api/admin/sync-schedule/kill', { method: 'POST' })
                    const data = await res.json()
                    setRegistryMsg(data.message || 'Download stopped')
                    const schedRes = await fetch('/api/admin/sync-schedule')
                    if (schedRes.ok) setSyncSchedule(await schedRes.json())
                  } catch (e) {
                    setRegistryMsg(`Error: ${e}`)
                  }
                  return
                }
                // If another download is running, don't allow starting
                if (syncSchedule?.status?.isRunning) return
                if (!confirm(`Download/update ${parquetTickers.length.toLocaleString()} tickers from yFinance?`)) return
                setRegistryMsg('Starting yFinance download...')
                try {
                  const res = await fetch('/api/admin/sync-schedule/run-now', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ source: 'yfinance', tickers: parquetTickers })
                  })
                  const data = await res.json()
                  if (res.ok) {
                    setRegistryMsg(data.message || 'yFinance download started')
                    const schedRes = await fetch('/api/admin/sync-schedule')
                    if (schedRes.ok) setSyncSchedule(await schedRes.json())
                  } else {
                    setRegistryMsg(`Error: ${data.error}`)
                  }
                } catch (e) {
                  setRegistryMsg(`Error: ${e}`)
                }
              }}
            >
              {syncSchedule?.status?.isRunning && syncSchedule?.status?.currentJob?.source === 'yfinance'
                ? '⬛ Stop yFinance'
                : syncSchedule?.status?.isRunning
                  ? 'Running...'
                  : `yFinance (${parquetTickers.length.toLocaleString()})`}
            </Button>

            {/* Tiingo Download Buttons - Three Modes */}
            <div className="flex gap-2">
              {/* Button 1: Tiingo Full - Download all historical data */}
              <Button
                variant="default"
                disabled={!tiingoKeyStatus.hasKey || syncSchedule?.status?.isRunning || !!runningDownloadJobs.full}
                onClick={async () => {
                  const tickerCount = registryStats?.active || registryTickers.length
                  if (!confirm(`Download FULL history from Tiingo for ${tickerCount.toLocaleString()} registry tickers?\n\nThis will overwrite existing parquet files.\nEstimated time: ~15 minutes`)) return
                  setRegistryMsg('Starting Tiingo Full download...')
                  try {
                    const res = await fetch('/api/download', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        mode: 'full',
                        source: 'tiingo',
                        tickers: registryTickers,
                        maxWorkers: 100,
                      })
                    })
                    const data = await res.json()
                    if (res.ok) {
                      setRunningDownloadJobs(prev => ({ ...prev, full: data.jobId }))
                      setJobLogs(prev => ({ ...prev, full: [`Job ${data.jobId} started...`] }))
                      setRegistryMsg(`Tiingo Full started (Job ${data.jobId})`)
                      console.log('[Tiingo Full] Job started:', data.jobId)
                      // Refresh sync schedule status
                      const schedRes = await fetch('/api/admin/sync-schedule')
                      if (schedRes.ok) setSyncSchedule(await schedRes.json())
                    } else {
                      setRegistryMsg(`Error: ${data.error}`)
                      console.error('[Tiingo Full] Error:', data.error)
                    }
                  } catch (e) {
                    setRegistryMsg(`Error: ${e}`)
                  }
                }}
                title={!tiingoKeyStatus.hasKey ? 'Configure Tiingo API key first' : 'Download all historical data (overwrites existing)'}
              >
                Tiingo Full ({(registryStats?.active || registryTickers.length).toLocaleString()})
              </Button>

              {/* Cancel button for Tiingo Full */}
              {runningDownloadJobs.full && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={async () => {
                    if (!confirm('Cancel Tiingo Full download?')) return
                    try {
                      const res = await fetch(`/api/download/${runningDownloadJobs.full}`, {
                        method: 'DELETE'
                      })
                      const data = await res.json()
                      if (res.ok) {
                        setRunningDownloadJobs(prev => ({ ...prev, full: undefined }))
                        setRegistryMsg('Tiingo Full cancelled')
                      } else {
                        setRegistryMsg(`Cancel failed: ${data.error}`)
                      }
                    } catch (e) {
                      setRegistryMsg(`Cancel error: ${e}`)
                    }
                  }}
                >
                  Cancel
                </Button>
              )}

              {/* Button 2: Tiingo 5d - Download last 5 days and append */}
              <Button
                variant="secondary"
                disabled={!tiingoKeyStatus.hasKey || syncSchedule?.status?.isRunning || !!runningDownloadJobs.recent}
                onClick={async () => {
                  const tickerCount = registryStats?.active || registryTickers.length
                  if (!confirm(`Download last 5 days from Tiingo for ${tickerCount.toLocaleString()} tickers?\n\nThis will append new data to existing files.\nSafe for daily updates.\nEstimated time: ~8-10 minutes`)) return
                  setRegistryMsg('Starting Tiingo 5d update...')
                  try {
                    const res = await fetch('/api/download', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        mode: 'recent',
                        source: 'tiingo',
                        tickers: registryTickers,
                        recentDays: 5,
                        maxWorkers: 100,
                      })
                    })
                    const data = await res.json()
                    if (res.ok) {
                      setRunningDownloadJobs(prev => ({ ...prev, recent: data.jobId }))
                      setJobLogs(prev => ({ ...prev, recent: [`Job ${data.jobId} started...`] }))
                      setRegistryMsg(`Tiingo 5d started (Job ${data.jobId})`)
                      console.log('[Tiingo 5d] Job started:', data.jobId)
                      const schedRes = await fetch('/api/admin/sync-schedule')
                      if (schedRes.ok) setSyncSchedule(await schedRes.json())
                    } else {
                      setRegistryMsg(`Error: ${data.error}`)
                      console.error('[Tiingo 5d] Error:', data.error)
                    }
                  } catch (e) {
                    setRegistryMsg(`Error: ${e}`)
                  }
                }}
                title={!tiingoKeyStatus.hasKey ? 'Configure Tiingo API key first' : 'Download last 5 days (appends to existing files)'}
              >
                Tiingo 5d
              </Button>

              {/* Cancel button for Tiingo 5d */}
              {runningDownloadJobs.recent && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={async () => {
                    if (!confirm('Cancel Tiingo 5d download?')) return
                    try {
                      const res = await fetch(`/api/download/${runningDownloadJobs.recent}`, {
                        method: 'DELETE'
                      })
                      const data = await res.json()
                      if (res.ok) {
                        setRunningDownloadJobs(prev => ({ ...prev, recent: undefined }))
                        setRegistryMsg('Tiingo 5d cancelled')
                      } else {
                        setRegistryMsg(`Cancel failed: ${data.error}`)
                      }
                    } catch (e) {
                      setRegistryMsg(`Cancel error: ${e}`)
                    }
                  }}
                >
                  Cancel
                </Button>
              )}

              {/* Button 3: Tiingo Prices - Fetch real-time IEX prices to CSV */}
              <Button
                variant="ghost"
                disabled={!tiingoKeyStatus.hasKey || syncSchedule?.status?.isRunning || !!runningDownloadJobs.prices}
                onClick={async () => {
                  const tickerCount = registryStats?.active || registryTickers.length
                  if (!confirm(`Fetch real-time prices for ${tickerCount.toLocaleString()} tickers?\n\nWill output CSV file.\nEstimated time: ~30-60 seconds (batch optimized!)`)) return
                  setRegistryMsg('Fetching real-time prices (batch mode)...')
                  try {
                    const res = await fetch('/api/download', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        mode: 'prices',
                        source: 'tiingo',
                        tickers: registryTickers,
                        maxWorkers: 10,
                      })
                    })
                    const data = await res.json()
                    if (res.ok) {
                      setRunningDownloadJobs(prev => ({ ...prev, prices: data.jobId }))
                      setJobLogs(prev => ({ ...prev, prices: [`Job ${data.jobId} started...`] }))
                      setRegistryMsg(`Tiingo Prices started (Job ${data.jobId}) - will create CSV`)
                      console.log('[Tiingo Prices] Job started:', data.jobId)
                      const schedRes = await fetch('/api/admin/sync-schedule')
                      if (schedRes.ok) setSyncSchedule(await schedRes.json())
                    } else {
                      setRegistryMsg(`Error: ${data.error}`)
                      console.error('[Tiingo Prices] Error:', data.error)
                    }
                  } catch (e) {
                    setRegistryMsg(`Error: ${e}`)
                  }
                }}
                title={!tiingoKeyStatus.hasKey ? 'Configure Tiingo API key first' : 'Fetch current prices from IEX (outputs CSV)'}
              >
                Tiingo Prices
              </Button>

              {/* Cancel button for Tiingo Prices */}
              {runningDownloadJobs.prices && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={async () => {
                    if (!confirm('Cancel Tiingo Prices fetch?')) return
                    try {
                      const res = await fetch(`/api/download/${runningDownloadJobs.prices}`, {
                        method: 'DELETE'
                      })
                      const data = await res.json()
                      if (res.ok) {
                        setRunningDownloadJobs(prev => ({ ...prev, prices: undefined }))
                        setRegistryMsg('Tiingo Prices cancelled')
                      } else {
                        setRegistryMsg(`Cancel failed: ${data.error}`)
                      }
                    } catch (e) {
                      setRegistryMsg(`Cancel error: ${e}`)
                    }
                  }}
                >
                  Cancel
                </Button>
              )}

              {/* Button 4: Fetch Metadata - Backfill company names for existing tickers */}
              <Button
                variant="outline"
                disabled={!tiingoKeyStatus.hasKey || syncSchedule?.status?.isRunning || !!runningDownloadJobs.metadata}
                onClick={async () => {
                  if (!confirm(`Fetch company names for tickers missing metadata?\n\nThis only fetches metadata (no data download).\nEstimated time: 2-3 minutes for ~12,000 tickers`)) return
                  setRegistryMsg('Fetching company names...')
                  try {
                    const res = await fetch('/api/admin/backfill-metadata', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' }
                    })
                    const data = await res.json()
                    if (res.ok) {
                      if (data.jobId) {
                        setRunningDownloadJobs(prev => ({ ...prev, metadata: data.jobId }))
                        setJobLogs(prev => ({ ...prev, metadata: [`Fetching metadata for ${data.tickersToProcess} tickers...`] }))
                        setRegistryMsg(`Metadata backfill started (${data.tickersToProcess} tickers)`)
                        console.log('[Metadata] Job started:', data.jobId)
                      } else {
                        setRegistryMsg(data.message || 'All tickers already have metadata')
                      }
                    } else {
                      setRegistryMsg(`Error: ${data.error}`)
                    }
                  } catch (e) {
                    setRegistryMsg(`Error: ${e}`)
                  }
                }}
                title={!tiingoKeyStatus.hasKey ? 'Configure Tiingo API key first' : 'Fetch company names for tickers that have parquet files but missing metadata. Much faster than re-downloading data (~2-3 minutes for 12,000 tickers).'}
              >
                Fetch Metadata
              </Button>

              {/* Cancel button for Metadata */}
              {runningDownloadJobs.metadata && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={async () => {
                    if (!confirm('Cancel metadata fetch?')) return
                    try {
                      const res = await fetch(`/api/download/${runningDownloadJobs.metadata}`, {
                        method: 'DELETE'
                      })
                      const data = await res.json()
                      if (res.ok) {
                        setRunningDownloadJobs(prev => ({ ...prev, metadata: undefined }))
                        setRegistryMsg('Metadata fetch cancelled')
                      } else {
                        setRegistryMsg(`Cancel failed: ${data.error}`)
                      }
                    } catch (e) {
                      setRegistryMsg(`Cancel error: ${e}`)
                    }
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>

            {/* Job Progress/Logs Display */}
            {Object.entries(runningDownloadJobs).some(([_, jobId]) => jobId) && (
              <div className="mt-4 p-4 bg-gray-900 rounded-lg border border-gray-700">
                <h4 className="text-sm font-semibold text-gray-300 mb-2">Download Progress</h4>
                {Object.entries(runningDownloadJobs).map(([mode, jobId]) => {
                  if (!jobId) return null
                  const logs = jobLogs[mode as keyof typeof jobLogs] || []
                  const lastLog = logs[logs.length - 1] || ''

                  // Parse progress from logs
                  let progress = 0
                  let progressText = 'Starting...'
                  try {
                    const progressLogs = logs.filter(log => {
                      try {
                        const parsed = JSON.parse(log)
                        return parsed.type === 'ticker_saved' || parsed.type === 'batch_fetched'
                      } catch {
                        return false
                      }
                    })
                    if (progressLogs.length > 0) {
                      const latest = JSON.parse(progressLogs[progressLogs.length - 1])
                      if (latest.saved && latest.total) {
                        progress = (latest.saved / latest.total) * 100
                        progressText = `${latest.saved.toLocaleString()} / ${latest.total.toLocaleString()}`
                      } else if (latest.total_fetched && latest.total_tickers) {
                        progress = (latest.total_fetched / latest.total_tickers) * 100
                        progressText = `${latest.total_fetched.toLocaleString()} / ${latest.total_tickers.toLocaleString()}`
                      }
                    }
                  } catch {}

                  return (
                    <div key={mode} className="mb-4 last:mb-0">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-gray-400 uppercase">{mode}</span>
                        <span className="text-xs text-gray-500">{progressText}</span>
                      </div>
                      {progress > 0 && (
                        <div className="w-full bg-gray-800 rounded-full h-2 mb-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${Math.min(100, progress)}%` }}
                          />
                        </div>
                      )}
                      <div className="max-h-32 overflow-y-auto bg-black/30 rounded p-2 text-xs font-mono">
                        {logs.slice(-10).map((log, i) => (
                          <div key={i} className="text-gray-400 whitespace-pre-wrap break-all">{log}</div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Refresh Stats */}
            <Button
              variant="ghost"
              onClick={async () => {
                const [statsRes, schedRes, parquetRes] = await Promise.all([
                  fetch('/api/tickers/registry/stats'),
                  fetch('/api/admin/sync-schedule'),
                  fetch('/api/parquet-tickers')
                ])
                if (statsRes.ok) setRegistryStats(await statsRes.json())
                if (schedRes.ok) setSyncSchedule(await schedRes.json())
                if (parquetRes.ok) {
                  const data = await parquetRes.json()
                  setParquetTickers(data.tickers || [])
                }
                setRegistryMsg('Stats refreshed')
              }}
            >
              Refresh Stats
            </Button>
          </div>

          {/* ========== BATCH & PAUSE SETTINGS ========== */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1">
            <div className="flex items-center gap-2">
              <label className="text-sm text-muted-foreground whitespace-nowrap">Batch Size:</label>
              <input
                type="number"
                min="1"
                max="500"
                value={syncSchedule?.config?.batchSize ?? 100}
                onChange={async (e) => {
                  const val = Math.max(1, Math.min(500, parseInt(e.target.value) || 100))
                  try {
                    const res = await fetch('/api/admin/sync-schedule', {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ batchSize: val })
                    })
                    if (res.ok) {
                      const schedRes = await fetch('/api/admin/sync-schedule')
                      if (schedRes.ok) setSyncSchedule(await schedRes.json())
                    }
                  } catch {
                    setRegistryMsg('Error updating batch size')
                  }
                }}
                className="w-20 px-2 py-1 rounded border border-border bg-background text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-muted-foreground whitespace-nowrap">yFinance Pause:</label>
              <input
                type="number"
                min="0"
                max="60"
                step="0.5"
                value={syncSchedule?.config?.sleepSeconds ?? 2}
                onChange={async (e) => {
                  const val = Math.max(0, Math.min(60, parseFloat(e.target.value) || 2))
                  try {
                    const res = await fetch('/api/admin/sync-schedule', {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ sleepSeconds: val })
                    })
                    if (res.ok) {
                      const schedRes = await fetch('/api/admin/sync-schedule')
                      if (schedRes.ok) setSyncSchedule(await schedRes.json())
                    }
                  } catch {
                    setRegistryMsg('Error updating pause time')
                  }
                }}
                className="w-16 px-2 py-1 rounded border border-border bg-background text-sm"
                title="Pause between yFinance batches (seconds)"
              />
              <span className="text-xs text-muted-foreground">s</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-muted-foreground whitespace-nowrap">Tiingo Pause:</label>
              <input
                type="number"
                min="0"
                max="10"
                step="0.1"
                value={syncSchedule?.config?.tiingoSleepSeconds ?? 0.2}
                onChange={async (e) => {
                  const val = Math.max(0, Math.min(10, parseFloat(e.target.value) || 0.2))
                  try {
                    const res = await fetch('/api/admin/sync-schedule', {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ tiingoSleepSeconds: val })
                    })
                    if (res.ok) {
                      const schedRes = await fetch('/api/admin/sync-schedule')
                      if (schedRes.ok) setSyncSchedule(await schedRes.json())
                    }
                  } catch {
                    setRegistryMsg('Error updating Tiingo pause time')
                  }
                }}
                className="w-16 px-2 py-1 rounded border border-border bg-background text-sm"
                title="Pause between Tiingo API calls (seconds) - 0.2s recommended"
              />
              <span className="text-xs text-muted-foreground">s</span>
            </div>
          </div>

          {/* ========== SCHEDULE SETTINGS ========== */}
          <div className="p-4 rounded-lg bg-muted/50 border border-border">
            <div className="flex items-center justify-between mb-3">
              <div className="font-bold text-sm">Auto-Download Schedule</div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={syncSchedule?.config?.enabled ?? true}
                  onChange={async (e) => {
                    try {
                      const res = await fetch('/api/admin/sync-schedule', {
                        method: 'PUT',
                        headers: {
                          'Content-Type': 'application/json',
                          Authorization: `Bearer ${getAuthToken()}`
                        },
                        body: JSON.stringify({ enabled: e.target.checked })
                      })
                      if (res.ok) {
                        const schedRes = await fetch('/api/admin/sync-schedule', {
                          headers: { Authorization: `Bearer ${getAuthToken()}` }
                        })
                        if (schedRes.ok) setSyncSchedule(await schedRes.json())
                        setRegistryMsg(e.target.checked ? 'Schedule enabled' : 'Schedule disabled')
                      }
                    } catch {
                      setRegistryMsg('Error updating schedule')
                    }
                  }}
                  className="w-4 h-4"
                />
                <span className="text-sm">{syncSchedule?.config?.enabled ? 'Enabled' : 'Disabled'}</span>
              </label>
            </div>

            {/* Tiingo 5d Schedule */}
            <div className="mb-3 p-3 rounded bg-background/50 border border-border/50">
              <div className="font-semibold text-sm mb-2">Tiingo 5d</div>
              <div className="flex items-center gap-2 mb-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={syncSchedule?.config?.tiingo5d?.enabled ?? true}
                    onChange={(e) => {
                      if (syncSchedule) {
                        setSyncSchedule({
                          ...syncSchedule,
                          config: {
                            ...syncSchedule.config,
                            tiingo5d: {
                              ...syncSchedule.config.tiingo5d,
                              enabled: e.target.checked,
                              updateTime: syncSchedule.config.tiingo5d?.updateTime ?? '18:00',
                              timezone: syncSchedule.config.tiingo5d?.timezone ?? 'America/New_York'
                            }
                          }
                        })
                      }
                    }}
                    className="w-4 h-4 cursor-pointer"
                  />
                  <span className="text-xs">{(syncSchedule?.config?.tiingo5d?.enabled ?? true) ? 'Enabled' : 'Disabled'}</span>
                </label>
                <span className="text-xs text-muted-foreground ml-auto">
                  {syncSchedule?.config?.tiingo5d?.timezone ?? 'America/New_York'} (weekdays only)
                </span>
              </div>
              <div className="flex items-center gap-2 mb-2 relative">
                <label className="text-sm text-muted-foreground w-20">Daily at:</label>
                <div
                  onClick={() => {
                    setTempTime5d(syncSchedule?.config?.tiingo5d?.updateTime ?? '18:00')
                    setTimePickerOpen(timePickerOpen === '5d' ? null : '5d')
                  }}
                  className="time-picker-trigger px-2 py-1 rounded border border-border bg-background text-sm cursor-pointer hover:bg-accent/50 min-w-[100px]"
                >
                  {formatTime(syncSchedule?.config?.tiingo5d?.updateTime ?? '18:00')}
                </div>

                {/* Dropdown menu */}
                {timePickerOpen === '5d' && (
                  <div className="time-picker-menu absolute top-full left-20 mt-1 p-3 rounded border border-border bg-popover shadow-lg z-50 flex flex-col gap-2">
                    <input
                      type="time"
                      value={tempTime5d}
                      onChange={(e) => setTempTime5d(e.target.value)}
                      className="px-2 py-1 rounded border border-border bg-background text-sm"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          try {
                            const res = await fetch('/api/admin/sync-schedule', {
                              method: 'PUT',
                              headers: {
                                'Content-Type': 'application/json',
                                Authorization: `Bearer ${getAuthToken()}`
                              },
                              body: JSON.stringify({
                                tiingo5d: {
                                  enabled: syncSchedule?.config?.tiingo5d?.enabled ?? true,
                                  updateTime: tempTime5d,
                                  timezone: syncSchedule?.config?.tiingo5d?.timezone ?? 'America/New_York'
                                }
                              })
                            })
                            if (res.ok) {
                              const data = await res.json()
                              console.log('[Tiingo 5d Save] Response data:', data)
                              console.log('[Tiingo 5d Save] New updateTime:', data.config?.tiingo5d?.updateTime)
                              setRegistryMsg(`Tiingo 5d schedule saved to ${tempTime5d}`)
                              setTimePickerOpen(null)
                              // Update state with the saved config from the response
                              if (syncSchedule && data.config) {
                                const newSchedule = {
                                  ...syncSchedule,
                                  config: data.config
                                }
                                console.log('[Tiingo 5d Save] Setting new schedule:', newSchedule)
                                setSyncSchedule(newSchedule)
                              }
                            } else {
                              const error = await res.text()
                              console.error('[Tiingo 5d Save] Error response:', error)
                              setRegistryMsg('Error saving Tiingo 5d schedule')
                            }
                          } catch (err) {
                            console.error('[Tiingo 5d Save] Exception:', err)
                            setRegistryMsg('Error saving Tiingo 5d schedule')
                          }
                        }}
                        className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setTimePickerOpen(null)}
                        className="px-3 py-1 text-xs bg-secondary text-secondary-foreground rounded hover:bg-secondary/90"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                Last ran at {syncSchedule?.lastSync?.tiingo_5d?.timestamp
                  ? new Date(syncSchedule.lastSync.tiingo_5d.timestamp).toLocaleString()
                  : '(Never)'}
              </div>
            </div>

            {/* Tiingo Full Schedule */}
            <div className="p-3 rounded bg-background/50 border border-border/50">
              <div className="font-semibold text-sm mb-2">Tiingo Full</div>
              <div className="flex items-center gap-2 mb-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={syncSchedule?.config?.tiingoFull?.enabled ?? true}
                    onChange={(e) => {
                      if (syncSchedule) {
                        setSyncSchedule({
                          ...syncSchedule,
                          config: {
                            ...syncSchedule.config,
                            tiingoFull: {
                              ...syncSchedule.config.tiingoFull,
                              enabled: e.target.checked,
                              updateTime: syncSchedule.config.tiingoFull?.updateTime ?? '18:00',
                              timezone: syncSchedule.config.tiingoFull?.timezone ?? 'America/New_York',
                              dayOfMonth: syncSchedule.config.tiingoFull?.dayOfMonth ?? 1
                            }
                          }
                        })
                      }
                    }}
                    className="w-4 h-4 cursor-pointer"
                  />
                  <span className="text-xs">{(syncSchedule?.config?.tiingoFull?.enabled ?? true) ? 'Enabled' : 'Disabled'}</span>
                </label>
                <span className="text-xs text-muted-foreground ml-auto">
                  {syncSchedule?.config?.tiingoFull?.timezone ?? 'America/New_York'}
                </span>
              </div>
              <div className="flex items-center gap-2 mb-2 relative">
                <label className="text-sm text-muted-foreground w-20">Monthly at:</label>
                <div
                  onClick={() => {
                    setTempTimeFull(syncSchedule?.config?.tiingoFull?.updateTime ?? '18:00')
                    setTimePickerOpen(timePickerOpen === 'full' ? null : 'full')
                  }}
                  className="time-picker-trigger px-2 py-1 rounded border border-border bg-background text-sm cursor-pointer hover:bg-accent/50 min-w-[100px]"
                >
                  {formatTime(syncSchedule?.config?.tiingoFull?.updateTime ?? '18:00')}
                </div>
                <span className="text-xs text-muted-foreground">on day 1</span>

                {/* Dropdown menu */}
                {timePickerOpen === 'full' && (
                  <div className="time-picker-menu absolute top-full left-20 mt-1 p-3 rounded border border-border bg-popover shadow-lg z-50 flex flex-col gap-2">
                    <input
                      type="time"
                      value={tempTimeFull}
                      onChange={(e) => setTempTimeFull(e.target.value)}
                      className="px-2 py-1 rounded border border-border bg-background text-sm"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          try {
                            const res = await fetch('/api/admin/sync-schedule', {
                              method: 'PUT',
                              headers: {
                                'Content-Type': 'application/json',
                                Authorization: `Bearer ${getAuthToken()}`
                              },
                              body: JSON.stringify({
                                tiingoFull: {
                                  enabled: syncSchedule?.config?.tiingoFull?.enabled ?? true,
                                  updateTime: tempTimeFull,
                                  timezone: syncSchedule?.config?.tiingoFull?.timezone ?? 'America/New_York',
                                  dayOfMonth: syncSchedule?.config?.tiingoFull?.dayOfMonth ?? 1
                                }
                              })
                            })
                            if (res.ok) {
                              const data = await res.json()
                              console.log('[Tiingo Full Save] Response data:', data)
                              console.log('[Tiingo Full Save] New updateTime:', data.config?.tiingoFull?.updateTime)
                              setRegistryMsg(`Tiingo Full schedule saved to ${tempTimeFull}`)
                              setTimePickerOpen(null)
                              // Update state with the saved config from the response
                              if (syncSchedule && data.config) {
                                const newSchedule = {
                                  ...syncSchedule,
                                  config: data.config
                                }
                                console.log('[Tiingo Full Save] Setting new schedule:', newSchedule)
                                setSyncSchedule(newSchedule)
                              }
                            } else {
                              const error = await res.text()
                              console.error('[Tiingo Full Save] Error response:', error)
                              setRegistryMsg('Error saving Tiingo Full schedule')
                            }
                          } catch (err) {
                            console.error('[Tiingo Full Save] Exception:', err)
                            setRegistryMsg('Error saving Tiingo Full schedule')
                          }
                        }}
                        className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setTimePickerOpen(null)}
                        className="px-3 py-1 text-xs bg-secondary text-secondary-foreground rounded hover:bg-secondary/90"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                Last ran at {syncSchedule?.lastSync?.tiingo_full?.timestamp
                  ? new Date(syncSchedule.lastSync.tiingo_full.timestamp).toLocaleString()
                  : '(Never)'}
              </div>
            </div>
          </div>

          {/* Status message */}
          {registryMsg && (
            <div className={`text-sm ${registryMsg.includes('Error') ? 'text-destructive' : 'text-success'}`}>
              {registryMsg}
            </div>
          )}

          {/* ========== COLLAPSIBLE SECTIONS ========== */}
          <details className="group">
            <summary className="cursor-pointer font-bold text-sm py-2 hover:text-primary">
              API Key Settings
            </summary>
            <div className="mt-2 p-3 bg-muted rounded-lg text-sm space-y-3">
              <div className="flex items-center gap-2">
                <strong>Tiingo API Key:</strong>
                {tiingoKeyStatus.loading ? (
                  <span className="text-muted-foreground">Checking...</span>
                ) : tiingoKeyStatus.hasKey ? (
                  <span className="text-success">Configured</span>
                ) : (
                  <span className="text-destructive">Not configured</span>
                )}
              </div>
              {!tiingoKeyStatus.hasKey && (
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={tiingoKeyInput}
                    onChange={(e) => setTiingoKeyInput(e.target.value)}
                    className="flex-1 px-3 py-2 rounded border border-border bg-background text-sm"
                    placeholder="Enter Tiingo API key"
                  />
                  <Button
                    size="sm"
                    disabled={!tiingoKeyInput.trim() || tiingoKeySaving}
                    onClick={async () => {
                      setTiingoKeySaving(true)
                      try {
                        const res = await fetch('/api/admin/tiingo-key', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ key: tiingoKeyInput.trim() })
                        })
                        if (res.ok) {
                          setTiingoKeyStatus({ hasKey: true, loading: false })
                          setTiingoKeyInput('')
                        }
                      } finally {
                        setTiingoKeySaving(false)
                      }
                    }}
                  >
                    Save
                  </Button>
                </div>
              )}
              {tiingoKeyStatus.hasKey && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    if (!confirm('Remove API key?')) return
                    const res = await fetch('/api/admin/tiingo-key', { method: 'DELETE' })
                    if (res.ok) setTiingoKeyStatus({ hasKey: false, loading: false })
                  }}
                >
                  Remove Key
                </Button>
              )}
            </div>
          </details>

          <details className="group">
            <summary className="cursor-pointer font-bold text-sm py-2 hover:text-primary">
              Cache Management
            </summary>
            <div className="mt-2 p-3 bg-muted rounded-lg text-sm space-y-3">
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div><strong>Cached:</strong> {cacheStats?.entryCount ?? 0} systems</div>
                <div><strong>Size:</strong> {cacheStats?.totalSizeBytes ? `${(cacheStats.totalSizeBytes / 1024).toFixed(1)} KB` : '0'}</div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={cacheRefreshing}
                  onClick={async () => {
                    if (!confirm('Clear all cached backtest results?')) return
                    setCacheRefreshing(true)
                    try {
                      await fetch(`${API_BASE}/admin/cache/invalidate`, {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${getAuthToken()}` }
                      })
                      const res = await fetch(`${API_BASE}/admin/cache/stats`, {
                        headers: { Authorization: `Bearer ${getAuthToken()}` }
                      })
                      if (res.ok) setCacheStats(await res.json())
                    } finally {
                      setCacheRefreshing(false)
                    }
                  }}
                >
                  Clear Cache
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  disabled={prewarmRunning}
                  onClick={async () => {
                    if (!confirm('Run backtests for all systems?')) return
                    setPrewarmRunning(true)
                    try {
                      await fetch(`${API_BASE}/admin/cache/prewarm`, {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          Authorization: `Bearer ${getAuthToken()}`
                        },
                        body: JSON.stringify({ includeSanity: true })
                      })
                      onPrewarmComplete?.()
                    } finally {
                      setPrewarmRunning(false)
                    }
                  }}
                >
                  {prewarmRunning ? 'Running...' : 'Prewarm Cache'}
                </Button>
              </div>
            </div>
          </details>

          <details className="group">
            <summary className="cursor-pointer font-bold text-sm py-2 hover:text-primary">
              Available Tickers ({parquetTickers.length.toLocaleString()})
            </summary>
            <div className="mt-2 max-h-[200px] overflow-auto border rounded-lg p-2 bg-background text-xs font-mono">
              {parquetTickers.join(', ') || 'No tickers available'}
            </div>
          </details>

          <details className="group">
            <summary className="cursor-pointer font-bold text-sm py-2 hover:text-primary">
              <span className={missingTickers.length > 0 ? 'text-warning' : ''}>
                Missing Tickers ({missingTickers.length.toLocaleString()})
              </span>
              {missingTickers.length > 0 && (
                <span className="ml-2 text-xs text-muted-foreground">
                  (in registry but no parquet file)
                </span>
              )}
            </summary>
            <div className="mt-2 space-y-2">
              <div className="text-xs text-muted-foreground">
                Registry: {registryTickers.length.toLocaleString()} tickers |
                Parquet: {parquetTickers.length.toLocaleString()} files |
                Missing: {missingTickers.length.toLocaleString()}
              </div>
              {missingTickers.length > 0 && (
                <div className="flex items-center gap-2 my-2">
                  <Button
                    variant="default"
                    size="sm"
                    disabled={missingDownloadJob?.status === 'running' || syncSchedule?.status?.isRunning}
                    onClick={async () => {
                      if (!confirm(`Download ${missingTickers.length.toLocaleString()} missing tickers? This may take a while.`)) return
                      setRegistryMsg('Starting download of missing tickers...')
                      try {
                        const res = await fetch('/api/tickers/download-specific', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ tickers: missingTickers })
                        })
                        const data = await res.json()
                        if (res.ok && data.jobId) {
                          setMissingDownloadJob({ jobId: data.jobId, status: 'running', saved: 0, total: data.tickerCount })
                          setRegistryMsg(`Download started (Job: ${data.jobId})`)
                          // Poll for job status
                          const poll = setInterval(async () => {
                            try {
                              const jobRes = await fetch(`/api/download/${data.jobId}`)
                              if (jobRes.ok) {
                                const job = await jobRes.json()
                                const saved = job.syncedTickers?.length ?? 0
                                setMissingDownloadJob(prev => prev ? { ...prev, status: job.status, saved } : null)
                                if (job.status === 'done' || job.status === 'error') {
                                  clearInterval(poll)
                                  setRegistryMsg(job.status === 'done'
                                    ? `Download complete: ${saved} tickers saved`
                                    : `Download failed: ${job.error || 'Unknown error'}`)
                                  // Refresh parquet list
                                  const parquetRes = await fetch('/api/parquet-tickers')
                                  if (parquetRes.ok) {
                                    const pData = await parquetRes.json()
                                    setParquetTickers(pData.tickers || [])
                                  }
                                }
                              }
                            } catch { /* ignore polling errors */ }
                          }, 2000)
                        } else {
                          setRegistryMsg(`Error: ${data.error || 'Failed to start download'}`)
                        }
                      } catch (e) {
                        setRegistryMsg(`Error: ${e}`)
                      }
                    }}
                  >
                    {missingDownloadJob?.status === 'running'
                      ? `Downloading... (${missingDownloadJob.saved}/${missingDownloadJob.total})`
                      : `Download Missing (${missingTickers.length.toLocaleString()})`}
                  </Button>
                  {missingDownloadJob?.status === 'running' && (
                    <span className="text-xs text-muted-foreground">
                      {((missingDownloadJob.saved / missingDownloadJob.total) * 100).toFixed(0)}% complete
                    </span>
                  )}
                </div>
              )}
              {missingTickers.length > 0 ? (
                <div className="max-h-[200px] overflow-auto border rounded-lg p-2 bg-background text-xs font-mono">
                  {missingTickers.join(', ')}
                </div>
              ) : registryTickers.length === 0 ? (
                <div className="text-muted-foreground text-sm">Loading registry...</div>
              ) : (
                <div className="text-success text-sm">All registry tickers have parquet files!</div>
              )}
            </div>
          </details>

          <details className="group">
            <summary className="cursor-pointer font-bold text-sm py-2 hover:text-primary">
              Data Viewer
            </summary>
            <div className="mt-2">
              {parquetTickers.length > 0 ? (
                <AdminDataPanel tickers={parquetTickers} error={error} />
              ) : (
                <div className="text-muted-foreground text-sm">No parquet files available</div>
              )}
            </div>
          </details>
        </div>
      )}

      {/* Trading Control Tab - Main Admin Only, Local Only */}
      {adminTab === 'Trading Control' && isSuperAdmin && (
        <div className="space-y-6">
          <div className="font-black text-lg">Trading Control</div>
          <p className="text-sm text-muted-foreground">
            Connect to Alpaca for paper and live trading. Credentials are stored encrypted locally and never leave this machine.
          </p>

          {/* Paper Trading Credentials Card */}
          <Card className="p-6">
            <div className="font-bold mb-4 flex items-center gap-2">
              Paper Trading Credentials
              {paperCredentials?.hasCredentials && (
                <span className="px-2 py-0.5 rounded text-xs bg-yellow-500/20 text-yellow-500">
                  Configured
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Using paper-api.alpaca.markets (safe for testing)
            </p>

            {paperError && (
              <div className="text-destructive text-sm p-3 bg-destructive/10 rounded-lg mb-4">
                {paperError}
              </div>
            )}

            {paperAccount ? (
              <div className="mb-6 p-4 bg-muted/50 rounded-lg">
                <div className="grid grid-cols-4 gap-4 text-sm">
                  <div>
                    <div className="text-muted-foreground">Equity</div>
                    <div className="font-bold text-lg">${paperAccount.equity.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Cash</div>
                    <div className="font-bold text-lg">${paperAccount.cash.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Buying Power</div>
                    <div className="font-bold text-lg">${paperAccount.buyingPower.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Status</div>
                    <div className={`font-bold text-lg ${paperAccount.status === 'ACTIVE' ? 'text-green-500' : 'text-yellow-500'}`}>
                      {paperAccount.status}
                    </div>
                  </div>
                </div>
              </div>
            ) : paperCredentials?.hasCredentials ? (
              <div className="mb-6 p-4 bg-muted/50 rounded-lg text-muted-foreground">
                Credentials saved. Click "Test Connection" to verify.
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">API Key</label>
                <input
                  type="password"
                  value={paperApiKey}
                  onChange={(e) => setPaperApiKey(e.target.value)}
                  placeholder={paperCredentials?.hasCredentials ? '••••••••••••' : 'Enter Alpaca Paper API Key'}
                  className="w-full px-3 py-2 rounded border border-border bg-background text-sm"
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">API Secret</label>
                <input
                  type="password"
                  value={paperApiSecret}
                  onChange={(e) => setPaperApiSecret(e.target.value)}
                  placeholder={paperCredentials?.hasCredentials ? '••••••••••••' : 'Enter Alpaca Paper API Secret'}
                  className="w-full px-3 py-2 rounded border border-border bg-background text-sm"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={async () => {
                  if (!paperApiKey || !paperApiSecret) {
                    setPaperError('Please enter both API Key and API Secret')
                    return
                  }
                  setPaperSaving(true)
                  setPaperError(null)
                  try {
                    const res = await fetch(`${API_BASE}/admin/broker/credentials`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken()}` },
                      body: JSON.stringify({ apiKey: paperApiKey, apiSecret: paperApiSecret, credentialType: 'paper' }),
                    })
                    const data = await res.json()
                    if (!res.ok) throw new Error(data.error || 'Failed to save credentials')
                    setPaperCredentials({ hasCredentials: true, baseUrl: 'https://paper-api.alpaca.markets' })
                    setPaperApiKey('')
                    setPaperApiSecret('')
                  } catch (e) {
                    setPaperError(String((e as Error)?.message || e))
                  } finally {
                    setPaperSaving(false)
                  }
                }}
                disabled={paperSaving || (!paperApiKey && !paperApiSecret)}
              >
                {paperSaving ? 'Saving...' : 'Save Credentials'}
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  setPaperTesting(true)
                  setPaperError(null)
                  try {
                    const res = await fetch(`${API_BASE}/admin/broker/test`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken()}` },
                      body: JSON.stringify({ credentialType: 'paper' }),
                    })
                    const data = await res.json()
                    if (!res.ok) throw new Error(data.error || 'Connection test failed')
                    setPaperAccount(data.account)
                  } catch (e) {
                    setPaperError(String((e as Error)?.message || e))
                    setPaperAccount(null)
                  } finally {
                    setPaperTesting(false)
                  }
                }}
                disabled={paperTesting || !paperCredentials?.hasCredentials}
              >
                {paperTesting ? 'Testing...' : 'Test Connection'}
              </Button>
            </div>
          </Card>

          {/* Live Trading Credentials Card */}
          <Card className="p-6 border-green-500/30">
            <div className="font-bold mb-4 flex items-center gap-2">
              Live Trading Credentials
              {liveCredentials?.hasCredentials && (
                <span className="px-2 py-0.5 rounded text-xs bg-green-500/20 text-green-500">
                  Configured
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Using api.alpaca.markets (REAL MONEY - use with caution!)
            </p>

            {liveError && (
              <div className="text-destructive text-sm p-3 bg-destructive/10 rounded-lg mb-4">
                {liveError}
              </div>
            )}

            {liveAccount ? (
              <div className="mb-6 p-4 bg-green-500/10 rounded-lg">
                <div className="grid grid-cols-4 gap-4 text-sm">
                  <div>
                    <div className="text-muted-foreground">Equity</div>
                    <div className="font-bold text-lg text-green-500">${liveAccount.equity.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Cash</div>
                    <div className="font-bold text-lg text-green-500">${liveAccount.cash.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Buying Power</div>
                    <div className="font-bold text-lg text-green-500">${liveAccount.buyingPower.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Status</div>
                    <div className={`font-bold text-lg ${liveAccount.status === 'ACTIVE' ? 'text-green-500' : 'text-yellow-500'}`}>
                      {liveAccount.status}
                    </div>
                  </div>
                </div>
              </div>
            ) : liveCredentials?.hasCredentials ? (
              <div className="mb-6 p-4 bg-muted/50 rounded-lg text-muted-foreground">
                Credentials saved. Click "Test Connection" to verify.
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">API Key</label>
                <input
                  type="password"
                  value={liveApiKey}
                  onChange={(e) => setLiveApiKey(e.target.value)}
                  placeholder={liveCredentials?.hasCredentials ? '••••••••••••' : 'Enter Alpaca Live API Key'}
                  className="w-full px-3 py-2 rounded border border-border bg-background text-sm"
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">API Secret</label>
                <input
                  type="password"
                  value={liveApiSecret}
                  onChange={(e) => setLiveApiSecret(e.target.value)}
                  placeholder={liveCredentials?.hasCredentials ? '••••••••••••' : 'Enter Alpaca Live API Secret'}
                  className="w-full px-3 py-2 rounded border border-border bg-background text-sm"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={async () => {
                  if (!liveApiKey || !liveApiSecret) {
                    setLiveError('Please enter both API Key and API Secret')
                    return
                  }
                  setLiveSaving(true)
                  setLiveError(null)
                  try {
                    const res = await fetch(`${API_BASE}/admin/broker/credentials`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken()}` },
                      body: JSON.stringify({ apiKey: liveApiKey, apiSecret: liveApiSecret, credentialType: 'live' }),
                    })
                    const data = await res.json()
                    if (!res.ok) throw new Error(data.error || 'Failed to save credentials')
                    setLiveCredentials({ hasCredentials: true, baseUrl: 'https://api.alpaca.markets' })
                    setLiveApiKey('')
                    setLiveApiSecret('')
                  } catch (e) {
                    setLiveError(String((e as Error)?.message || e))
                  } finally {
                    setLiveSaving(false)
                  }
                }}
                disabled={liveSaving || (!liveApiKey && !liveApiSecret)}
              >
                {liveSaving ? 'Saving...' : 'Save Credentials'}
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  setLiveTesting(true)
                  setLiveError(null)
                  try {
                    const res = await fetch(`${API_BASE}/admin/broker/test`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken()}` },
                      body: JSON.stringify({ credentialType: 'live' }),
                    })
                    const data = await res.json()
                    if (!res.ok) throw new Error(data.error || 'Connection test failed')
                    setLiveAccount(data.account)
                  } catch (e) {
                    setLiveError(String((e as Error)?.message || e))
                    setLiveAccount(null)
                  } finally {
                    setLiveTesting(false)
                  }
                }}
                disabled={liveTesting || !liveCredentials?.hasCredentials}
              >
                {liveTesting ? 'Testing...' : 'Test Connection'}
              </Button>
            </div>
          </Card>

          {/* Execute Trades Now Section */}
          <Card className="p-6">
            <div className="font-bold mb-2">Execute Trades Now</div>
            <p className="text-sm text-muted-foreground mb-3">
              Execute trades immediately using current allocations from your invested bots.
              Trades execute now (not at market close).
              <span className="block mt-1 font-bold text-yellow-600 dark:text-yellow-400">
                ⚠️ Use Paper for testing before running on Live.
              </span>
            </p>

            <div className="flex items-center gap-4 mb-4">
              <div>
                <label className="text-sm text-muted-foreground mb-1 block" title="Amount of cash to reserve before calculating trade allocations">
                  Cash Reserve
                  <span className="ml-1 cursor-help text-muted-foreground/60">ⓘ</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={dryRunCashReserve}
                    onChange={(e) => setDryRunCashReserve(parseFloat(e.target.value) || 0)}
                    className="w-24 px-2 py-2 rounded border border-border bg-background text-sm"
                    title={dryRunCashMode === 'dollars' ? 'Fixed dollar amount to keep as cash' : 'Percentage of equity to keep as cash'}
                  />
                  <select
                    value={dryRunCashMode}
                    onChange={(e) => setDryRunCashMode(e.target.value as 'dollars' | 'percent')}
                    className="px-2 py-2 rounded border border-border bg-background text-sm"
                    title="Choose between fixed dollar amount ($) or percentage (%)"
                  >
                    <option value="dollars">$</option>
                    <option value="percent">%</option>
                  </select>
                </div>
              </div>

              {/* Price Data Quality Indicator */}
              {priceDataQuality?.degradedMode && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 mt-4">
                  <span className="text-yellow-500">⚠️</span>
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-yellow-500">
                      Degraded Data Mode
                    </span>
                    <span className="text-xs text-yellow-500/80">
                      Using Alpaca fallback for {priceDataQuality.fallbackCount} of {priceDataQuality.totalTickers} tickers
                    </span>
                  </div>
                </div>
              )}

              {priceDataQuality && priceDataQuality.emergencyCount > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 mt-4">
                  <span className="text-red-500">🚨</span>
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-red-500">
                      Missing Price Data
                    </span>
                    <span className="text-xs text-red-500/80">
                      {priceDataQuality.emergencyCount} ticker(s) have no price data - positions skipped
                    </span>
                  </div>
                </div>
              )}

              <div className="flex gap-2 mt-5">
                {/* Simulate button (no orders placed) */}
                <Button
                  onClick={() => {
                    setExecutionMode('simulate')
                    executeNow('simulate')
                  }}
                  disabled={dryRunRunning || !brokerCredentials?.hasCredentials}
                  variant="outline"
                  title="Preview what trades would be executed without placing any real orders"
                >
                  {dryRunRunning && executionMode === 'simulate'
                    ? '⏳ Simulating...'
                    : '🔍 Simulate (Preview Only)'}
                </Button>

                {/* Paper button */}
                <Button
                  onClick={() => {
                    setExecutionMode('execute-paper')
                    executeNow('execute-paper')
                  }}
                  disabled={dryRunRunning || !brokerCredentials?.hasCredentials}
                  variant="default"
                  title="Execute trades immediately on your paper (simulated) account for testing"
                >
                  {dryRunRunning && executionMode === 'execute-paper'
                    ? '⏳ Executing on Paper...'
                    : '📄 Execute Now (Paper)'}
                </Button>

                {/* Live button */}
                <Button
                  onClick={() => {
                    setExecutionMode('execute-live')
                    setShowLiveConfirmation(true)
                  }}
                  disabled={dryRunRunning || !brokerCredentials?.hasCredentials}
                  variant="destructive"
                  title="Execute trades immediately on your LIVE account with REAL MONEY - requires confirmation"
                >
                  {dryRunRunning && executionMode === 'execute-live'
                    ? '⏳ Executing on Live...'
                    : '🔴 Execute Now (Live)'}
                </Button>
              </div>
            </div>

            {/* Live Execution Confirmation Dialog */}
            {showLiveConfirmation && (
              <div
                className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
                onClick={() => {
                  setShowLiveConfirmation(false)
                  setExecutionMode(null)
                }}
              >
                <Card
                  className="max-w-md p-6 m-4"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h3 className="text-lg font-bold mb-2 text-destructive flex items-center gap-2">
                    <span>⚠️</span>
                    Execute Live Trades Now?
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    This will <span className="font-bold">IMMEDIATELY</span> execute trades on your{' '}
                    <span className="font-bold text-destructive">LIVE Alpaca account</span> using real money.
                  </p>
                  <p className="text-sm text-muted-foreground mb-4">
                    The system will:
                  </p>
                  <ul className="text-sm text-muted-foreground mb-4 list-disc list-inside space-y-1">
                    <li>Cancel all pending orders</li>
                    <li>Sell positions not in target allocation</li>
                    <li>Buy positions according to bot allocations</li>
                  </ul>
                  <p className="text-sm font-bold mb-4">
                    Are you sure you want to proceed?
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setShowLiveConfirmation(false)
                        setExecutionMode(null)
                      }}
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => executeNow('execute-live')}
                      className="flex-1"
                    >
                      ✓ Confirm Live Execution
                    </Button>
                  </div>
                </Card>
              </div>
            )}

            {dryRunResult && (
              <div className="mt-4 space-y-4">
                {/* Execution Mode Indicator */}
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border border-border">
                  <div className="flex items-center gap-2">
                    {dryRunResult.executionMode === 'execute-live' ? (
                      <>
                        <span className="text-lg">🔴</span>
                        <span className="font-bold text-destructive">LIVE Execution</span>
                      </>
                    ) : (
                      <>
                        <span className="text-lg">📄</span>
                        <span className="font-bold">Paper Execution</span>
                      </>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {dryRunResult.executedAt && new Date(dryRunResult.executedAt).toLocaleString()}
                  </div>
                </div>

                {/* Data Source Indicator */}
                <div className="flex items-center gap-2 text-sm text-blue-600">
                  <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                  Using Tiingo data for signals, Alpaca prices for execution
                </div>
                {dryRunResult.botBreakdown && dryRunResult.botBreakdown.length === 0 && (
                  <div className="flex items-center gap-2 text-sm text-yellow-600">
                    <span className="w-2 h-2 bg-yellow-500 rounded-full"></span>
                    No bot allocations available
                  </div>
                )}

                {/* Bot Breakdown */}
                {dryRunResult.botBreakdown && dryRunResult.botBreakdown.length > 0 && (
                  <div className="p-4 bg-muted/30 rounded-lg">
                    <div className="font-medium mb-2">Bot Allocations (as of {dryRunResult.botBreakdown[0]?.date || 'today'})</div>
                    <div className="grid gap-3">
                      {dryRunResult.botBreakdown.map(bot => (
                        <div key={bot.botId} className="flex items-start gap-4 text-sm">
                          <div className="flex-1">
                            <div className="font-medium">{bot.botName}</div>
                            <div className="text-muted-foreground text-xs">
                              ${bot.investment.toLocaleString()} ({bot.weight})
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(bot.allocations)
                              .filter(([, pct]) => pct > 0)
                              .sort((a, b) => b[1] - a[1])
                              .map(([ticker, pct]) => (
                                <span key={ticker} className="px-1.5 py-0.5 bg-background rounded text-xs">
                                  {ticker} {pct.toFixed(0)}%
                                </span>
                              ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    {dryRunResult.mergedAllocations && (
                      <div className="mt-3 pt-3 border-t border-border">
                        <div className="text-sm font-medium mb-1">Merged Allocation:</div>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(dryRunResult.mergedAllocations)
                            .filter(([, pct]) => pct > 0.5)
                            .sort((a, b) => b[1] - a[1])
                            .map(([ticker, pct]) => (
                              <span key={ticker} className="px-2 py-1 bg-primary/10 rounded text-sm font-medium">
                                {ticker} {pct.toFixed(1)}%
                              </span>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Account Summary */}
                <div className="p-4 bg-muted/50 rounded-lg">
                  <div className="grid grid-cols-4 gap-4 mb-4 text-sm">
                    <div>
                      <div className="text-muted-foreground">Account Equity</div>
                      <div className="font-bold">${dryRunResult.account.equity.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Cash Reserved</div>
                      <div className="font-bold">${dryRunResult.account.reservedCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Total Allocated</div>
                      <div className="font-bold">${dryRunResult.summary.totalAllocated.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Allocation %</div>
                      <div className="font-bold">{dryRunResult.summary.allocationPercent.toFixed(2)}%</div>
                    </div>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ticker</TableHead>
                        <TableHead className="text-right">Target %</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead className="text-right">Notional Amount</TableHead>
                        <TableHead className="text-right">Est. Shares</TableHead>
                        <TableHead className="text-right">Value</TableHead>
                        <TableHead>Order ID</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dryRunResult.positions.map(pos => (
                        <TableRow key={pos.ticker}>
                          <TableCell className="font-medium">{pos.ticker}</TableCell>
                          <TableCell className="text-right">{pos.targetPercent.toFixed(2)}%</TableCell>
                          <TableCell className="text-right">{pos.price ? `$${pos.price.toFixed(2)}` : '-'}</TableCell>
                          <TableCell className="text-right">{pos.notional ? `$${pos.notional.toFixed(2)}` : '-'}</TableCell>
                          <TableCell className="text-right">{pos.estimatedShares ? pos.estimatedShares.toFixed(4) : '0.0000'}</TableCell>
                          <TableCell className="text-right">${(pos.value || pos.notional || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                          <TableCell>
                            {pos.orderId ? (
                              <span className="text-xs font-mono text-muted-foreground">{pos.orderId.slice(0, 8)}...</span>
                            ) : '-'}
                          </TableCell>
                          <TableCell>
                            {pos.error ? (
                              <span className="text-destructive text-xs">{pos.error}</span>
                            ) : pos.skipped ? (
                              <span className="text-yellow-500 text-xs">{pos.reason}</span>
                            ) : pos.status ? (
                              <span className="text-green-500 text-xs">{pos.status}</span>
                            ) : (
                              <span className="text-green-500 text-xs">OK</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </Card>

          {/* Trading Settings Card */}
          <TradingSettingsCard />

          {/* Trade Execution History */}
          <TradeExecutionHistory />

          {/* Warning for Live Trading */}
          {!brokerCredentials?.isPaper && brokerCredentials?.hasCredentials && (
            <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-lg">
              <div className="font-bold text-destructive mb-1">⚠️ Live Trading Mode Enabled</div>
              <p className="text-sm text-destructive/80">
                You are connected to Alpaca's live trading API. Any executed trades will use real money.
                Consider using Paper Trading mode for testing.
              </p>
            </div>
          )}
        </div>
      )}

      {/* User Management Tab - Super Admin Only */}
      {adminTab === 'User Management' && isSuperAdmin && (
        <div className="space-y-6">
          <div className="font-black text-lg">User Management</div>
          <p className="text-sm text-muted-foreground">
            As super admin, you can grant or revoke admin privileges for other users.
            Other admins cannot modify each other's roles.
          </p>

          {adminUsersError && (
            <div className="text-destructive text-sm p-3 bg-destructive/10 rounded-lg">
              {adminUsersError}
            </div>
          )}

          {adminUsersLoading ? (
            <div className="text-muted-foreground">Loading users...</div>
          ) : (
            <Card className="p-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Username</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Last Login</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adminUsers.map(user => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">
                        {user.displayName || user.username}
                        {user.isSuperAdmin && (
                          <span className="ml-2 text-xs bg-purple-500/20 text-purple-500 px-1 py-0.5 rounded">
                            Main Admin
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{user.email}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          user.role === 'main_admin' || user.role === 'admin' ? 'bg-purple-500/20 text-purple-500' :
                          user.role === 'sub_admin' ? 'bg-amber-500/20 text-amber-500' :
                          user.role === 'engineer' ? 'bg-blue-500/20 text-blue-500' :
                          user.role === 'partner' ? 'bg-green-500/20 text-green-500' :
                          'bg-muted text-muted-foreground'
                        }`}>
                          {user.role === 'main_admin' || user.role === 'admin' ? 'main_admin' : user.role}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {user.lastLoginAt
                          ? new Date(user.lastLoginAt).toLocaleDateString()
                          : 'Never'}
                      </TableCell>
                      <TableCell className="text-right">
                        {user.isSuperAdmin ? (
                          <span className="text-xs text-muted-foreground italic">Protected</span>
                        ) : (
                          <select
                            className="w-32 h-7 text-xs px-2 rounded border border-border bg-background"
                            value={user.role === 'admin' ? 'main_admin' : user.role}
                            onChange={(e) => void handleChangeRole(user.id, e.target.value)}
                          >
                            <option value="user">user</option>
                            <option value="partner">partner</option>
                            <option value="engineer">engineer</option>
                            <option value="sub_admin">sub_admin</option>
                          </select>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </div>
      )}

      {/* Atlas Systems Tab - Super Admin Only */}
      {adminTab === 'Atlas Systems' && isSuperAdmin && (
        <div className="space-y-6">
          <div className="font-black text-lg">Atlas Systems</div>
          <p className="text-sm text-muted-foreground">
            Private admin systems (stored in atlas-private.db). Hidden from engineers and regular users.
          </p>

          {atlasSystemsError && (
            <div className="text-destructive text-sm p-3 bg-destructive/10 rounded-lg">
              {atlasSystemsError}
            </div>
          )}

          {atlasSystemsLoading ? (
            <div className="text-muted-foreground">Loading atlas systems...</div>
          ) : atlasSystems.length === 0 ? (
            <Card className="p-6 text-center text-muted-foreground">
              No Atlas systems yet. Create systems from the Build tab and they will appear here.
            </Card>
          ) : (
            <Card className="p-4">
              <div className="text-sm text-muted-foreground mb-2">
                {atlasSystems.length} system{atlasSystems.length !== 1 ? 's' : ''} in Atlas
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Fund Slot</TableHead>
                    <TableHead>CAGR</TableHead>
                    <TableHead>Max DD</TableHead>
                    <TableHead>Sharpe</TableHead>
                    <TableHead>Tags</TableHead>
                    <TableHead>Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {atlasSystems.map(sys => (
                    <TableRow key={sys.id}>
                      <TableCell className="font-medium">{sys.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {sys.ownerName || sys.ownerEmail || sys.ownerId}
                      </TableCell>
                      <TableCell>
                        {sys.fundSlot != null ? (
                          <span className="px-2 py-0.5 rounded text-xs bg-purple-500/20 text-purple-500">
                            Slot {sys.fundSlot}
                          </span>
                        ) : '—'}
                      </TableCell>
                      <TableCell className={sys.metrics?.cagr != null && sys.metrics.cagr > 0 ? 'text-green-500' : 'text-red-500'}>
                        {sys.metrics?.cagr != null ? `${(sys.metrics.cagr * 100).toFixed(1)}%` : '—'}
                      </TableCell>
                      <TableCell className="text-red-500">
                        {sys.metrics?.maxDrawdown != null ? `${(sys.metrics.maxDrawdown * 100).toFixed(1)}%` : '—'}
                      </TableCell>
                      <TableCell>
                        {sys.metrics?.sharpeRatio != null ? sys.metrics.sharpeRatio.toFixed(2) : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {sys.tags.map((tag, i) => (
                            <span key={i} className="px-1.5 py-0.5 rounded text-xs bg-muted text-muted-foreground">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(sys.updatedAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </div>
      )}

      {/* Variable Library Panel (FRD-035) - Read-only database view */}
      {adminTab === 'Variable Library' && isSuperAdmin && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="font-black text-lg">Variable Library</div>
            <div className="text-sm text-muted-foreground">
              {variablesLoading ? 'Loading...' : `${metricVariables.length} variables`}
            </div>
          </div>

          {variablesError && (
            <div className="text-red-500 text-sm p-2 bg-red-500/10 rounded">{variablesError}</div>
          )}

          <Card className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Variable</TableHead>
                  <TableHead className="whitespace-nowrap">Display Name</TableHead>
                  <TableHead className="whitespace-nowrap">Formula</TableHead>
                  <TableHead className="whitespace-nowrap">Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {variablesLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      Loading variables...
                    </TableCell>
                  </TableRow>
                ) : metricVariables.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      No variables in database.
                    </TableCell>
                  </TableRow>
                ) : (
                  metricVariables.map(v => (
                    <TableRow key={v.id}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">{v.variableName}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{v.displayName || '—'}</TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap">{v.formula || '—'}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{v.description || '—'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
    </>
  )
}
