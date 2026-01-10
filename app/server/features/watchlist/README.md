# Watchlist Feature

Watchlist management for saving and organizing bots.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/watchlists` | List watchlists for a user |
| POST | `/api/watchlists` | Create a new watchlist |
| PUT | `/api/watchlists/:id` | Update a watchlist |
| DELETE | `/api/watchlists/:id` | Delete a watchlist |
| POST | `/api/watchlists/:id/bots` | Add a bot to a watchlist |
| DELETE | `/api/watchlists/:id/bots/:botId` | Remove a bot from a watchlist |

## Request Examples

### Create Watchlist

```json
POST /api/watchlists
{
  "userId": "user-123",
  "name": "High CAGR Strategies"
}
```

### Add Bot to Watchlist

```json
POST /api/watchlists/wl-123/bots
{
  "botId": "bot-abc"
}
```

## Dependencies

- `features/bots` - Database initialization
- `db/index.mjs` - Database operations
