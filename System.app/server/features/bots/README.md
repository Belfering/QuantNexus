# Bots Feature

Bot CRUD operations for trading strategy management.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/bots` | List bots for a user (requires `userId` query) |
| GET | `/api/bots/:id` | Get a single bot |
| POST | `/api/bots` | Create a new bot |
| PUT | `/api/bots/:id` | Update a bot |
| DELETE | `/api/bots/:id` | Delete a bot (soft delete) |
| PUT | `/api/bots/:id/metrics` | Update bot metrics after backtest |
| GET | `/api/bots/:id/metrics` | Get bot metrics |

## Request/Response Examples

### Create Bot

```json
POST /api/bots
{
  "ownerId": "user-123",
  "name": "My Strategy",
  "payload": { "root": {...} },
  "visibility": "private"
}

Response: { "id": "bot-abc123" }
```

### Get Bot

```json
GET /api/bots/bot-abc123?userId=user-123

Response: {
  "bot": {
    "id": "bot-abc123",
    "name": "My Strategy",
    "ownerId": "user-123",
    "payload": {...},
    "visibility": "private",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

## Visibility Rules

- `private`: Only visible to owner, payload always included
- `nexus`: Visible to all users, but payload only included for owner

## Dependencies

- `db/index.mjs` - Database operations
- `middleware/errorHandler.mjs` - Async error handling
- `middleware/validation.mjs` - Request validation
