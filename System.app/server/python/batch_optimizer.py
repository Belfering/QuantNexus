"""
Batch-level optimization for parallel backtesting
Pre-loads tickers and pre-computes indicators across all branches for massive speedup
"""

import sys
import json
from typing import Dict, List, Set, Tuple, Optional
from pathlib import Path
from indicator_cache import SharedIndicatorCache
from optimized_dataloader import get_global_cache
from shared_memory_manager import SharedPriceData


class BatchOptimizer:
    """
    Analyzes all branches in a batch job and pre-loads/pre-computes shared resources

    Optimizations:
    1. Extract all unique tickers from all branches → pre-load ONCE
    2. Extract all unique indicators → pre-compute ONCE
    3. Share cached data across all worker processes
    """

    def __init__(self, parquet_dir: str):
        self.parquet_dir = Path(parquet_dir)
        self.unique_tickers: Set[str] = set()
        self.unique_indicators: Dict[str, Set[int]] = {}  # {indicator_name: set(periods)}
        self.price_cache = None
        self.indicator_cache = None
        self.shared_memory_manager = None

    def analyze_branches(self, branches: List[Dict]) -> Dict:
        """
        Analyze all branches to extract unique tickers and indicators

        Args:
            branches: List of branch objects with tree and options

        Returns:
            Analysis summary with counts and lists
        """
        print(f"[BatchOptimizer] Analyzing {len(branches)} branches...", file=sys.stderr, flush=True)

        for branch in branches:
            tree = branch.get('tree')
            if tree:
                # Extract tickers
                tickers = self._extract_tickers_from_tree(tree)
                self.unique_tickers.update(tickers)

                # Extract indicators
                indicators = self._extract_indicators_from_tree(tree)
                for indicator_name, periods in indicators.items():
                    if indicator_name not in self.unique_indicators:
                        self.unique_indicators[indicator_name] = set()
                    self.unique_indicators[indicator_name].update(periods)

        # Always include SPY as default
        self.unique_tickers.add('SPY')

        total_indicators = sum(len(periods) for periods in self.unique_indicators.values())

        analysis = {
            'ticker_count': len(self.unique_tickers),
            'tickers': sorted(list(self.unique_tickers)),
            'indicator_count': total_indicators,
            'indicators': {k: sorted(list(v)) for k, v in self.unique_indicators.items()},
            'branch_count': len(branches)
        }

        print(f"[BatchOptimizer] Found {len(self.unique_tickers)} unique tickers", file=sys.stderr, flush=True)
        print(f"[BatchOptimizer] Found {total_indicators} unique indicators", file=sys.stderr, flush=True)

        return analysis

    def preload_tickers(self) -> bool:
        """
        Pre-load all unique tickers into global cache

        Returns:
            True if successful
        """
        if not self.unique_tickers:
            print("[BatchOptimizer] No tickers to pre-load", file=sys.stderr, flush=True)
            return False

        try:
            print(f"[BatchOptimizer] Pre-loading {len(self.unique_tickers)} tickers...", file=sys.stderr, flush=True)

            # Get global cache instance
            cache = get_global_cache(str(self.parquet_dir))

            # Pre-load all tickers
            for ticker in self.unique_tickers:
                try:
                    cache.get_ticker_data(ticker, limit=20000)
                except Exception as e:
                    print(f"[BatchOptimizer] Warning: Failed to load {ticker}: {e}", file=sys.stderr, flush=True)

            cache_stats = cache.get_cache_info()
            print(f"[BatchOptimizer] ✓ Pre-loaded tickers. Cache: {cache_stats}", file=sys.stderr, flush=True)

            self.price_cache = cache
            return True

        except Exception as e:
            print(f"[BatchOptimizer] Error pre-loading tickers: {e}", file=sys.stderr, flush=True)
            return False

    def precompute_indicators(self) -> bool:
        """
        Pre-compute all unique indicators for all tickers

        Returns:
            True if successful
        """
        if not self.unique_indicators or not self.price_cache:
            print("[BatchOptimizer] No indicators to pre-compute or cache not initialized", file=sys.stderr, flush=True)
            return False

        try:
            print(f"[BatchOptimizer] Pre-computing indicators...", file=sys.stderr, flush=True)

            # Create shared indicator cache
            self.indicator_cache = SharedIndicatorCache()

            # Build price data dict
            price_data = {}
            for ticker in self.unique_tickers:
                try:
                    df = self.price_cache.get_ticker_data(ticker, limit=20000)
                    if len(df) > 0 and 'Close' in df.columns:
                        price_data[ticker] = df['Close'].values
                except Exception as e:
                    print(f"[BatchOptimizer] Warning: Failed to get prices for {ticker}: {e}", file=sys.stderr, flush=True)

            # Pre-compute all indicators
            self.indicator_cache.precompute_all(price_data, self.unique_indicators)

            stats = self.indicator_cache.get_stats()
            print(f"[BatchOptimizer] ✓ Pre-computed indicators. Stats: {stats}", file=sys.stderr, flush=True)

            return True

        except Exception as e:
            print(f"[BatchOptimizer] Error pre-computing indicators: {e}", file=sys.stderr, flush=True)
            return False

    def create_shared_memory(self) -> bool:
        """
        Create shared memory blocks for all tickers (zero-copy across workers)

        Returns:
            True if successful
        """
        if not self.unique_tickers or not self.price_cache:
            print("[BatchOptimizer] Cannot create shared memory: no tickers loaded", file=sys.stderr, flush=True)
            return False

        try:
            print(f"[BatchOptimizer] Creating shared memory for {len(self.unique_tickers)} tickers...", file=sys.stderr, flush=True)

            # Create shared memory manager
            self.shared_memory_manager = SharedPriceData()

            # Load each ticker into shared memory
            for ticker in self.unique_tickers:
                try:
                    df = self.price_cache.get_ticker_data(ticker, limit=20000)
                    if len(df) > 0:
                        self.shared_memory_manager.load_ticker_to_shared_memory(ticker, df)
                except Exception as e:
                    print(f"[BatchOptimizer] Warning: Failed to share {ticker}: {e}", file=sys.stderr, flush=True)

            print(f"[BatchOptimizer] ✓ Created shared memory blocks", file=sys.stderr, flush=True)
            return True

        except Exception as e:
            print(f"[BatchOptimizer] Error creating shared memory: {e}", file=sys.stderr, flush=True)
            return False

    def optimize_batch(self, branches: List[Dict]) -> Dict:
        """
        Run complete batch optimization pipeline

        Args:
            branches: List of branch objects

        Returns:
            Optimization summary
        """
        # Analyze branches
        analysis = self.analyze_branches(branches)

        # Pre-load tickers
        tickers_loaded = self.preload_tickers()

        # Pre-compute indicators
        indicators_computed = self.precompute_indicators()

        # Create shared memory blocks (optional optimization)
        shared_memory_created = self.create_shared_memory()
        shared_memory_metadata = None
        if shared_memory_created and self.shared_memory_manager:
            shared_memory_metadata = self.shared_memory_manager.get_metadata()

        return {
            'analysis': analysis,
            'tickers_loaded': tickers_loaded,
            'indicators_computed': indicators_computed,
            'shared_memory_created': shared_memory_created,
            'shared_memory_metadata': shared_memory_metadata,
            'speedup_estimate': self._estimate_speedup(analysis)
        }

    def _estimate_speedup(self, analysis: Dict) -> str:
        """Estimate speedup from optimizations"""
        ticker_count = analysis['ticker_count']
        indicator_count = analysis['indicator_count']
        branch_count = analysis['branch_count']

        # Without optimization: each branch loads tickers + calculates indicators
        # With optimization: load once, calculate once, reuse across all branches

        if branch_count > 1:
            ticker_speedup = min(branch_count, 10)  # Max ~10x from ticker caching
            indicator_speedup = min(branch_count * 50, 100)  # Max ~100x from indicator caching

            total_speedup = min(ticker_speedup * indicator_speedup, 100)
            return f"{total_speedup}x (estimated)"

        return "1x (single branch)"

    def _extract_tickers_from_tree(self, node: Dict) -> Set[str]:
        """Recursively extract all tickers from tree"""
        tickers = set()

        # Extract from position nodes
        if node.get('kind') == 'position' and node.get('positions'):
            for pos in node['positions']:
                if pos and pos != 'Empty':
                    tickers.add(pos.upper())

        # Extract from conditions (indicator tickers)
        if node.get('conditions'):
            for cond in node['conditions']:
                ticker = cond.get('ticker')
                if ticker and ticker != 'Empty':
                    tickers.add(ticker.upper())
                right_ticker = cond.get('rightTicker')
                if right_ticker and right_ticker != 'Empty':
                    tickers.add(right_ticker.upper())

        # Recurse into children
        if node.get('children'):
            for children in node['children'].values():
                if isinstance(children, list):
                    for child in children:
                        if child:
                            tickers.update(self._extract_tickers_from_tree(child))
                elif children:
                    tickers.update(self._extract_tickers_from_tree(children))

        return tickers

    def _extract_indicators_from_tree(self, node: Dict) -> Dict[str, Set[int]]:
        """Recursively extract all indicators with their periods from tree"""
        indicators = {}

        # Extract from conditions
        if node.get('conditions'):
            for cond in node['conditions']:
                # Left side indicator
                metric = cond.get('metric')
                window = cond.get('window')
                if metric and window:
                    if metric not in indicators:
                        indicators[metric] = set()
                    try:
                        indicators[metric].add(int(window))
                    except (ValueError, TypeError):
                        pass

                # Right side indicator
                right_metric = cond.get('rightMetric')
                right_window = cond.get('rightWindow')
                if right_metric and right_window:
                    if right_metric not in indicators:
                        indicators[right_metric] = set()
                    try:
                        indicators[right_metric].add(int(right_window))
                    except (ValueError, TypeError):
                        pass

        # Recurse into children
        if node.get('children'):
            for children in node['children'].values():
                if isinstance(children, list):
                    for child in children:
                        if child:
                            child_indicators = self._extract_indicators_from_tree(child)
                            for indicator_name, periods in child_indicators.items():
                                if indicator_name not in indicators:
                                    indicators[indicator_name] = set()
                                indicators[indicator_name].update(periods)
                elif children:
                    child_indicators = self._extract_indicators_from_tree(children)
                    for indicator_name, periods in child_indicators.items():
                        if indicator_name not in indicators:
                            indicators[indicator_name] = set()
                        indicators[indicator_name].update(periods)

        return indicators


def optimize_batch(branches: List[Dict], parquet_dir: str) -> Dict:
    """
    Convenience function to run batch optimization

    Args:
        branches: List of branch objects
        parquet_dir: Path to parquet data directory

    Returns:
        Optimization summary
    """
    optimizer = BatchOptimizer(parquet_dir)
    return optimizer.optimize_batch(branches)


if __name__ == '__main__':
    # Test batch optimizer
    print("Testing batch optimizer...", file=sys.stderr, flush=True)

    # Example: Read branches from stdin
    try:
        input_data = json.loads(sys.stdin.read())
        branches = input_data.get('branches', [])
        parquet_dir = input_data.get('parquetDir', '../data/parquet')

        result = optimize_batch(branches, parquet_dir)
        # Output ONLY the JSON result to stdout (no extra messages!)
        print(json.dumps(result), flush=True)

    except Exception as e:
        # Send error to stderr and valid JSON error to stdout
        print(f"[BatchOptimizer] ERROR: {e}", file=sys.stderr, flush=True)
        print(json.dumps({'error': str(e)}), flush=True)
        sys.exit(1)
