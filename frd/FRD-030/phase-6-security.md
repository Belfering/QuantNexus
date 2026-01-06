# Phase 6: Security Hardening ⬜ PENDING

**Timeline**: Days 15-16
**Status**: ⬜ PENDING

---

## Tasks

- [ ] Implement rate limiting middleware
- [ ] Add Zod validation to all endpoints
- [ ] Review auth middleware on all routes
- [ ] Force HTTPS in production
- [ ] Configure CORS for production domain

---

## Rate Limiting

### Implementation

```javascript
// server/middleware/rateLimit.mjs
import rateLimit from 'express-rate-limit'

// General API rate limit
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
})

// Stricter limit for auth endpoints
export const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 attempts per hour
  message: { error: 'Too many login attempts, please try again later' }
})

// Backtest rate limit (expensive operation)
export const backtestLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 backtests per minute
  message: { error: 'Too many backtests, please wait' }
})
```

### Usage

```javascript
// server/index.mjs
import { apiLimiter, authLimiter, backtestLimiter } from './middleware/rateLimit.mjs'

app.use('/api', apiLimiter)
app.use('/api/auth', authLimiter)
app.use('/api/bots/:id/run-backtest', backtestLimiter)
```

---

## Zod Validation

### Schema Examples

```typescript
// server/features/bots/validation.mjs
import { z } from 'zod'

export const createBotSchema = z.object({
  name: z.string().min(1).max(100),
  payload: z.object({
    kind: z.enum(['basic', 'function', 'indicator', 'position']),
    children: z.record(z.array(z.any())).optional(),
    // ... rest of FlowNode schema
  }),
  visibility: z.enum(['private', 'nexus']).optional()
})

export const updateBotSchema = createBotSchema.partial()

export const backtestParamsSchema = z.object({
  mode: z.enum(['CC', 'COC', 'OO']).default('CC'),
  costBps: z.number().min(0).max(100).default(0),
  startDate: z.string().optional(),
  endDate: z.string().optional()
})
```

### Validation Middleware

```javascript
// server/middleware/validation.mjs
export const validate = (schema) => (req, res, next) => {
  try {
    req.body = schema.parse(req.body)
    next()
  } catch (error) {
    res.status(400).json({
      error: 'Validation failed',
      details: error.errors
    })
  }
}
```

### Usage

```javascript
// server/features/bots/routes.mjs
import { validate } from '../../middleware/validation.mjs'
import { createBotSchema, backtestParamsSchema } from './validation.mjs'

router.post('/', validate(createBotSchema), async (req, res) => {
  // req.body is validated and typed
})

router.post('/:id/run-backtest', validate(backtestParamsSchema), async (req, res) => {
  // req.body is validated and typed
})
```

---

## Auth Middleware Review

### Current Auth Routes

| Route | Auth Required | Notes |
|-------|---------------|-------|
| `POST /api/auth/login` | No | Public |
| `POST /api/auth/register` | No | Public |
| `POST /api/auth/refresh` | No | Uses refresh token |
| `GET /api/bots` | Yes | User's bots only |
| `POST /api/bots/:id/run-backtest` | Yes | Owner only |
| `GET /api/nexus/bots` | Yes | Authenticated users |
| `GET /api/admin/*` | Yes | Admin role required |
| `GET /api/candles/:ticker` | Yes | Any authenticated user |

### Auth Middleware

```javascript
// server/features/auth/middleware.mjs
import jwt from 'jsonwebtoken'

export const requireAuth = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = decoded
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid token' })
  }
}

export const requireAdmin = (req, res, next) => {
  if (!['admin', 'main_admin', 'sub_admin'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Admin access required' })
  }
  next()
}

export const requireOwnership = (paramKey = 'id') => async (req, res, next) => {
  const resourceId = req.params[paramKey]
  const resource = await db.select().from(bots).where(eq(bots.id, resourceId))

  if (!resource || resource.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' })
  }

  req.resource = resource
  next()
}
```

---

## HTTPS & CORS

### Force HTTPS in Production

```javascript
// server/index.mjs
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(`https://${req.headers.host}${req.url}`)
    }
    next()
  })
}
```

### CORS Configuration

```javascript
// server/index.mjs
import cors from 'cors'

const corsOptions = {
  origin: process.env.NODE_ENV === 'production'
    ? ['https://quantnexus.app', 'https://www.quantnexus.app']
    : ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}

app.use(cors(corsOptions))
```

---

## Success Criteria

- [ ] Rate limiting prevents abuse
- [ ] All endpoints validate input with Zod
- [ ] Auth middleware on all protected routes
- [ ] HTTPS enforced in production
- [ ] CORS allows only production domain
- [ ] No security vulnerabilities in npm audit
