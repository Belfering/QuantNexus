# C:\Users\Trader\Desktop\RSI System\Admin\metrics_registry.py

from __future__ import annotations
from typing import Iterable, Mapping, Dict, List, Optional
import math
import numpy as np
import pandas as pd

# Metric primitives
from metrics import (
    compute_cagr, compute_time_in_market, compute_timar, compute_max_drawdown,
    compute_dd3, compute_dd_percentile, num_trades, average_hold_period,
    compute_ann_volatility, compute_daily_volatility, compute_sharpe, compute_sortino,
    compute_ulcer_index, compute_ulcer_performance_index, compute_var_es,
    compute_gain_to_pain, compute_profit_factor, compute_hit_rate, compute_payoff_ratio,
    compute_expectancy, compute_avg_drawdown_and_length, compute_longest_drawdown_length,
    compute_skew_kurtosis, compute_calmar_ratio, compute_downside_deviation,
    compute_dd50, compute_dd95,
    compute_timar_over_dd50, compute_timar_over_dd95, compute_timar_over_dd3,
)

# ------------------------------------------------------------
# Schema & context
# ------------------------------------------------------------

# Bumped because DD50/DD95 scaling + monotonicity + ratios were standardized
SCHEMA_VERSION: int = 4

# Canonical core metrics & their default order (used when no set is specified)
METRICS_ORDER: List[str] = [
    "TIM",
    "TIMAR",
    "DD3",
    "TIMAR3",   # TIMAR / DD3  (DD3 in % points; handled safely below)
    "CAGR",
    "MaxDD",
    "Trades",
    "AvgHold",
    "DD50",
    "DD95",
    "DD95_over_DD50",
]

# Default compute context; scripts can override per-call
DEFAULT_CTX: Dict[str, object] = {
    "ret_eval_col": "CC",
    # Which columns count toward activity/TIM (non-zero means "in market")
    "ret_cols_for_tim": ["CC", "OO", "OC", "CO"],
    # room for future: periods_per_year, rf, mar, etc.
}

# ------------------------------------------------------------
# Optional: named metric sets per use-case
# ------------------------------------------------------------

METRIC_SETS = {
    "core":  ["Trades","AvgHold","CAGR","TIM","TIMAR","MaxDD","DD3","TIMAR3","DD50","DD95","DD95_over_DD50",],
    "swaps": ["Trades","AvgHold","CAGR","TIM","TIMAR","MaxDD","DD3","TIMAR3"],

    # Streamlined set for MCKF Small
    "mckf_small": [
        "TIMAR",
        "DD3", "DD50", "DD95",
        "TIMAR3","TIMARDD50","TIMARDD95",
        "Sharpe",
        "ExpectancyHitRate",
        "TIMAR_ExpectancyHitRate",
    ],

    # Expanded MC/KF set (means/stds computed over these) — MCKF Big
    "mckf": [
        # Core & drawdown ratios
        "Trades","CAGR","TIM","TIMAR","MaxDD","DD3","DD50","DD95",
        "TIMAR3","TIMARDD50","TIMARDD95",
        # Advanced risk/quality
        "AnnVol","DailyVol","DownsideDev","Sharpe","Sortino",
        "UlcerIdx","UPI","Calmar","HitRate","PayoffRatio","Expectancy",
        "GainToPain","ProfitFactor",
        # Tail risk
        "VaR95","ES95","ES99",
        # Drawdown structure + moments
        "AvgDDMag","AvgDDLen","MaxDDLen","Skew","Kurtosis",
    ],
}

def get_metric_order(set_name: str | None) -> List[str]:
    """Return the metric order by set name, falling back to METRICS_ORDER."""
    if not set_name:
        return list(METRICS_ORDER)
    return list(METRIC_SETS.get(set_name, METRICS_ORDER))

# ------------------------------------------------------------
# Helpers (units & ratios)
# ------------------------------------------------------------

def _to_float(x) -> float:
    try:
        if x is None:
            return float("nan")
        if isinstance(x, (int, float, np.floating)):
            xf = float(x)
            return xf if not math.isnan(xf) else float("nan")
        return float(x)
    except Exception:
        return float("nan")

def _to_pp_abs(x: float) -> float:
    """
    Convert a drawdown-like number to absolute percent points.
    Accepts either a decimal (e.g. -0.123) or already-in-% value (e.g. -12.3 or 12.3).
    Returns a non-negative % point magnitude (e.g. 12.3).
    """
    if x is None or not np.isfinite(x):
        return float("nan")
    x = float(x)
    # if looks like a decimal, scale; then take magnitude
    if -1.0000001 < x < 1.0000001:
        x *= 100.0
    return abs(x)

# --- replace helper ---
def _enforce_dd_monotone_pp(dd50_pp, dd95_pp, mdd_pp):
    """
    Inputs are absolute percent points (non-negative).
    Enforce: DD50 ≤ DD95 ≤ MaxDD. (DD3 is NOT a percentile — don't chain it.)
    """
    if np.isfinite(dd50_pp) and np.isfinite(dd95_pp) and dd95_pp < dd50_pp:
        dd95_pp = dd50_pp
    if np.isfinite(dd95_pp) and np.isfinite(mdd_pp) and dd95_pp > mdd_pp:
        dd95_pp = mdd_pp
    return dd50_pp, dd95_pp, mdd_pp

def _safe_ratio_pctden(num_dec: float, den_pp: float, eps=1e-12) -> float:
    """
    Unit-safe ratio:
      - numerator in decimals (e.g., TIMAR, CAGR)
      - denominator in % points (e.g., DD50, MaxDD) → convert to decimals via /100
    Returns NaN if denominator ~ 0 or any input invalid.
    """
    if not (np.isfinite(num_dec) and np.isfinite(den_pp)):
        return float("nan")
    d = abs(float(den_pp)) / 100.0
    return float("nan") if d <= eps else float(num_dec) / d

# ------------------------------------------------------------
# Core computation (raw)
# ------------------------------------------------------------

# Helpers to keep ctx lookups tidy
def _retcol(ctx): return (ctx or {}).get("ret_eval_col", "CC")
def _rf(ctx):     return float((ctx or {}).get("rf", 0.0))
def _mar(ctx):    return (ctx or {}).get("mar", None)

# Keep direct proxies to metric primitives.
# DD50/DD95 & ratio cleanups happen in a post-processor.
METRIC_FUNCS = {
    # core
    "Trades":      lambda df, ctx: num_trades(df, ret_col=_retcol(ctx), ret_cols=[_retcol(ctx)]),
    "AvgHold":     lambda df, ctx: average_hold_period(df, ret_col=_retcol(ctx), ret_cols=[_retcol(ctx)]),
    "CAGR":        lambda df, ctx: compute_cagr(df, ret_col=_retcol(ctx)),                                  # decimal
    "TIM":         lambda df, ctx: compute_time_in_market(
                        df, ret_cols=ctx.get("ret_cols_for_tim", ["CC","OO","OC","CO"]),
                        base_col_for_total=_retcol(ctx)),
    "TIMAR":       lambda df, ctx: compute_timar(
                        df, ret_col=_retcol(ctx),
                        ret_cols_for_tim=ctx.get("ret_cols_for_tim", ["CC","OO","OC","CO"])),

    # drawdowns (whatever their native units, we'll normalize later)
    "DD3":         lambda df, ctx: compute_dd3(df, ret_col=_retcol(ctx)),
    "MaxDD":       lambda df, ctx: compute_max_drawdown(df, ret_col=_retcol(ctx)),
    "DD50":        lambda df, ctx: compute_dd50(df, ret_col=_retcol(ctx)),
    "DD95":        lambda df, ctx: compute_dd95(df, ret_col=_retcol(ctx)),

    # ratios (we still overwrite/fill these in post-processing for safety)
    "TIMAR3":      lambda df, ctx: compute_timar_over_dd3(df,  ret_col=_retcol(ctx)),
    "TIMARDD50":   lambda df, ctx: compute_timar_over_dd50(df, ret_col=_retcol(ctx)),
    "TIMARDD95":   lambda df, ctx: compute_timar_over_dd95(df, ret_col=_retcol(ctx)),

    # advanced (risk/quality)
    "AnnVol":      lambda df, ctx: compute_ann_volatility(df, ret_col=_retcol(ctx)),                        # decimal
    "DailyVol":    lambda df, ctx: compute_daily_volatility(df, ret_col=_retcol(ctx)),                      # decimal
    "DownsideDev": lambda df, ctx: compute_downside_deviation(df, ret_col=_retcol(ctx), mar=_mar(ctx) or _rf(ctx)),  # decimal
    "Sharpe":      lambda df, ctx: compute_sharpe(df, ret_col=_retcol(ctx), rf=_rf(ctx)),                   # unitless
    "Sortino":     lambda df, ctx: compute_sortino(df, ret_col=_retcol(ctx), rf=_rf(ctx), mar=_mar(ctx)),   # unitless
    "UlcerIdx":    lambda df, ctx: compute_ulcer_index(df, ret_col=_retcol(ctx)),                           # percent points
    "UPI":         lambda df, ctx: compute_ulcer_performance_index(
                        df, ret_col=_retcol(ctx),
                        cagr=compute_cagr(df, ret_col=_retcol(ctx)), rf=_rf(ctx)),                          # unitless
    "Calmar":      lambda df, ctx: compute_calmar_ratio(df, ret_col=_retcol(ctx)),                          # unitless (will be backfilled)
    "HitRate":     lambda df, ctx: compute_hit_rate(df, ret_col=_retcol(ctx)),                              # fraction
    "PayoffRatio": lambda df, ctx: compute_payoff_ratio(df, ret_col=_retcol(ctx)),                          # unitless
    "Expectancy":  lambda df, ctx: compute_expectancy(df, ret_col=_retcol(ctx)),                            # decimal
    "GainToPain":  lambda df, ctx: compute_gain_to_pain(df, ret_col=_retcol(ctx)),                          # unitless
    "ProfitFactor":lambda df, ctx: compute_profit_factor(df, ret_col=_retcol(ctx)),                         # unitless
    "AvgDDMag":    lambda df, ctx: compute_avg_drawdown_and_length(df, ret_col=_retcol(ctx))[0],            # decimal
    "AvgDDLen":    lambda df, ctx: compute_avg_drawdown_and_length(df, ret_col=_retcol(ctx))[1],            # bars
    "MaxDDLen":    lambda df, ctx: compute_longest_drawdown_length(df, ret_col=_retcol(ctx)),               # bars
    "Skew":        lambda df, ctx: compute_skew_kurtosis(df, ret_col=_retcol(ctx))[0],                      # unitless
    "Kurtosis":    lambda df, ctx: compute_skew_kurtosis(df, ret_col=_retcol(ctx))[1],                      # unitless

    # tail risk (convert to % here so MC/KF doesn’t have to)
    "VaR95":       lambda df, ctx: compute_var_es(df, ret_col=_retcol(ctx), alpha=0.95)[0] * 100.0,         # negative %
    "ES95":        lambda df, ctx: compute_var_es(df, ret_col=_retcol(ctx), alpha=0.95)[1] * 100.0,         # negative %
    "ES99":        lambda df, ctx: compute_var_es(df, ret_col=_retcol(ctx), alpha=0.99)[1] * 100.0,         # negative %
}

# ------------------------------------------------------------
# Additional Simple Metric Calculations
# ------------------------------------------------------------

# === New composite metric names ===
COMPOSITE_METRICS = [
    "SharpeTIMAR3",             # Sharpe × TIMAR3
    "ExpectancyHitRate",        # Expectancy × HitRate
    "TIMSharpe",                # TIM × Sharpe
    "PF_over_Ulcer",            # ProfitFactor × (1 / Ulcer)
    "MaxDD_over_Ulcer",         # MaxDD / Ulcer
    "DD95_over_DD50",           # DD95 / DD50
    "CAGR_over_DownsideDev",    # CAGR × (1 / DownsideDev)
    "TIMAR_over_DownsideDev",   # TIMAR × (1 / DownsideDev)
    "TIMAR2_over_DownsideDev",  # (TIMAR^2) / DownsideDev
    "TIMAR2_over_DD3",          # (TIMAR^2) / DD3 (pp → decimal safe)
    "TIMAR_ExpectancyHitRate",  # TIMAR × Expectancy × HitRate
    "TIMAR_PF_over_Ulcer",      # TIMAR × ProfitFactor × (1 / Ulcer)
    "PFHitRate",
    "GtPHitRate",
    "ExpectancyPF",
    "ExpectancyGtP",
    "GtPPF",
    "TIMAR_over_AnnVol",
    "TIMAR_over_DailyVol",
    "TIMAR_Sharpe",
    "TIMAR_PF",
    "TIMAR_Sharpe_over_DD3",
    "TIMAR_GtP",
    "Sharpe_over_DD95",
    "TIMAR_over_Skew2",
    "DD3_over_Ulcer",
    "DD95_over_Ulcer",
    "DD50_over_Ulcer",
    "Sharpe_over_Ulcer",
    "TIMAR_over_Ulcer",
    "TIMAR3_over_Ulcer",
    "TIMARDD50_over_Ulcer",
    "TIMARDD95_over_Ulcer",
    "TIMAR_over_UlcerDD3",
    "TIMAR_over_UlcerDD50",
    "TIMAR_over_UlcerDD95",
]

# Add a set you can query from predictive.py
METRIC_SETS["predictive_composites"] = list(COMPOSITE_METRICS)

# (Optional) convenience: a bigger predictive set that includes core + composites
METRIC_SETS["predictive_plus"] = get_metric_order("core") + list(COMPOSITE_METRICS)


# ------------------------------------------------------------
# Public API
# ------------------------------------------------------------

def compute_metrics_set_by_name(
    df: pd.DataFrame,
    set_name: str = "core",
    ctx: Optional[Mapping[str, object]] = None,
) -> Dict[str, float]:
    """Convenience wrapper that computes a named set and applies MCKF post-processing."""
    vals = compute_metrics_set(df, ctx=ctx, include=get_metric_order(set_name))

    # Post-process for the MC/KF sets (and small variant)
    if set_name in {"mckf", "mckf_small"}:
        _postprocess_mckf(vals)

    return vals

def compute_metrics_set(
    df: pd.DataFrame,
    ctx: Optional[Mapping[str, object]] = None,
    include: Optional[Iterable[str]] = None,
    exclude: Optional[Iterable[str]] = None,
) -> Dict[str, float]:
    C = dict(DEFAULT_CTX)
    if ctx:
        C.update(ctx)

    names = list(include) if include is not None else list(METRICS_ORDER)
    if exclude:
        excl = set(exclude)
        names = [n for n in names if n not in excl]

    # ---- NEW: compute hidden dependencies only when needed ----
    original_requested = list(names)              # keep for later stripping
    hidden_deps: set[str] = set()
    if any(x in names for x in ("ExpectancyHitRate", "TIMAR_ExpectancyHitRate")):
        hidden_deps.update({"Expectancy", "HitRate"})  # compute, but don’t surface

    # keep order: requested first, then hidden deps that aren’t already present
    for dep in hidden_deps:
        if dep not in names:
            names.append(dep)

    out: Dict[str, float] = {}
    for name in names:
        try:
            func = METRIC_FUNCS.get(name)
            val = func(df, C) if func is not None else float("nan")
        except Exception:
            val = float("nan")
        out[name] = _to_float(val)

    # --- Active-day DD50/DD95 + safe TIMAR/DD ratios (override primitives) ---
    need_dd = any(n in names for n in ("DD50", "DD95", "TIMARDD50", "TIMARDD95"))
    if need_dd:
        dd_active_only   = bool(C.get("dd_active_only", True))   # only consider active bars
        dd_negret_only   = bool(C.get("dd_negret_only", True))   # only bars with return < 0
        dd_positive_only = True                                  # always drop dd == 0

        ret_eval_col     = C.get("ret_eval_col", "CC")
        ret_cols_for_tim = C.get("ret_cols_for_tim", ["CC","OO","OC","CO"])

        # Active-day mask = any non-zero across ret_cols_for_tim
        if dd_active_only:
            mask = pd.Series(False, index=df.index)
            for c in ret_cols_for_tim:
                if c in df.columns:
                    v = pd.to_numeric(df[c], errors="coerce").fillna(0.0)
                    mask |= (v != 0.0)
        else:
            mask = pd.Series(True, index=df.index)

        # Returns (eval col), equity, and drawdown magnitude in decimals [0,1]
        r   = pd.to_numeric(df.get(ret_eval_col, 0.0), errors="coerce").fillna(0.0).astype(float)
        eq  = (1.0 + r).cumprod()
        pk  = eq.cummax()
        ddm = (1.0 - (eq / pk).clip(upper=1.0)).fillna(0.0).astype(float)  # >= 0

        # Final sampling mask for DD percentiles
        m = mask.copy()
        if dd_positive_only:
            m &= (ddm > 0.0)   # exclude zero-DD bars (new highs / flat)
        if dd_negret_only:
            m &= (r < 0.0)     # drawdown bars must have negative return

        dds = ddm[m]
        if dds.size:
            # 'higher' avoids mixing with zeros at the cut; we already dropped zeros anyway
            dd50 = float(np.nanquantile(dds.values, 0.50, method="higher"))
            dd95 = float(np.nanquantile(dds.values, 0.95, method="higher"))
        else:
            dd50 = dd95 = float("nan")

        if "DD50" in names: out["DD50"] = dd50
        if "DD95" in names: out["DD95"] = dd95

        # Ratios (numerator/denominator both in decimals here)
        timar = out.get("TIMAR", float("nan"))
        if "TIMARDD50" in names:
            out["TIMARDD50"] = (timar / dd50) if (math.isfinite(timar) and math.isfinite(dd50) and dd50 != 0.0) else float("nan")
        if "TIMARDD95" in names:
            out["TIMARDD95"] = (timar / dd95) if (math.isfinite(timar) and math.isfinite(dd95) and dd95 != 0.0) else float("nan")

    # --- Composites (compute only if requested) ---
    if include:
        requested = set(include)
    else:
        requested = set(METRICS_ORDER)

    need_composites = bool(requested.intersection(COMPOSITE_METRICS))
    if need_composites:
        _compute_composites(out, list(requested))

    # ---- NEW: remove hidden deps from the result if they weren’t requested ----
    for dep in hidden_deps:
        if dep not in original_requested and dep in out:
            del out[dep]

    return out


# ------------------------------------------------------------
# MCKF post-processor (units + monotonicity + safe ratios)
# ------------------------------------------------------------

def _postprocess_mckf(vals: Dict[str, float]) -> None:
    """
    - Harmonize drawdown metrics to absolute percent points.
    - Enforce DD3 ≤ DD50 ≤ DD95 ≤ MaxDD.
    - Recompute TIMAR3 / TIMARDD50 / TIMARDD95 / Calmar with unit-safe math.
    - Add backward-compatible aliases for ratio names.
    """
    # 1) normalize to % points
    # DD3 is already in percent points from compute_dd3; do NOT rescale by 100
    x = vals.get("DD3", np.nan)
    dd3_pp = abs(float(x)) if np.isfinite(x) else float("nan")

    dd50_pp = _to_pp_abs(vals.get("DD50",  np.nan))
    dd95_pp = _to_pp_abs(vals.get("DD95",  np.nan))
    mdd_pp  = _to_pp_abs(vals.get("MaxDD", np.nan))

    # 2) enforce ONLY: DD50 ≤ DD95 ≤ MaxDD
    dd50_pp, dd95_pp, mdd_pp = _enforce_dd_monotone_pp(dd50_pp, dd95_pp, mdd_pp)

    vals["DD3"]   = dd3_pp
    vals["DD50"]  = dd50_pp
    vals["DD95"]  = dd95_pp
    vals["MaxDD"] = mdd_pp

    # 3) Ratios in unit-safe manner
    timar_dec = vals.get("TIMAR", np.nan)  # decimal
    cagr_dec  = vals.get("CAGR",  np.nan)  # decimal

    vals["TIMAR3"]    = _safe_ratio_pctden(timar_dec, dd3_pp)
    vals["TIMARDD50"] = _safe_ratio_pctden(timar_dec, dd50_pp)
    vals["TIMARDD95"] = _safe_ratio_pctden(timar_dec, dd95_pp)
    # If a Calmar wasn't provided (or invalid), backfill using safe math
    if not np.isfinite(vals.get("Calmar", float("nan"))):
        vals["Calmar"] = _safe_ratio_pctden(cagr_dec, mdd_pp)

    # 4) Backward-compatible aliases
    vals["TIMAR over DD50"] = vals["TIMARDD50"]
    vals["TIMAR over DD95"] = vals["TIMARDD95"]

def _safe_div(a: float, b: float, eps: float = 1e-12) -> float:
    if not (np.isfinite(a) and np.isfinite(b)):
        return float("nan")
    if abs(float(b)) <= eps:
        return float("nan")
    return float(a) / float(b)

def _compute_composites(vals: Dict[str, float], want: List[str]) -> None:
    """
    Compute composite metrics from already-computed primitives in `vals`.
    Assumes:
      - CAGR, TIM, TIMAR, Expectancy, DownsideDev are decimals (e.g., 0.12).
      - Sharpe, Sortino, ProfitFactor, HitRate are unitless (HitRate in [0,1]).
      - UlcerIdx, DD50/95, MaxDD, DD3 are in percent points if _postprocess_mckf was run.
        If not, we convert Ulcer/MaxDD/DD50/DD95 defensively to % points here.
    """
    # Fetch primitives (with defensive unit handling)
    sharpe      = vals.get("Sharpe", np.nan)
    timar       = vals.get("TIMAR", np.nan)             # decimal
    tim         = vals.get("TIM", np.nan)               # fraction 0–1
    expect      = vals.get("Expectancy", np.nan)        # decimal
    hit         = vals.get("HitRate", np.nan)           # fraction 0–1
    pf          = vals.get("ProfitFactor", np.nan)
    cagr        = vals.get("CAGR", np.nan)              # decimal
    ddev        = vals.get("DownsideDev", np.nan)       # decimal
    timar3      = vals.get("TIMAR3", np.nan)

    # Drawdown / ulcer in percent points (pp)
    ulcer_pp    = vals.get("UlcerIdx", np.nan)
    maxdd_pp    = vals.get("MaxDD", np.nan)
    dd3_pp      = vals.get("DD3", np.nan)
    dd50_pp     = vals.get("DD50", np.nan)
    dd95_pp     = vals.get("DD95", np.nan)
    gtp         = vals.get("GainToPain", np.nan)

    # If caller didn't run MCKF postproc, normalize to pp defensively
    ulcer_pp = _to_pp_abs(ulcer_pp)
    maxdd_pp = _to_pp_abs(maxdd_pp)
    dd3_pp   = _to_pp_abs(dd3_pp)
    dd50_pp  = _to_pp_abs(dd50_pp)
    dd95_pp  = _to_pp_abs(dd95_pp)

    # 1) Sharpe × TIMAR3  — blend overall risk-adjusted return with TIMAR/DD3 efficiency
    if "SharpeTIMAR3" in want:
        vals["SharpeTIMAR3"] = sharpe * timar3 if np.isfinite(sharpe) and np.isfinite(timar3) else float("nan")

    # 2) Expectancy × Hit Rate  — average daily edge scaled by win frequency
    if "ExpectancyHitRate" in want:
        vals["ExpectancyHitRate"] = expect * hit if np.isfinite(expect) and np.isfinite(hit) else float("nan")

    # 3) TIM × Sharpe  — risk-adjusted return weighted by time in market
    if "TIMSharpe" in want:
        vals["TIMSharpe"] = tim * sharpe if np.isfinite(tim) and np.isfinite(sharpe) else float("nan")

    # 4) ProfitFactor ÷ Ulcer  — payout efficiency penalized by drawdown volatility (Ulcer in pp)
    if "PF_over_Ulcer" in want:
        ulcer_dec = ulcer_pp / 100.0 if np.isfinite(ulcer_pp) else float("nan")
        vals["PF_over_Ulcer"] = _safe_div(pf, ulcer_dec)

    # 5) Ulcer ÷ MaxDD  — proportion of typical DD severity relative to worst DD (shape/consistency)
    if "Ulcer_over_MaxDD" in want:
        vals["Ulcer_over_MaxDD"] = _safe_div(ulcer_pp, maxdd_pp)

    # 6) DD95 ÷ DD50  — tail fragility: how extreme the tail is vs median DD
    if "DD95_over_DD50" in want:
        vals["DD95_over_DD50"] = _safe_div(dd95_pp, dd50_pp)

    # 7) CAGR ÷ DownsideDev  — downside-risk-adjusted growth (Sortino-like)
    if "CAGR_over_DownsideDev" in want:
        vals["CAGR_over_DownsideDev"] = _safe_div(cagr, ddev)

    # 8) TIMAR ÷ DownsideDev  — MAR adjusted by downside risk
    if "TIMAR_over_DownsideDev" in want:
        vals["TIMAR_over_DownsideDev"] = _safe_div(timar, ddev)

    # 9) TIMAR² ÷ DownsideDev  — stronger weight on MAR while penalizing downside
    if "TIMAR2_over_DownsideDev" in want:
        vals["TIMAR2_over_DownsideDev"] = _safe_div(timar * timar, ddev) if np.isfinite(timar) else float("nan")

    # 10) TIMAR² ÷ DD3  — MAR squared vs worst-drawdown episodes (DD3 in pp, safely converted)
    if "TIMAR2_over_DD3" in want:
        vals["TIMAR2_over_DD3"] = _safe_ratio_pctden(timar * timar, dd3_pp) if np.isfinite(timar) else float("nan")

    # 11) TIMAR × Expectancy × HitRate  — combine MAR with daily edge and win frequency
    if "TIMAR_ExpectancyHitRate" in want:
        vals["TIMAR_ExpectancyHitRate"] = (timar * expect * hit) if all(np.isfinite(x) for x in (timar, expect, hit)
        ) else float("nan")

    # 12) TIMAR × (PF ÷ Ulcer)  — MAR scaled by payout efficiency penalized for DD volatility
    if "TIMAR_PF_over_Ulcer" in want:
        ulcer_dec = ulcer_pp / 100.0 if np.isfinite(ulcer_pp) else float("nan")
        base = _safe_div(pf, ulcer_dec)
        vals["TIMAR_PF_over_Ulcer"] = (timar * base) if np.isfinite(timar) and np.isfinite(base) else float("nan")

    # 13) ProfitFactor × HitRate  — payout efficiency scaled by frequency of wins
    if "PFHitRate" in want:
        vals["PFHitRate"] = pf * hit if np.isfinite(pf) and np.isfinite(hit) else float("nan")

    # 14) Gain-to-Pain × HitRate  — drawdown-adjusted gain scaled by win frequency
    if "GtPHitRate" in want:
        vals["GtPHitRate"] = gtp * hit if np.isfinite(gtp) and np.isfinite(hit) else float("nan")

    # 15) Expectancy × ProfitFactor  — average edge weighted by payout efficiency
    if "ExpectancyPF" in want:
        vals["ExpectancyPF"] = expect * pf if np.isfinite(expect) and np.isfinite(pf) else float("nan")

    # 16) Expectancy × Gain-to-Pain  — average edge weighted by drawdown-adjusted gain
    if "ExpectancyGtP" in want:
        vals["ExpectancyGtP"] = expect * gtp if np.isfinite(expect) and np.isfinite(gtp) else float("nan")

    # 17) Gain-to-Pain × ProfitFactor  — drawdown-adjusted gain blended with payout efficiency
    if "GtPPF" in want:
        vals["GtPPF"] = gtp * pf if np.isfinite(gtp) and np.isfinite(pf) else float("nan")

    # --- New Inverted / Ulcer-based Ratios ---

    # 18) DD3 ÷ Ulcer
    if "DD3_over_Ulcer" in want:
        ulcer_dec = ulcer_pp / 100.0 if np.isfinite(ulcer_pp) else float("nan")
        vals["DD3_over_Ulcer"] = _safe_div(dd3_pp, ulcer_dec)

    # 19) DD95 ÷ Ulcer
    if "DD95_over_Ulcer" in want:
        ulcer_dec = ulcer_pp / 100.0 if np.isfinite(ulcer_pp) else float("nan")
        vals["DD95_over_Ulcer"] = _safe_div(dd95_pp, ulcer_dec)

    # 20) DD50 ÷ Ulcer
    if "DD50_over_Ulcer" in want:
        ulcer_dec = ulcer_pp / 100.0 if np.isfinite(ulcer_pp) else float("nan")
        vals["DD50_over_Ulcer"] = _safe_div(dd50_pp, ulcer_dec)

    # 21) Sharpe ÷ Ulcer
    if "Sharpe_over_Ulcer" in want:
        ulcer_dec = ulcer_pp / 100.0 if np.isfinite(ulcer_pp) else float("nan")
        vals["Sharpe_over_Ulcer"] = _safe_div(sharpe, ulcer_dec)

    # 22) TIMAR ÷ Ulcer
    if "TIMAR_over_Ulcer" in want:
        ulcer_dec = ulcer_pp / 100.0 if np.isfinite(ulcer_pp) else float("nan")
        vals["TIMAR_over_Ulcer"] = _safe_div(timar, ulcer_dec)

    # 23) TIMAR3 ÷ Ulcer
    if "TIMAR3_over_Ulcer" in want:
        ulcer_dec = ulcer_pp / 100.0 if np.isfinite(ulcer_pp) else float("nan")
        vals["TIMAR3_over_Ulcer"] = _safe_div(timar3, ulcer_dec)

    # 24) TIMARDD50 ÷ Ulcer
    if "TIMARDD50_over_Ulcer" in want:
        ulcer_dec = ulcer_pp / 100.0 if np.isfinite(ulcer_pp) else float("nan")
        base = vals.get("TIMARDD50", np.nan)
        vals["TIMARDD50_over_Ulcer"] = _safe_div(base, ulcer_dec)

    # 25) TIMARDD95 ÷ Ulcer
    if "TIMARDD95_over_Ulcer" in want:
        ulcer_dec = ulcer_pp / 100.0 if np.isfinite(ulcer_pp) else float("nan")
        base = vals.get("TIMARDD95", np.nan)
        vals["TIMARDD95_over_Ulcer"] = _safe_div(base, ulcer_dec)

    # 26) TIMAR ÷ (Ulcer × DD3)   [Ulcer,DD3 in pp -> decimals]
    if "TIMAR_over_UlcerDD3" in want:
        ulcer_dec = ulcer_pp / 100.0 if np.isfinite(ulcer_pp) else float("nan")
        dd3_dec   = dd3_pp / 100.0   if np.isfinite(dd3_pp)   else float("nan")
        denom = ulcer_dec * dd3_dec
        vals["TIMAR_over_UlcerDD3"] = _safe_div(timar, denom)

    # 27) TIMAR ÷ (Ulcer × DD50)  [fix: convert DD50 to decimal]
    if "TIMAR_over_UlcerDD50" in want:
        ulcer_dec = ulcer_pp / 100.0 if np.isfinite(ulcer_pp) else float("nan")
        dd50_dec  = dd50_pp / 100.0  if np.isfinite(dd50_pp)  else float("nan")
        denom = ulcer_dec * dd50_dec
        vals["TIMAR_over_UlcerDD50"] = _safe_div(timar, denom)

    # 28) TIMAR ÷ (Ulcer × DD95)  [fix: convert DD95 to decimal]
    if "TIMAR_over_UlcerDD95" in want:
        ulcer_dec = ulcer_pp / 100.0 if np.isfinite(ulcer_pp) else float("nan")
        dd95_dec  = dd95_pp / 100.0  if np.isfinite(dd95_pp)  else float("nan")
        denom = ulcer_dec * dd95_dec
        vals["TIMAR_over_UlcerDD95"] = _safe_div(timar, denom)



# ------------------------------------------------------------
# CSV header utilities
# ------------------------------------------------------------

def tag_metrics(metrics: Mapping[str, float], *tags: str, sep: str = "_") -> Dict[str, float]:
    """
    Prefix metric keys with one or more tags, e.g.:
      tag_metrics({"TIM":0.4,"CAGR":0.12}, "IS") -> {"IS_TIM":0.4,"IS_CAGR":0.12}
      tag_metrics({"TIMAR":0.7}, "OOS","MC") -> {"OOS_MC_TIMAR":0.7}
    """
    prefix = sep.join(t for t in tags if t)
    if not prefix:
        return dict(metrics)
    return {f"{prefix}{sep}{k}": _to_float(v) for k, v in metrics.items()}

def build_results_fields(
    base_fields: Iterable[str],
    scopes: Iterable[str],
    metric_names: Optional[Iterable[str]] = None,
    extras_per_scope: Optional[Iterable[str]] = None,
    sep: str = "_",
) -> List[str]:
    """
    Build a dynamic header:
      base_fields
      + for each scope in `scopes`: scope_<metric> for all metric_names
      + for each scope in `scopes`: scope_<extra>  for all extras_per_scope
    """
    fields: List[str] = list(base_fields)
    metric_names = list(metric_names) if metric_names is not None else list(METRICS_ORDER)
    extras = list(extras_per_scope) if extras_per_scope else []

    scopes_list = list(scopes)
    for scope in scopes_list:
        fields += [f"{scope}{sep}{m}" for m in metric_names]
        if extras:
            fields += [f"{scope}{sep}{e}" for e in extras]
    return fields

__all__ = [
    "SCHEMA_VERSION",
    "METRICS_ORDER",
    "DEFAULT_CTX",
    "METRIC_SETS",
    "get_metric_order",
    "compute_metrics_set_by_name",
    "compute_metrics_set",
    "tag_metrics",
    "build_results_fields",
]
