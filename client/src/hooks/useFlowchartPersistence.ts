/**
 * Flowchart Persistence Hook
 * Phase 3: Sync flowchart tree with ForgeConfig for localStorage persistence
 */

import { useEffect } from 'react';
import { useFlowchartStore } from '@/stores/useFlowchartStore';
import type { ForgeConfig } from '@/types/forge';

/**
 * Hook to persist flowchart to config (localStorage)
 * Syncs flowchart state with ForgeConfig.flowchart field
 */
export function useFlowchartPersistence(
  config: ForgeConfig,
  updateConfig: (updates: Partial<ForgeConfig>) => void
) {
  const root = useFlowchartStore((state) => state.root);
  const setRoot = useFlowchartStore((state) => state.setRoot);

  // Load flowchart from config on mount (if it exists)
  useEffect(() => {
    if (config.flowchart) {
      setRoot(config.flowchart);
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save flowchart to config whenever it changes (debounced)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      updateConfig({ flowchart: root });
    }, 500); // 500ms debounce

    return () => clearTimeout(timeoutId);
  }, [root, updateConfig]);
}
