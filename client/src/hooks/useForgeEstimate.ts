/**
 * useForgeEstimate Hook
 *
 * Manages debounced estimate API calls for branch count calculation.
 * Updates automatically when config changes with 500ms debounce.
 *
 * @example
 * ```tsx
 * const { estimate, loading, error } = useForgeEstimate(config);
 * ```
 */

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type { ForgeConfig, EstimateResult } from '@/types';

export interface UseForgeEstimateReturn {
  estimate: EstimateResult | null;
  loading: boolean;
  error: string | null;
}

/**
 * Hook for calculating branch count estimates
 *
 * Features:
 * - Debounced API calls (500ms delay)
 * - Automatic updates when config changes
 * - Loading and error states
 * - Memoized update function
 */
export function useForgeEstimate(config: ForgeConfig): UseForgeEstimateReturn {
  const [estimate, setEstimate] = useState<EstimateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateEstimate = useCallback(async (currentConfig: ForgeConfig) => {
    setLoading(true);
    setError(null);

    try {
      const result = await api.forge.estimate(currentConfig);
      setEstimate(result);
    } catch (err) {
      console.error('Failed to get estimate:', err);
      setError(err instanceof Error ? err.message : 'Failed to get estimate');
      setEstimate(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced estimate updates
  useEffect(() => {
    // Don't estimate if config is invalid
    if (!config.flowchart || config.tickers.length === 0) {
      setEstimate(null);
      return;
    }

    setLoading(true);
    const timeout = setTimeout(() => {
      updateEstimate(config);
    }, 500);

    return () => {
      clearTimeout(timeout);
      setLoading(false);
    };
  }, [config, updateEstimate]);

  return {
    estimate,
    loading,
    error,
  };
}
