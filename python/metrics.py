# metrics.py
from __future__ import annotations

from typing import List, Optional, Tuple
import numpy as np
import pandas as pd
import math


# ---------------------------------------------------------------------
# Core helpers
# ---------------------------------------------------------------------

def _ret_series(df: pd.DataFrame, ret_col: str) -> pd.Series:
    """Return a clean float Series of returns (drop NaNs)."""
    s = pd.to_numeric(df.get(ret_col, pd.Series(dtype=float)), errors="coerce")
    return s.dropna()

def _active_ret_series(df: pd.DataFrame, ret_col: str, zero_tol: float = 1e-12) -> pd.Series:
    """
    Return series with NaNs/0s dropped (active trading days only).
    Useful for Sharpe, Sortino, skew/kurtosis, etc.
    """
    s = _ret_series(df, ret_col)
    return s[~np.isclose(s, 0.0, atol=zero_tol)]

def _equity_curve_from_returns(r: pd.Series) -> pd.Series:
    """Equity curve from decimal returns; starts at 1.0."""
    if r.empty:
        return r
    r = r.fillna(0.0).astype(float)
    return (1.0 + r).cumprod()

def drawdown_series_from_returns(df: pd.DataFrame, ret_col: str) -> pd.Series:
    """
    Drawdown magnitude series as NON-NEGATIVE DECIMALS (e.g., 0.25 = -25%).
    """
    r = _ret_series(df, ret_col)
    if r.empty:
        return pd.Series(dtype=float)
    eq = _equity_curve_from_returns(r)
    peak = eq.cummax()
    dd = (eq / peak) - 1.0        # <= 0
    return -dd                    # >= 0

def _as_float(x):
    try:
        if x is None: 
            return None
        xf = float(x)
        return xf if math.isfinite(xf) else None
    except Exception:
        return None

# ---------------------------------------------------------------------
# Existing metrics (kept compatible with your scripts)
# ---------------------------------------------------------------------

def compute_cagr(df: pd.DataFrame, ret_col: str = "CC") -> float:
    """
    CAGR (decimal) assuming ~252 trading days/year.
    """
    if ret_col not in df.columns:
        return float("nan")
    r = df[ret_col].fillna(0.0).astype(float)
    growth = (1.0 + r).prod()
    years = len(r) / 252.0
    if years <= 0:
        return float("nan")
    return float(growth ** (1.0 / years) - 1.0)

def evaluate_pass_fail(out_df: pd.DataFrame, min_cagr: float = 0.0, ret_col: str = "CC") -> Tuple[bool, float]:
    """
    Returns (passed, cagr). Pass if CAGR >= min_cagr.
    """
    cagr = compute_cagr(out_df, ret_col=ret_col)
    passed = (cagr >= min_cagr) if np.isfinite(cagr) else False
    return passed, float(cagr)

def compute_equity_curve(df: pd.DataFrame, ret_col: str = "CC") -> pd.Series:
    """
    Cumulative equity curve (starts at 1.0) using simple daily returns in ret_col.
    NaNs treated as 0.
    """
    r = df[ret_col].fillna(0.0).astype(float)
    return (1.0 + r).cumprod()

def compute_max_drawdown(df: pd.DataFrame, ret_col: str = "CC") -> float:
    """
    Maximum drawdown as a POSITIVE PERCENT (e.g., 30.5 for -30.5%).
    """
    eq = compute_equity_curve(df, ret_col=ret_col)
    if eq.empty:
        return float("nan")
    roll_max = eq.cummax()
    dd = (eq / roll_max) - 1.0  # <= 0
    md = float(dd.min()) if len(dd) else float("nan")
    return abs(md) * 100.0 if np.isfinite(md) else float("nan")

def compute_dd3(df: pd.DataFrame, ret_col: str = "CC") -> float:
    """
    Average of the 3 worst drawdowns as a POSITIVE PERCENT (e.g., 28.9 for -28.9%).
    """
    eq = compute_equity_curve(df, ret_col=ret_col)
    if eq.empty:
        return float("nan")
    roll_max = eq.cummax()
    dd = (eq / roll_max) - 1.0  # <= 0
    if dd.empty:
        return float("nan")
    worst3 = dd.nsmallest(3)
    if worst3.empty:
        return float("nan")
    worst3_mean = float(worst3.mean())
    return abs(worst3_mean) * 100.0 if np.isfinite(worst3_mean) else float("nan")

def compute_dd_percentile(df: pd.DataFrame, ret_col: str = "CC", q: float = 0.50) -> float:
    """
    Percentile of daily drawdown *magnitude* (positive in [0,1]) as a DECIMAL.
    q in [0,1]. Returns NaN if empty.
    """
    if not (0.0 <= q <= 1.0):
        return float("nan")

    # clean returns
    r = pd.to_numeric(df.get(ret_col, pd.Series(dtype=float)), errors="coerce")
    r = r.replace([np.inf, -np.inf], np.nan).dropna()
    if r.empty:
        return float("nan")

    # equity & drawdown magnitude (decimal)
    eq = (1.0 + r.astype(float)).cumprod()
    dd_dec = (eq.cummax() - eq) / eq.cummax()          # in [0,1]
    return float(np.nanquantile(dd_dec.values, q, method="higher"))

def compute_time_in_market(
    df: pd.DataFrame,
    ret_cols: Optional[List[str]] = None,
    active_mask: Optional[pd.Series] = None,
    base_col_for_total: str = "CC",
) -> float:
    """
    Time in Market (TIM): fraction of 'active' days.
    - If active_mask provided, TIM = active_mask.sum() / total_days.
    - Else 'active' means any non-zero among the provided return columns (zeroed when inactive).
    - total_days = count of non-NaN in base_col_for_total.
    """
    if ret_cols is None:
        ret_cols = ["CC", "OO", "OC", "CO"]

    df_local = df.copy()
    total_days = int(df_local[base_col_for_total].notna().count()) if base_col_for_total in df_local.columns else len(df_local)
    if total_days <= 0:
        return float("nan")

    if active_mask is not None:
        active_days = int(pd.Series(active_mask).fillna(False).sum())
        return float(active_days / total_days)

    cols = [c for c in ret_cols if c in df_local.columns]
    if not cols:
        return float("nan")
    abs_sum = df_local[cols].fillna(0.0).abs().sum(axis=1)
    active_days = int((abs_sum > 0).sum())
    return float(active_days / total_days)

def compute_timar(
    df: pd.DataFrame,
    ret_col: str = "CC",
    ret_cols_for_tim: Optional[List[str]] = None,
    active_mask: Optional[pd.Series] = None,
) -> float:
    """
    TIMAR := CAGR / TIM. Returns NaN if TIM <= 0 or NaN.
    """
    if ret_cols_for_tim is None:
        ret_cols_for_tim = ["CC", "OO", "OC", "CO"]

    cagr = compute_cagr(df, ret_col=ret_col)
    tim = compute_time_in_market(
        df, ret_cols=ret_cols_for_tim, active_mask=active_mask, base_col_for_total=ret_col
    )
    if not np.isfinite(tim) or tim <= 0:
        return float("nan")
    return float(cagr / tim)

def compute_win_percentage(
    df: pd.DataFrame,
    ret_col: str = "CC",
    active_mask: Optional[pd.Series] = None,
) -> float:
    """
    Win %: positives / (positives + negatives) among active days.
    Zeros/NaNs excluded from denominator.
    """
    r = df[ret_col].astype(float)
    if active_mask is not None:
        r = r[pd.Series(active_mask).fillna(False)]
    r = r.dropna()
    wins = (r > 0).sum()
    losses = (r < 0).sum()
    denom = wins + losses
    if denom == 0:
        return float("nan")
    return float(wins / denom)

def num_trades(df: pd.DataFrame, ret_col: str = "CC", ret_cols: Optional[List[str]] = None, eps: float = 0.0) -> int:
    """
    Count trades = number of contiguous ACTIVE runs (ACTIVE if any chosen return != 0).
    """
    if ret_cols:
        cols = [c for c in ret_cols if c in df.columns]
        if not cols:
            return 0
        rsum = df[cols].astype(float).fillna(0.0).abs().sum(axis=1)
        active = rsum > eps
    else:
        if ret_col not in df.columns:
            return 0
        r = df[ret_col].astype(float).fillna(0.0)
        active = r.abs() > eps

    if active.empty:
        return 0

    starts = active & (~active.shift(1, fill_value=False))
    return int(starts.sum())

def average_hold_period(
    df: pd.DataFrame, ret_col: str = "CC", ret_cols: Optional[List[str]] = None, eps: float = 0.0
) -> float:
    """
    Average hold period in TRADING DAYS per trade.
    """
    if ret_cols:
        cols = [c for c in ret_cols if c in df.columns]
        if not cols:
            return float("nan")
        rsum = df[cols].astype(float).fillna(0.0).abs().sum(axis=1)
        active = rsum > eps
    else:
        if ret_col not in df.columns:
            return float("nan")
        r = df[ret_col].astype(float).fillna(0.0)
        active = r.abs() > eps

    trades = num_trades(df, ret_col=ret_col, ret_cols=ret_cols, eps=eps)
    if trades <= 0:
        return float("nan")
    return float(int(active.sum()) / trades)


# ---------------------------------------------------------------------
# Additional risk/quality metrics
# ---------------------------------------------------------------------

def compute_ann_volatility(df: pd.DataFrame, ret_col: str, periods_per_year: int = 252) -> float:
    r = _active_ret_series(df, ret_col)
    if len(r) < 2:
        return float("nan")
    return float(r.std(ddof=1) * np.sqrt(periods_per_year))

def compute_daily_volatility(df: pd.DataFrame, ret_col: str) -> float:
    r = _active_ret_series(df, ret_col)
    return float(r.std(ddof=1)) if len(r) >= 2 else float("nan")

def compute_sharpe(df: pd.DataFrame, ret_col: str, rf: float = 0.0, periods_per_year: int = 252) -> float:
    r = _active_ret_series(df, ret_col)
    if r.empty:
        return float("nan")
    rf_period = (1.0 + rf) ** (1.0 / periods_per_year) - 1.0
    excess = r - rf_period
    sd = excess.std(ddof=1)
    if not np.isfinite(sd) or sd == 0.0:
        return float("nan")
    mean_excess_ann = excess.mean() * periods_per_year
    return float(mean_excess_ann / (sd * np.sqrt(periods_per_year)))

def compute_downside_deviation(
    df: pd.DataFrame, ret_col: str, mar: float = 0.0, periods_per_year: int = 252
) -> float:
    """
    Annualized downside deviation (decimal). mar is annual minimum acceptable return (decimal).
    """
    r = _ret_series(df, ret_col)
    if r.empty:
        return float("nan")
    mar_period = (1.0 + mar) ** (1.0 / periods_per_year) - 1.0
    downside = np.minimum(0.0, r - mar_period)
    dd = np.sqrt((downside ** 2).mean())
    return float(dd * np.sqrt(periods_per_year))

def compute_sortino(df: pd.DataFrame, ret_col: str, rf: float = 0.0, mar: Optional[float] = None, periods_per_year: int = 252) -> float:
    r = _active_ret_series(df, ret_col)
    if r.empty:
        return float("nan")
    if mar is None:
        mar = rf
    rf_period = (1.0 + rf) ** (1.0 / periods_per_year) - 1.0
    excess = r - rf_period
    downside = np.minimum(0.0, excess)
    dd = np.sqrt((downside ** 2).mean()) * np.sqrt(periods_per_year)
    if not np.isfinite(dd) or dd == 0.0:
        return float("nan")
    mean_excess_ann = excess.mean() * periods_per_year
    return float(mean_excess_ann / dd)

def compute_var_es(df: pd.DataFrame, ret_col: str, alpha: float = 0.95,
                   *, active_only: bool = True, zero_tol: float = 1e-12) -> Tuple[float, float]:
    """
    Empirical VaR & ES at confidence alpha.
    Returns negative decimals (loss thresholds): (VaR, ES).
    If active_only=True, ignore zero-return days (e.g., out-of-market).
    """
    r = _ret_series(df, ret_col).astype(float)
    if active_only:
        r = r[~np.isclose(r, 0.0, atol=zero_tol)]
    if r.empty or not (0.0 < alpha < 1.0):
        return float("nan"), float("nan")
    q = float(np.nanquantile(r, 1.0 - alpha, method="lower"))
    tail = r[r <= q]
    es = float(np.nanmean(tail)) if tail.size else float("nan")
    return q, es

def compute_gain_to_pain(df: pd.DataFrame, ret_col: str = "CC") -> float:
    """
    Gain-to-Pain (drawdown-based):
      Gain = final compounded return (equity_T - 1).
      Pain = sum of increases in drawdown magnitude (decimal) whenever a new low is made.
             (i.e., sum(max(0, DD_t - DD_{t-1})) over t)

    Returns NaN if equity or pain cannot be computed or pain == 0.
    """
    r = _ret_series(df, ret_col)
    if r.empty:
        return float("nan")

    # equity and drawdown magnitude (>=0 decimals)
    eq = (1.0 + r.astype(float)).cumprod()
    peak = eq.cummax()
    dd = 1.0 - (eq / peak).clip(upper=1.0)   # decimal in [0,1]

    # pain = only the "new damage" when DD increases
    dd_prev = dd.shift(1).fillna(0.0)
    pain = (dd - dd_prev).clip(lower=0.0).sum()

    # total compounded gain
    gain = float(eq.iloc[-1] - 1.0)

    if not np.isfinite(gain) or not np.isfinite(pain) or pain <= 0.0:
        return float("nan")
    return float(gain / pain)

def compute_profit_factor(df: pd.DataFrame, ret_col: str) -> float:
    """Alias of gain-to-pain (daily)."""
    return compute_gain_to_pain(df, ret_col)

def compute_hit_rate(df: pd.DataFrame, ret_col: str) -> float:
    """Fraction of days with return > 0."""
    r = _ret_series(df, ret_col)
    if r.empty:
        return float("nan")
    return float((r > 0).mean())

def compute_payoff_ratio(df: pd.DataFrame, ret_col: str) -> float:
    """Avg gain / |avg loss| (daily)."""
    r = _ret_series(df, ret_col)
    if r.empty:
        return float("nan")
    gains = r[r > 0]
    losses = r[r < 0]
    if len(gains) == 0 or len(losses) == 0:
        return float("nan")
    return float(gains.mean() / abs(losses.mean()))

def compute_expectancy(df: pd.DataFrame, ret_col: str) -> float:
    """Daily expectancy: E[R] = p*avg_win + (1-p)*avg_loss (avg_loss is negative)."""
    r = _ret_series(df, ret_col)
    if r.empty:
        return float("nan")
    p = (r > 0).mean()
    gains = r[r > 0].mean() if (r > 0).any() else 0.0
    losses = r[r < 0].mean() if (r < 0).any() else 0.0
    return float(p * gains + (1 - p) * losses)

def compute_ulcer_index(df: pd.DataFrame, ret_col: str) -> float:
    """
    Ulcer Index (percent points): sqrt(mean(DD%^2)), where DD% = drawdown * 100.
    """
    dd = drawdown_series_from_returns(df, ret_col)
    if dd.empty:
        return float("nan")
    dd_pct = dd * 100.0
    return float(np.sqrt((dd_pct ** 2).mean()))

def compute_ulcer_performance_index(df: pd.DataFrame, ret_col: str, cagr: float, rf: float = 0.0) -> float:
    """
    UPI = (CAGR - rf) / UI. CAGR, rf are decimals; UI is percent points.
    """
    ui = compute_ulcer_index(df, ret_col)
    if not np.isfinite(ui) or ui == 0.0:
        return float("nan")
    return float(((cagr - rf) * 100.0) / ui)

def compute_max_consecutive_wins_losses(df: pd.DataFrame, ret_col: str) -> Tuple[int, int]:
    """
    Max consecutive wins and losses (daily).
    """
    r = _ret_series(df, ret_col)
    if r.empty:
        return 0, 0
    wins = (r > 0).astype(int)
    losses = (r < 0).astype(int)

    def _max_run(x: pd.Series) -> int:
        if x.empty:
            return 0
        groups = (x != x.shift()).cumsum()
        # streak lengths where x==1
        return int(x.groupby(groups).sum().max()) if (x == 1).any() else 0

    return _max_run(wins), _max_run(losses)

def compute_avg_drawdown_and_length(df: pd.DataFrame, ret_col: str) -> Tuple[float, float]:
    """
    Average drawdown magnitude (decimal) and average drawdown length (bars).
    """
    dd = drawdown_series_from_returns(df, ret_col)
    if dd.empty:
        return float("nan"), float("nan")
    in_dd = dd > 0
    if not in_dd.any():
        return 0.0, 0.0
    groups = (in_dd != in_dd.shift(fill_value=False)).cumsum()
    mags, lens = [], []
    for g, mask in in_dd.groupby(groups):
        if not mask.iloc[0]:  # skip peak-to-peak (dd==0) groups
            continue
        idx = mask[mask].index
        seg = dd.loc[idx]
        mags.append(seg.mean())
        lens.append(len(seg))
    if not mags:
        return 0.0, 0.0
    return float(np.mean(mags)), float(np.mean(lens))

def compute_longest_drawdown_length(df: pd.DataFrame, ret_col: str) -> int:
    """
    Longest drawdown length (bars).
    """
    dd = drawdown_series_from_returns(df, ret_col)
    if dd.empty:
        return 0
    in_dd = (dd > 0).astype(int)
    if in_dd.sum() == 0:
        return 0
    groups = (in_dd != in_dd.shift()).cumsum()
    return int(in_dd.groupby(groups).sum().max())

def compute_calmar_ratio(df: pd.DataFrame, ret_col: str) -> float:
    """CAGR / MaxDD (both as decimals)."""
    cagr = compute_cagr(df, ret_col)
    dd_pct = compute_max_drawdown(df, ret_col)     # percent points
    dd_dec = (dd_pct / 100.0) if np.isfinite(dd_pct) else float("nan")
    if not np.isfinite(cagr) or not np.isfinite(dd_dec) or dd_dec == 0:
        return float("nan")
    return float(cagr / dd_dec)

def compute_skew_kurtosis(df: pd.DataFrame, ret_col: str) -> tuple[float, float]:
    r = _active_ret_series(df, ret_col)
    if r.empty:
        return float("nan"), float("nan")
    return float(r.skew()), float(r.kurt())

def compute_dd50(df: pd.DataFrame, ret_col: str = "CC") -> float:
    """Median drawdown magnitude as a DECIMAL (e.g., 0.18 for -18%)."""
    return compute_dd_percentile(df, ret_col=ret_col, q=0.50)

def compute_dd95(df: pd.DataFrame, ret_col: str = "CC") -> float:
    """95th-percentile drawdown magnitude as a DECIMAL (e.g., 0.35 for -35%)."""
    return compute_dd_percentile(df, ret_col=ret_col, q=0.95)   # 5th percentile because 100-95 = 5 and drawdowns are negative

def compute_timar_over_dd50(df: pd.DataFrame, ret_col: str = "CC") -> float:
    """Ratio; both numerator and denominator are decimals, so units cancel."""
    timar = compute_timar(df, ret_col=ret_col)
    dd50  = compute_dd50(df, ret_col=ret_col)
    if not np.isfinite(timar) or not np.isfinite(dd50) or dd50 == 0.0:
        return float("nan")
    return float(timar / dd50)

def compute_timar_over_dd95(df: pd.DataFrame, ret_col: str = "CC") -> float:
    """Ratio; both numerator and denominator are decimals, so units cancel."""
    timar = compute_timar(df, ret_col=ret_col)
    dd95  = compute_dd95(df, ret_col=ret_col)
    if not np.isfinite(timar) or not np.isfinite(dd95) or dd95 == 0.0:
        return float("nan")
    return float(timar / dd95)

def compute_dd3(df: pd.DataFrame, ret_col: str = "CC") -> float:
    """
    Average of the 3 worst drawdown **episodes** (peak→trough), as POSITIVE percent points.
    Uses drawdown magnitude (>=0) per day, groups contiguous drawdown runs, takes the
    trough of each run, then averages the top three troughs.
    """
    # daily drawdown magnitude as decimals (0.25 == -25%)
    dd = drawdown_series_from_returns(df, ret_col)
    if dd.empty:
        return float("nan")

    in_dd = dd > 0
    if not in_dd.any():
        return 0.0

    groups = (in_dd != in_dd.shift(fill_value=False)).cumsum()

    # trough (max magnitude) per drawdown run
    troughs = []
    for _, mask in in_dd.groupby(groups):
        if not mask.iloc[0]:      # skip non-drawdown segments
            continue
        seg_idx = mask[mask].index
        troughs.append(float(dd.loc[seg_idx].max()))  # magnitude

    if not troughs:
        return 0.0

    worst3 = sorted(troughs, reverse=True)[:3]
    return float(np.mean(worst3) * 100.0)  # percent points

def compute_timar_over_dd3(df: pd.DataFrame, ret_col: str = "CC", eps: float = 1e-12) -> float:
    timar = compute_timar(df, ret_col=ret_col)          # decimal
    dd3_pp = compute_dd3(df, ret_col=ret_col)           # percent points
    if not np.isfinite(timar) or not np.isfinite(dd3_pp):
        return float("nan")
    dd3_dec = dd3_pp / 100.0
    if abs(dd3_dec) <= eps:
        return float("nan")
    return float(timar / dd3_dec)

# --- Evaluation Metrics ---

def compute_alpha(passing_value, base_value):
    """
    Alpha = passing − base  (in the SAME units as inputs)
    Returns NaN if either side is missing.
    """
    p = _as_float(passing_value)
    b = _as_float(base_value)
    if p is None or b is None:
        return float('nan')
    return p - b

def compute_capture(passing_value, base_value, cap_at_one=True):
    """
    Capture ratio = passing / base  (capped at 1.0 if cap_at_one=True)
    If base <= 0 (or missing), returns NaN (not meaningful).
    """
    p = _as_float(passing_value)
    b = _as_float(base_value)
    if p is None or b is None or b <= 0:
        return float('nan')
    r = p / b
    return min(r, 1.0) if cap_at_one else r

def compute_upside(passing_value, base_value):
    """
    Upside ratio = passing / base  (never capped)
    If base <= 0 (or missing), returns NaN (not meaningful).
    """
    return compute_capture(passing_value, base_value, cap_at_one=False)

def compute_dd95_over_dd50(df: pd.DataFrame, ret_col: str = "CC") -> float:
    """
    DD95 ÷ DD50 — tail fragility vs median drawdown.
    Both inputs are drawdown magnitudes as DECIMALS (e.g., 0.35 for -35%).
    Returns NaN if either side is missing or DD50 == 0.
    """
    dd95 = compute_dd95(df, ret_col=ret_col)   # decimal
    dd50 = compute_dd50(df, ret_col=ret_col)   # decimal
    if not np.isfinite(dd95) or not np.isfinite(dd50) or dd50 == 0.0:
        return float("nan")
    return float(dd95 / dd50)


def compute_timar_expectancy_hitrate(
    df: pd.DataFrame,
    ret_col: str = "CC",
    ret_cols_for_tim: Optional[List[str]] = None,
    active_mask: Optional[pd.Series] = None,
) -> float:
    """
    TIMAR × Expectancy × HitRate — composite return/quality blend.
      • TIMAR is annualized efficiency (decimal) = CAGR / TIM.
      • Expectancy is average daily return (decimal).
      • HitRate is fraction of positive-return days in (0..1].
    Returns NaN if any component is missing.
    """
    timar = compute_timar(df, ret_col=ret_col, ret_cols_for_tim=ret_cols_for_tim, active_mask=active_mask)
    expct = compute_expectancy(df, ret_col=ret_col)
    hit   = compute_hit_rate(df, ret_col=ret_col)
    if not (np.isfinite(timar) and np.isfinite(expct) and np.isfinite(hit)):
        return float("nan")
    return float(timar * expct * hit)


# (Optional) numeric combiners if you ever need to form these from precomputed values
def combine_ratio(numerator: float, denominator: float) -> float:
    """Safe ratio helper (returns NaN if bad inputs or denominator == 0)."""
    try:
        n = float(numerator); d = float(denominator)
        if not (math.isfinite(n) and math.isfinite(d)) or d == 0.0:
            return float("nan")
        return n / d
    except Exception:
        return float("nan")

def combine_timar_expectancy_hitrate(timar: float, expectancy: float, hitrate: float) -> float:
    """Safe product helper for TIMAR × Expectancy × HitRate (returns NaN on bad inputs)."""
    try:
        t = float(timar); e = float(expectancy); h = float(hitrate)
        if not (math.isfinite(t) and math.isfinite(e) and math.isfinite(h)):
            return float("nan")
        return t * e * h
    except Exception:
        return float("nan")
