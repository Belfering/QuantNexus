"""
Result caching with hash-based deduplication
Caches backtest results to avoid re-computing identical trees/parameters
"""

import json
import hashlib
from typing import Dict, Optional, Any


class ResultCache:
    """
    Cache backtest results using tree+options hash as key

    Avoids duplicate work when:
    - Same tree structure tested multiple times
    - Parameter optimization generates duplicate combinations
    - Rolling optimizations repeat trees across time periods
    """

    def __init__(self, max_size: int = 10000):
        self.cache: Dict[str, Dict] = {}
        self.max_size = max_size
        self.hits = 0
        self.misses = 0

    def _normalize_tree(self, tree: Dict) -> Dict:
        """
        Normalize tree by removing noise (IDs, titles, timestamps)
        Keep only fields that affect backtest results
        """
        if not isinstance(tree, dict):
            return tree

        # Fields that affect backtest results
        keep_fields = {
            'kind', 'weighting', 'conditions', 'positions', 'positionMode',
            'metric', 'window', 'bottom', 'rank', 'quantifier', 'n', 'items',
            'scaleMetric', 'scaleWindow', 'scaleTicker', 'scaleFrom', 'scaleTo',
            'entryConditions', 'exitConditions', 'children'
        }

        normalized = {}

        for key, value in tree.items():
            if key not in keep_fields:
                continue

            if key == 'children' and isinstance(value, dict):
                # Normalize children recursively
                normalized['children'] = {
                    slot: [self._normalize_tree(child) if child else None for child in children]
                    if isinstance(children, list) else self._normalize_tree(children)
                    for slot, children in value.items()
                }
            elif key == 'conditions' and isinstance(value, list):
                # Normalize conditions (keep only backtest-relevant fields)
                normalized['conditions'] = [
                    {
                        'metric': c.get('metric'),
                        'window': c.get('window'),
                        'ticker': c.get('ticker'),
                        'comparator': c.get('comparator'),
                        'threshold': c.get('threshold'),
                        'rightMetric': c.get('rightMetric'),
                        'rightWindow': c.get('rightWindow'),
                        'rightTicker': c.get('rightTicker'),
                        'type': c.get('type')
                    }
                    for c in value
                ]
            elif key == 'items' and isinstance(value, list):
                # Normalize numbered block items
                normalized['items'] = [
                    {
                        'conditions': [
                            {
                                'metric': c.get('metric'),
                                'window': c.get('window'),
                                'ticker': c.get('ticker'),
                                'comparator': c.get('comparator'),
                                'threshold': c.get('threshold'),
                                'type': c.get('type')
                            }
                            for c in item.get('conditions', [])
                        ]
                    }
                    for item in value
                ]
            else:
                normalized[key] = value

        return normalized

    def _compute_hash(self, tree: Dict, options: Dict) -> str:
        """
        Compute stable hash of tree + options

        Uses SHA256 for collision resistance
        """
        # Normalize tree to remove noise
        normalized_tree = self._normalize_tree(tree)

        # Normalize options (only backtest-affecting fields)
        normalized_options = {
            'mode': options.get('mode'),
            'costBps': options.get('costBps'),
            'splitConfig': {
                'strategy': options.get('splitConfig', {}).get('strategy'),
                'oosStartDate': options.get('splitConfig', {}).get('oosStartDate')
            }
        }

        # Create canonical JSON (sorted keys for stability)
        canonical = json.dumps({
            'tree': normalized_tree,
            'options': normalized_options
        }, sort_keys=True, separators=(',', ':'))

        # Hash using SHA256
        return hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:16]  # First 16 chars

    def get(self, tree: Dict, options: Dict) -> Optional[Dict]:
        """
        Get cached result if exists

        Returns:
            Cached result dict or None if not found
        """
        cache_key = self._compute_hash(tree, options)

        if cache_key in self.cache:
            self.hits += 1
            return self.cache[cache_key]

        self.misses += 1
        return None

    def set(self, tree: Dict, options: Dict, result: Dict) -> None:
        """
        Cache a result

        Args:
            tree: Tree structure
            options: Backtest options
            result: Backtest result to cache
        """
        cache_key = self._compute_hash(tree, options)

        # Evict oldest entry if cache is full (simple FIFO)
        if len(self.cache) >= self.max_size:
            # Remove first key (oldest)
            first_key = next(iter(self.cache))
            del self.cache[first_key]

        self.cache[cache_key] = result

    def clear(self) -> None:
        """Clear all cached results"""
        self.cache.clear()
        self.hits = 0
        self.misses = 0

    def get_stats(self) -> Dict[str, Any]:
        """Get cache statistics"""
        total = self.hits + self.misses
        hit_rate = (self.hits / total * 100) if total > 0 else 0

        return {
            'size': len(self.cache),
            'hits': self.hits,
            'misses': self.misses,
            'hit_rate': hit_rate,
            'max_size': self.max_size
        }


# Global cache instance (shared across all backtests in a worker)
_global_result_cache = None


def get_global_result_cache(max_size: int = 10000) -> ResultCache:
    """Get or create global result cache"""
    global _global_result_cache
    if _global_result_cache is None:
        _global_result_cache = ResultCache(max_size)
    return _global_result_cache


if __name__ == '__main__':
    # Test result cache
    import sys

    cache = ResultCache()

    # Test tree
    tree1 = {
        'id': 'node-1',
        'kind': 'indicator',
        'title': 'RSI Strategy',
        'conditions': [
            {
                'id': 'cond-1',
                'metric': 'RSI',
                'window': 14,
                'ticker': 'SPY',
                'comparator': 'LT',
                'threshold': 30
            }
        ],
        'children': {
            'then': [
                {
                    'id': 'node-2',
                    'kind': 'position',
                    'positions': ['SPY']
                }
            ]
        }
    }

    # Same tree but different IDs/titles (should hash to same value)
    tree2 = {
        'id': 'node-999',
        'kind': 'indicator',
        'title': 'Different Title',
        'conditions': [
            {
                'id': 'cond-999',
                'metric': 'RSI',
                'window': 14,
                'ticker': 'SPY',
                'comparator': 'LT',
                'threshold': 30
            }
        ],
        'children': {
            'then': [
                {
                    'id': 'node-1000',
                    'kind': 'position',
                    'positions': ['SPY']
                }
            ]
        }
    }

    # Different tree (different threshold)
    tree3 = {
        'id': 'node-1',
        'kind': 'indicator',
        'conditions': [
            {
                'id': 'cond-1',
                'metric': 'RSI',
                'window': 14,
                'ticker': 'SPY',
                'comparator': 'LT',
                'threshold': 35  # Different!
            }
        ],
        'children': {
            'then': [
                {
                    'id': 'node-2',
                    'kind': 'position',
                    'positions': ['SPY']
                }
            ]
        }
    }

    options = {'mode': 'chronological', 'costBps': 10}

    # Cache result for tree1
    result1 = {'sharpe': 1.5, 'cagr': 0.12}
    cache.set(tree1, options, result1)

    # Get tree1 (should hit)
    cached = cache.get(tree1, options)
    assert cached == result1, "Should return cached result"

    # Get tree2 (same normalized tree, should hit)
    cached = cache.get(tree2, options)
    assert cached == result1, "Should return same result for equivalent tree"

    # Get tree3 (different tree, should miss)
    cached = cache.get(tree3, options)
    assert cached is None, "Should miss for different tree"

    stats = cache.get_stats()
    print(f"✓ Result cache test passed", file=sys.stderr)
    print(f"  Stats: {stats}", file=sys.stderr)
    print(f"  Expected: 2 hits, 1 miss", file=sys.stderr)
