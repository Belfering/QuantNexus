/**
 * useForgeConfig Hook
 *
 * Manages Forge configuration with localStorage synchronization.
 * Provides config state, update function, validation, and persistence.
 *
 * @example
 * ```tsx
 * const { config, updateConfig, resetConfig, isValid } = useForgeConfig();
 * ```
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { ForgeConfig } from '@/types';
import { useForgeJobPersistence } from './useForgeJobPersistence';
import { createDefaultRoot } from '@/lib/flowchart/helpers';

export interface UseForgeConfigReturn {
  config: ForgeConfig;
  updateConfig: (updates: Partial<ForgeConfig>) => void;
  resetConfig: () => void;
  isValid: boolean;
}

const DEFAULT_CONFIG: ForgeConfig = {
  flowchart: createDefaultRoot(),
  parameterRanges: [],
  tickers: [],
  minTIM: 5,
  minTIMAR: 30,
  maxDD: 20,
  minTrades: 50,
  minTIMARDD: 4,
  useL2: false,
  splitStrategy: 'even_odd_month',
  oosStartDate: undefined,
  numWorkers: null,
};

/**
 * Hook for managing Forge configuration
 *
 * Features:
 * - Loads config from localStorage on mount
 * - Saves config to localStorage on change
 * - Validates configuration
 * - Memoized update and reset functions
 * - Provides isValid flag for UI
 */
export function useForgeConfig(): UseForgeConfigReturn {
  const { saveConfig, restoreConfig } = useForgeJobPersistence();

  // Initialize config from localStorage or defaults
  const [config, setConfig] = useState<ForgeConfig>(() => {
    const restored = restoreConfig();
    return restored || DEFAULT_CONFIG;
  });

  // Save to localStorage whenever config changes
  useEffect(() => {
    saveConfig(config);
  }, [config, saveConfig]);

  // Update config with partial updates
  const updateConfig = useCallback((updates: Partial<ForgeConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }));
  }, []);

  // Reset to defaults
  const resetConfig = useCallback(() => {
    setConfig(DEFAULT_CONFIG);
  }, []);

  // Validate configuration
  const isValid = useMemo(() => {
    // Check required fields
    if (!config.flowchart) return false;
    if (config.tickers.length === 0) return false;

    // Validate pass/fail criteria
    if (config.minTIM < 0 || config.minTIM > 100) return false;
    if (config.minTIMAR < 0) return false;
    if (config.maxDD < 0 || config.maxDD > 100) return false;
    if (config.minTrades < 0) return false;
    if (config.minTIMARDD < 0) return false;

    // Validate split strategy
    if (config.splitStrategy === 'chronological' && !config.oosStartDate) return false;

    return true;
  }, [config]);

  return {
    config,
    updateConfig,
    resetConfig,
    isValid,
  };
}
