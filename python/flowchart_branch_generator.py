"""
Flowchart Branch Generator for Atlas Forge Phase 1.5
Generates all parameter combinations and creates flowchart branches
"""

import copy
from typing import List, Dict, Any

def generate_parameter_combinations(parameter_ranges: List[Dict]) -> List[Dict]:
    """
    Generate all combinations of enabled parameters

    Args:
        parameter_ranges: List of ParameterRange objects with min/max/step

    Returns:
        List of dictionaries mapping parameter_id to value
    """
    # Filter enabled parameters
    enabled = [p for p in parameter_ranges if p.get('enabled', False)]

    if len(enabled) == 0:
        return [{}]  # Single empty combination = no parameter variation

    # Generate value lists for each parameter
    param_value_lists = []
    for param in enabled:
        min_val = param['min']
        max_val = param['max']
        step = param['step']

        # Generate range of values
        values = []
        current = min_val
        while current <= max_val:
            values.append(current)
            current += step

        param_value_lists.append({
            'id': param['id'],
            'type': param['type'],
            'nodeId': param['nodeId'],
            'conditionId': param.get('conditionId'),
            'values': values
        })

    # Generate cartesian product of all parameter values
    combinations = []

    def generate_recursive(index, current_combo):
        if index >= len(param_value_lists):
            combinations.append(dict(current_combo))
            return

        param = param_value_lists[index]
        for value in param['values']:
            current_combo[param['id']] = {
                'type': param['type'],
                'nodeId': param['nodeId'],
                'conditionId': param['conditionId'],
                'value': value
            }
            generate_recursive(index + 1, current_combo)

    generate_recursive(0, {})
    return combinations

def apply_parameter_combination(flowchart: Dict, combination: Dict) -> Dict:
    """
    Apply a parameter combination to a flowchart tree

    Args:
        flowchart: FlowNode tree (will be deep copied)
        combination: Dict mapping parameter_id to {type, nodeId, conditionId, value}

    Returns:
        New flowchart tree with parameters applied
    """
    # Deep copy to avoid mutating original
    result = copy.deepcopy(flowchart)

    # Apply each parameter value
    for param_id, param_data in combination.items():
        node_id = param_data['nodeId']
        condition_id = param_data.get('conditionId')
        param_type = param_data['type']
        value = param_data['value']

        # Find and update the node
        _apply_to_node(result, node_id, condition_id, param_type, value)

    return result

def _apply_to_node(node: Dict, target_node_id: str, target_cond_id: str | None, param_type: str, value: Any):
    """
    Recursively find node and apply parameter value
    """
    if node.get('id') == target_node_id:
        # Found the target node
        if param_type == 'period':
            # Apply to indicator/numbered/function block
            if node.get('kind') == 'indicator' and target_cond_id:
                # Update condition window
                for cond in node.get('conditions', []):
                    if cond.get('id') == target_cond_id:
                        cond['window'] = value
            elif node.get('kind') == 'numbered' and target_cond_id:
                # Update numbered item condition window
                for item in node.get('numbered', {}).get('items', []):
                    for cond in item.get('conditions', []):
                        if cond.get('id') == target_cond_id:
                            cond['window'] = value
            elif node.get('kind') == 'function':
                # Update function window
                node['window'] = value

        elif param_type == 'threshold':
            # Apply to condition threshold
            if node.get('kind') == 'indicator' and target_cond_id:
                for cond in node.get('conditions', []):
                    if cond.get('id') == target_cond_id:
                        cond['threshold'] = value
            elif node.get('kind') == 'numbered' and target_cond_id:
                for item in node.get('numbered', {}).get('items', []):
                    for cond in item.get('conditions', []):
                        if cond.get('id') == target_cond_id:
                            cond['threshold'] = value

    # Recursively search children
    for slot, children in node.get('children', {}).items():
        if children:
            for child in children:
                if child:
                    _apply_to_node(child, target_node_id, target_cond_id, param_type, value)

def generate_flowchart_branches(config: Dict, tickers: List[str]) -> List[Dict]:
    """
    Generate all flowchart branches from parameter ranges and tickers

    Args:
        config: ForgeConfig with flowchart and parameterRanges
        tickers: List of ticker symbols

    Returns:
        List of branch dictionaries ready for backtesting
    """
    flowchart = config.get('flowchart')
    parameter_ranges = config.get('parameterRanges', [])

    if not flowchart:
        return []

    # Generate all parameter combinations
    combinations = generate_parameter_combinations(parameter_ranges)

    print(f"Generated {len(combinations)} parameter combinations", flush=True)

    # Generate branches for each ticker × combination
    branches = []
    for ticker in tickers:
        for i, combo in enumerate(combinations):
            # Apply combination to flowchart
            branch_flowchart = apply_parameter_combination(flowchart, combo)

            # Create branch object
            branch = {
                'signal_ticker': ticker,
                'invest_ticker': ticker,
                'mode': 'flowchart',
                'flowchart': branch_flowchart,
                'combination_index': i,
                'config': config,
                'split_strategy': config.get('splitStrategy', 'even_odd_month'),
                'oos_start_date': config.get('oosStartDate'),
                'data_path': f'data/parquet/{ticker}.parquet'
            }

            branches.append(branch)

    return branches
