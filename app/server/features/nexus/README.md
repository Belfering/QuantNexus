# Nexus Feature

Community (Nexus) bot browsing and portfolio correlation optimization.

## Endpoints

### Nexus Bot Browsing

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/nexus/bots` | List all Nexus bots (without payloads) |
| GET | `/api/nexus/top/cagr` | Top Nexus bots by CAGR |
| GET | `/api/nexus/top/calmar` | Top Nexus bots by Calmar ratio |
| GET | `/api/nexus/top/sharpe` | Top Nexus bots by Sharpe ratio |

### Correlation Optimization

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/correlation/optimize` | Compute optimal portfolio weights |
| POST | `/api/correlation/recommend` | Get diversification recommendations |

## Optimization Metrics

- `correlation`: Minimize average correlation (diversification)
- `volatility`: Inverse variance weighting (risk parity)
- `sharpe`: Weight by Sharpe ratio (risk-adjusted returns)
- `beta`: Inverse beta weighting (market neutrality)

## Request Examples

### Portfolio Optimization

```json
POST /api/correlation/optimize
{
  "botIds": ["bot-1", "bot-2", "bot-3"],
  "metric": "correlation",
  "period": "3y",
  "maxWeight": 0.4
}

Response: {
  "validBotIds": ["bot-1", "bot-2", "bot-3"],
  "weights": [0.35, 0.35, 0.30],
  "correlationMatrix": [[1, 0.2, 0.1], [0.2, 1, 0.3], [0.1, 0.3, 1]],
  "portfolioMetrics": {
    "cagr": 0.15,
    "volatility": 0.12,
    "sharpe": 1.25,
    "maxDrawdown": 0.08
  }
}
```

### Get Recommendations

```json
POST /api/correlation/recommend
{
  "currentBotIds": ["bot-1", "bot-2"],
  "candidateBotIds": ["bot-3", "bot-4", "bot-5"],
  "metric": "correlation",
  "limit": 3
}

Response: {
  "recommendations": [
    { "botId": "bot-5", "score": 0.8, "metrics": {...} },
    { "botId": "bot-3", "score": 0.6, "metrics": {...} }
  ]
}
```

## Dependencies

- `correlation.mjs` - Pearson correlation and alignment functions
- `db/cache.mjs` - Cached backtest results for equity curves
- `features/bots` - Database initialization
