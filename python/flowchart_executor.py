"""
Flowchart Executor for Atlas Forge Phase 1.5
Executes flowchart-based strategies by traversing the tree structure
"""

import pandas as pd
import numpy as np
from indicators import calculate_indicator

class FlowchartExecutor:
    """
    Executes a flowchart strategy tree to generate buy/sell signals
    """

    def __init__(self, flowchart, ticker='SPY'):
        """
        Initialize executor with a flowchart JSON tree

        Args:
            flowchart (dict): FlowNode tree structure from frontend
            ticker (str): Current ticker being processed
        """
        self.flowchart = flowchart
        self.ticker = ticker

    def execute(self, df):
        """
        Execute the flowchart strategy on price data

        Args:
            df (pd.DataFrame): Price data with OHLCV columns

        Returns:
            pd.DataFrame: DataFrame with added 'Signal' column (0 or 1)
        """
        df = df.copy()

        # Execute the tree starting from root
        signal_series = self._execute_node(df, self.flowchart)

        # Convert boolean to int (0/1)
        df['Signal'] = signal_series.astype(int)

        return df

    def _execute_node(self, df, node):
        """
        Recursively execute a node in the flowchart tree

        Args:
            df (pd.DataFrame): Price data
            node (dict): Current FlowNode from tree

        Returns:
            pd.Series: Boolean series indicating buy signals
        """
        kind = node.get('kind', 'basic')

        if kind == 'basic':
            return self._execute_basic(df, node)
        elif kind == 'indicator':
            return self._execute_indicator(df, node)
        elif kind == 'position':
            return self._execute_position(df, node)
        elif kind == 'numbered':
            return self._execute_numbered(df, node)
        elif kind == 'function':
            return self._execute_function(df, node)
        else:
            # Unknown kind: return no signal
            return pd.Series(False, index=df.index)

    def _execute_basic(self, df, node):
        """
        Execute a basic (weighted) block
        Simply passes through to 'next' children
        """
        children = node.get('children', {}).get('next', [])

        if not children or len(children) == 0:
            return pd.Series(False, index=df.index)

        # For now, just execute first child (Phase 5: implement weighting)
        first_child = children[0]
        if first_child is None:
            return pd.Series(False, index=df.index)

        return self._execute_node(df, first_child)

    def _execute_indicator(self, df, node):
        """
        Execute an indicator (if/else) block
        Evaluates conditions and routes to then/else branches
        """
        conditions = node.get('conditions', [])

        # Evaluate all conditions
        if conditions:
            condition_met = self._evaluate_conditions(df, conditions)
        else:
            condition_met = pd.Series(False, index=df.index)

        # Get then/else children
        then_children = node.get('children', {}).get('then', [])
        else_children = node.get('children', {}).get('else', [])

        # Execute then branch
        if then_children and then_children[0]:
            then_signal = self._execute_node(df, then_children[0])
        else:
            then_signal = pd.Series(True, index=df.index)  # Default to buy if no then child

        # Execute else branch
        if else_children and else_children[0]:
            else_signal = self._execute_node(df, else_children[0])
        else:
            else_signal = pd.Series(False, index=df.index)  # Default to no buy if no else child

        # Combine: where condition is met, use then_signal; otherwise use else_signal
        result = pd.Series(False, index=df.index)
        result[condition_met] = then_signal[condition_met]
        result[~condition_met] = else_signal[~condition_met]

        # Execute next children (after if/else logic)
        next_children = node.get('children', {}).get('next', [])
        if next_children and next_children[0]:
            next_signal = self._execute_node(df, next_children[0])
            result = result & next_signal  # AND with next block

        return result

    def _execute_position(self, df, node):
        """
        Execute a position (ticker filter) block
        Returns True only if current ticker matches the position list
        """
        positions = node.get('positions', [])

        if self.ticker in positions:
            # Execute next children
            next_children = node.get('children', {}).get('next', [])
            if next_children and next_children[0]:
                return self._execute_node(df, next_children[0])
            return pd.Series(True, index=df.index)
        else:
            return pd.Series(False, index=df.index)

    def _execute_numbered(self, df, node):
        """
        Execute a numbered (any/all/none/etc.) block
        Phase 5 feature - simplified for now
        """
        numbered = node.get('numbered', {})
        quantifier = numbered.get('quantifier', 'all')
        items = numbered.get('items', [])

        if len(items) == 0:
            return pd.Series(False, index=df.index)

        # Evaluate all item conditions
        item_results = []
        for item in items:
            conditions = item.get('conditions', [])
            if conditions:
                item_result = self._evaluate_conditions(df, conditions)
                item_results.append(item_result)

        if len(item_results) == 0:
            return pd.Series(False, index=df.index)

        # Apply quantifier
        if quantifier == 'all':
            result = pd.concat(item_results, axis=1).all(axis=1)
        elif quantifier == 'any':
            result = pd.concat(item_results, axis=1).any(axis=1)
        elif quantifier == 'none':
            result = ~pd.concat(item_results, axis=1).any(axis=1)
        else:
            # exactly/atLeast/atMost (Phase 5)
            result = pd.Series(False, index=df.index)

        # Execute next children
        next_children = node.get('children', {}).get('next', [])
        if next_children and next_children[0]:
            next_signal = self._execute_node(df, next_children[0])
            result = result & next_signal

        return result

    def _execute_function(self, df, node):
        """
        Execute a function (filtered) block
        Phase 5 feature - placeholder for now
        """
        return pd.Series(False, index=df.index)

    def _evaluate_conditions(self, df, conditions):
        """
        Evaluate a list of conditions with if/and/or logic

        Args:
            df (pd.DataFrame): Price data
            conditions (list): List of ConditionLine objects

        Returns:
            pd.Series: Boolean series indicating where all conditions are met
        """
        if not conditions:
            return pd.Series(False, index=df.index)

        result = None

        for cond in conditions:
            cond_type = cond.get('type', 'if')
            metric = cond.get('metric', 'Current Price')
            window = cond.get('window', 14)
            comparator = cond.get('comparator', 'lt')
            threshold = cond.get('threshold', 0)
            ticker_symbol = cond.get('ticker', self.ticker)

            # Calculate indicator
            indicator_values = calculate_indicator(df, metric, window)

            # Apply comparator
            if comparator == 'lt':
                condition_met = indicator_values < threshold
            elif comparator == 'gt':
                condition_met = indicator_values > threshold
            elif comparator == 'crossAbove':
                # Crosses above: was below threshold yesterday, above today
                prev = indicator_values.shift(1)
                condition_met = (prev < threshold) & (indicator_values >= threshold)
            elif comparator == 'crossBelow':
                # Crosses below: was above threshold yesterday, below today
                prev = indicator_values.shift(1)
                condition_met = (prev > threshold) & (indicator_values <= threshold)
            else:
                condition_met = pd.Series(False, index=df.index)

            # Combine with previous conditions based on type
            if cond_type == 'if':
                result = condition_met
            elif cond_type == 'and':
                if result is not None:
                    result = result & condition_met
                else:
                    result = condition_met
            elif cond_type == 'or':
                if result is not None:
                    result = result | condition_met
                else:
                    result = condition_met

        return result if result is not None else pd.Series(False, index=df.index)
