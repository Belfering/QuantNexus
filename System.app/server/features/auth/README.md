# Auth Feature

Authentication and user management.

## Endpoints

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Register with invite code |
| POST | `/api/auth/login` | Login with email/password |
| POST | `/api/auth/logout` | Invalidate refresh token |
| POST | `/api/auth/refresh` | Refresh access token |
| GET | `/api/auth/me` | Get current user info |

### Email Verification

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/verify-email` | Verify email with token |
| POST | `/api/auth/resend-verification` | Resend verification email |

### Password Reset

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/forgot-password` | Request password reset email |
| POST | `/api/auth/reset-password` | Reset password with token |

## Token Management

- **Access Token**: Short-lived JWT (15 min), passed in Authorization header
- **Refresh Token**: Long-lived random token (7 days), stored in database

## Invite Code System

During beta, registration requires a valid invite code. Invite codes can be:
- Single-use or multi-use
- Tied to a specific waitlist entry
- Have expiration dates

## Dependencies

- `routes/auth.mjs` - Core auth routes (existing)
- `routes/password-reset.mjs` - Password reset routes (existing)
- `middleware/auth.mjs` - Auth middleware (authenticate, requireAdmin, etc.)
- `services/email.mjs` - Email sending service
