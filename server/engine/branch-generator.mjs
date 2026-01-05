/**
 * Branch generator - Creates Cartesian product of all parameter combinations
 */

export function generateBranches(config) {
  const {
    indicator,
    periodMin = 5,
    periodMax = 200,
    tickers = [],
    comparator = 'BOTH',
    thresholdMin = 1,
    thresholdMax = 99,
    thresholdStep = 1,
    enableL2 = false,
    l2Indicator = null,
    l2Period = null,
    l2Comparator = null,
    l2Threshold = null,
    useAltTickers = false,
    altTicker = null,
  } = config;

  const branches = [];

  // Generate period range
  const periods = [];
  for (let p = periodMin; p <= periodMax; p++) {
    periods.push(p);
  }

  // Generate threshold range
  const thresholds = [];
  for (let t = thresholdMin; t <= thresholdMax; t += thresholdStep) {
    thresholds.push(t);
  }

  // Generate comparators
  const comparators = comparator === 'BOTH' ? ['LT', 'GT'] : [comparator];

  // Cartesian product
  for (const ticker of tickers) {
    for (const period of periods) {
      for (const comp of comparators) {
        for (const threshold of thresholds) {
          const branch = {
            signalTicker: ticker,
            investTicker: useAltTickers && altTicker ? altTicker : ticker,
            indicator,
            period,
            comparator: comp,
            threshold,
          };

          // Add L2 conditions if enabled
          if (enableL2 && l2Indicator) {
            branch.l2Indicator = l2Indicator;
            branch.l2Period = l2Period;
            branch.l2Comparator = l2Comparator;
            branch.l2Threshold = l2Threshold;
          }

          branches.push(branch);
        }
      }
    }
  }

  return branches;
}

export function chunkBranches(branches, chunkSize = 100) {
  /**
   * Split branches into chunks for parallel processing
   */
  const chunks = [];
  for (let i = 0; i < branches.length; i += chunkSize) {
    chunks.push(branches.slice(i, i + chunkSize));
  }
  return chunks;
}

export function estimateBranchCount(config) {
  /**
   * Estimate total number of branches without generating them
   */
  const {
    periodMin = 5,
    periodMax = 200,
    tickers = [],
    comparator = 'BOTH',
    thresholdMin = 1,
    thresholdMax = 99,
    thresholdStep = 1,
    enableL2 = false,
  } = config;

  const periods = periodMax - periodMin + 1;
  const thresholds = Math.floor((thresholdMax - thresholdMin) / thresholdStep) + 1;
  const tickerCount = tickers.length || 1;
  const comparatorCount = comparator === 'BOTH' ? 2 : 1;

  let total = periods * thresholds * tickerCount * comparatorCount;

  if (enableL2) {
    // For simplicity, assume 1 L2 configuration per branch
    // In reality this could multiply based on L2 parameters
    total *= 1;  // Keep same for now
  }

  return total;
}
