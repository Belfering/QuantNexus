# FRD-001: Alpaca OAuth Integration

**Status**: 📋 Planning
**Priority**: High
**Created**: 2026-01-23
**Target Release**: TBD (after OAuth app registration)

---

## Executive Summary

Implement OAuth-based Alpaca authentication to provide a seamless one-click connection flow for both Paper and Live trading accounts. This eliminates the need for manual API key entry while maintaining the existing manual credential system as a fallback for advanced users.

**Key Benefits**:
- One-click connection to Alpaca accounts (Paper + Live)
- Automatic credential management (no manual key entry or updates)
- Enhanced user onboarding experience
- Secure OAuth 2.0 authentication
- Manual key fallback for advanced users and troubleshooting

---

## Background & Motivation

### Current State
Users must manually:
1. Generate API keys from Alpaca dashboard
2. Copy/paste API Key and Secret into Trading Control panel
3. Manage separate credentials for Paper and Live accounts
4. Update credentials when Alpaca rotates keys

### Problem Statement
- Manual key entry creates friction in user onboarding
- Risk of exposing credentials during copy/paste
- No automatic credential updates when Alpaca rotates keys
- Users must manage two sets of credentials (Paper + Live)

### Competitive Analysis
**QuantMage** offers a "Link to Alpaca" button that:
- Redirects to Alpaca OAuth login
- Automatically retrieves both Paper and Live credentials
- Auto-updates credentials when Alpaca refreshes them
- Provides superior UX compared to manual key entry

---

## Requirements

### Functional Requirements

#### FR-1: OAuth Authentication Flow
- **FR-1.1**: User can initiate OAuth flow by clicking "Link to Alpaca Account" button
- **FR-1.2**: System redirects user to Alpaca OAuth authorization page
- **FR-1.3**: After user approves, system receives authorization code via callback
- **FR-1.4**: System exchanges authorization code for OAuth access token (backend only)
- **FR-1.5**: System encrypts and stores OAuth token in database
- **FR-1.6**: Single OAuth token grants access to both Paper and Live accounts

#### FR-2: Dashboard OAuth Gate
- **FR-2.1**: Dashboard shows OAuth gate by default when user is not linked
- **FR-2.2**: OAuth gate displays:
  - Welcome message
  - Benefits of OAuth connection
  - "Link to Alpaca Account" button
- **FR-2.3**: After OAuth link, dashboard shows normal portfolio/trading UI
- **FR-2.4**: Portfolio card displays "Unlink Account" button (top-right)
- **FR-2.5**: Clicking "Unlink Account" revokes OAuth and returns to gate state

#### FR-3: Manual Key Fallback
- **FR-3.1**: Trading Control panel retains manual API key entry sections
- **FR-3.2**: Manual key sections are hidden when OAuth is active
- **FR-3.3**: OAuth takes precedence over manual keys
- **FR-3.4**: Revoking OAuth reveals manual key sections
- **FR-3.5**: Manual keys continue to work for existing users (backward compatibility)

#### FR-4: Credential Management
- **FR-4.1**: System checks for OAuth credentials before falling back to manual keys
- **FR-4.2**: Alpaca client creation supports both OAuth tokens and manual keys
- **FR-4.3**: API endpoints distinguish between OAuth and manual authentication methods
- **FR-4.4**: GET `/api/admin/broker/credentials` returns OAuth status

### Non-Functional Requirements

#### NFR-1: Security
- **NFR-1.1**: OAuth `client_secret` stored in environment variable (never in frontend)
- **NFR-1.2**: Token exchange happens exclusively on backend
- **NFR-1.3**: OAuth token encrypted with AES-256-GCM before database storage
- **NFR-1.4**: CSRF protection via randomized `state` parameter
- **NFR-1.5**: State tokens expire after 10 minutes
- **NFR-1.6**: HTTPS required for OAuth callback URL (production)

#### NFR-2: Performance
- **NFR-2.1**: OAuth token retrieval adds <50ms latency to API calls
- **NFR-2.2**: State token cleanup runs automatically (no memory leaks)

#### NFR-3: Reliability
- **NFR-3.1**: OAuth failures gracefully degrade to manual key entry
- **NFR-3.2**: Expired/revoked OAuth tokens prompt user to re-link
- **NFR-3.3**: System detects 401 errors and prompts OAuth re-authentication

#### NFR-4: Usability
- **NFR-4.1**: OAuth flow completes in <30 seconds
- **NFR-4.2**: Clear error messages for OAuth failures
- **NFR-4.3**: User can unlink OAuth at any time

---

## Technical Design

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                          │
├─────────────────────────────────────────────────────────────────┤
│  Dashboard OAuth Gate  │  Portfolio with Unlink  │  Admin Panel │
│  (link button)         │  (unlink button)        │  (manual keys)│
└──────────────┬──────────────────────┬─────────────────────────┬─┘
               │                      │                         │
               ▼                      ▼                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Backend API Routes                          │
├─────────────────────────────────────────────────────────────────┤
│  /api/oauth/alpaca/initiate   │   /api/oauth/alpaca/callback   │
│  /api/oauth/alpaca/revoke     │   /api/admin/broker/credentials│
└──────────────┬──────────────────────┬──────────────────────────┘
               │                      │
               ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Alpaca OAuth Service                          │
├─────────────────────────────────────────────────────────────────┤
│  app.alpaca.markets/oauth/authorize  │  api.alpaca.markets/    │
│  (user authorization)                │  oauth/token (exchange) │
└──────────────────────────────────────┬──────────────────────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │   Database      │
                              │  broker_creds   │
                              │  (encrypted)    │
                              └─────────────────┘
```

### Database Schema Changes

**Table**: `broker_credentials` (modify existing)

```sql
-- Add new columns for OAuth support
ALTER TABLE broker_credentials ADD COLUMN auth_method TEXT DEFAULT 'manual';
  -- Values: 'manual' or 'oauth'

ALTER TABLE broker_credentials ADD COLUMN oauth_token TEXT;
  -- Encrypted OAuth access token

ALTER TABLE broker_credentials ADD COLUMN oauth_token_iv TEXT;
  -- Initialization vector for OAuth token encryption

ALTER TABLE broker_credentials ADD COLUMN oauth_token_tag TEXT;
  -- Authentication tag for OAuth token encryption
```

**Migration Notes**:
- Existing rows default to `auth_method='manual'`
- OAuth credentials use same AES-256-GCM encryption as API keys
- Single OAuth token per user (credential_type can be 'paper' as placeholder)

### API Endpoints

#### 1. GET `/api/oauth/alpaca/initiate`
**Purpose**: Start OAuth flow
**Auth**: Required (JWT)
**Response**:
```json
{
  "authUrl": "https://app.alpaca.markets/oauth/authorize?response_type=code&client_id=...&state=...&scope=account:write%20trading&redirect_uri=..."
}
```

#### 2. GET `/api/oauth/alpaca/callback`
**Purpose**: Receive authorization code from Alpaca
**Query Params**: `code`, `state`
**Logic**:
1. Verify state (CSRF check)
2. Exchange code for access_token (POST to Alpaca)
3. Test token with paper and live endpoints
4. Encrypt and store token
5. Redirect to frontend with success/error

#### 3. DELETE `/api/oauth/alpaca/revoke`
**Purpose**: Disconnect OAuth
**Auth**: Required (JWT)
**Response**: `{ success: boolean }`

#### 4. GET `/api/admin/broker/credentials` (MODIFY)
**Purpose**: Get credential status
**Auth**: Required (JWT)
**Response**:
```json
{
  "authMethod": "oauth",
  "oauth": {
    "hasToken": true,
    "scope": "account:write trading",
    "updatedAt": "2026-01-23T12:34:56Z"
  },
  "paper": { "hasCredentials": false },
  "live": { "hasCredentials": false }
}
```

### OAuth Flow Details

**Authorization URL**:
```
https://app.alpaca.markets/oauth/authorize
  ?response_type=code
  &client_id={CLIENT_ID}
  &redirect_uri={CALLBACK_URL}
  &state={RANDOM_STATE}
  &scope=account:write%20trading
  (omit 'env' param to authorize both paper + live)
```

**Token Exchange**:
```bash
POST https://api.alpaca.markets/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code={AUTH_CODE}
&client_id={CLIENT_ID}
&client_secret={CLIENT_SECRET}
&redirect_uri={CALLBACK_URL}
```

**Token Response**:
```json
{
  "access_token": "79500537-5796-4230-9661-7f7108877c60",
  "token_type": "bearer",
  "scope": "account:write trading"
}
```

### Frontend Components

#### Dashboard OAuth Gate
**File**: `System.app/src/features/dashboard/components/DashboardPanel.tsx`

**UX Flow**:
1. **Not Linked**: Show welcome card with benefits + "Link to Alpaca Account" button
2. **Linking**: Redirect to Alpaca (user approves)
3. **Linked**: Show normal portfolio UI + "Unlink Account" button

**State Management**:
```typescript
const [oauthStatus, setOauthStatus] = useState<{
  hasToken: boolean
  scope: string
  updatedAt: string
} | null>(null)
```

#### Trading Control Panel (Manual Fallback)
**File**: `System.app/src/features/admin/components/AdminPanel.tsx`

**Behavior**:
- Manual key sections hidden when `oauthStatus.hasToken === true`
- Always accessible for advanced users after OAuth revoke

---

## Implementation Plan

### Phase 1: Prerequisites
- [ ] Register OAuth app with Alpaca (https://app.alpaca.markets)
  - E-sign OAuth agreement
  - Create app: "Atlas Forge"
  - Add redirect URIs (dev + production)
  - Select scopes: `account:write`, `trading`
  - Receive `client_id` and `client_secret`
- [ ] Add credentials to `.env`:
  ```bash
  ALPACA_OAUTH_CLIENT_ID=your_client_id
  ALPACA_OAUTH_CLIENT_SECRET=your_client_secret
  ALPACA_OAUTH_REDIRECT_URI=http://localhost:8787/api/oauth/alpaca/callback
  ```
- [ ] (Optional) Submit for Alpaca review if offering live trading

### Phase 2: Database Migration
- [ ] Add OAuth columns to `broker_credentials` table
- [ ] Test migration with existing manual credentials (backward compatibility)

### Phase 3: Backend Implementation
- [ ] Create `System.app/server/routes/oauth.mjs`:
  - GET `/alpaca/initiate` - generate auth URL
  - GET `/alpaca/callback` - exchange code for token
  - DELETE `/alpaca/revoke` - disconnect OAuth
- [ ] Register OAuth router in `server/index.mjs`
- [ ] Modify `GET /api/admin/broker/credentials` to return OAuth status
- [ ] Update `getAlpacaClient()` in `server/routes/live.mjs`:
  - Check for OAuth credentials first
  - Fall back to manual credentials
- [ ] Update `createAlpacaClient()` in `server/live/broker-alpaca.mjs`:
  - Support OAuth token mode
  - Support manual key mode

### Phase 4: Frontend Implementation
- [ ] Modify `DashboardPanel.tsx`:
  - Add OAuth gate UI (welcome + link button)
  - Add "Unlink Account" button to portfolio card
  - Load OAuth status on mount
  - Handle OAuth callback redirect
- [ ] Modify `AdminPanel.tsx`:
  - Hide manual key sections when OAuth active
  - Show manual sections after OAuth revoke

### Phase 5: Testing
- [ ] Test OAuth flow happy path (link → approve → linked)
- [ ] Test OAuth token persistence (refresh page, still linked)
- [ ] Test OAuth revoke (unlink → manual sections appear)
- [ ] Test backward compatibility (existing manual keys still work)
- [ ] Test error handling (invalid state, token exchange failure)
- [ ] Test security (CSRF protection, token encryption)

### Phase 6: Documentation
- [ ] Update README with OAuth setup instructions
- [ ] Document environment variables
- [ ] Add troubleshooting guide for OAuth issues

---

## Testing Strategy

### Manual Testing

#### Test Case 1: OAuth Flow Happy Path
**Steps**:
1. Navigate to Dashboard tab
2. Click "Link to Alpaca Account" button
3. Redirected to Alpaca OAuth page
4. Log into Alpaca, approve permissions
5. Redirected back to Dashboard with success message

**Expected**:
- OAuth status shows "Connected"
- Dashboard shows normal portfolio UI
- "Unlink Account" button visible in portfolio card
- Manual key sections hidden in Trading Control

#### Test Case 2: OAuth Token Persistence
**Steps**:
1. Link OAuth account (TC1)
2. Refresh browser page
3. Navigate away and back to Dashboard

**Expected**:
- OAuth status still shows "Connected"
- Portfolio UI remains visible
- No re-authentication required

#### Test Case 3: OAuth Revoke
**Steps**:
1. Link OAuth account (TC1)
2. Click "Unlink Account" button
3. Confirm revoke

**Expected**:
- Dashboard reverts to OAuth gate
- Manual key sections visible in Trading Control
- OAuth status shows "Not Connected"

#### Test Case 4: Backward Compatibility
**Steps**:
1. Use existing manual API keys
2. Run dry-run trade
3. Add OAuth connection

**Expected**:
- Manual keys work before OAuth
- OAuth takes precedence after linking
- Manual keys still work after OAuth revoke

### Security Testing

- [ ] Verify `client_secret` never sent to frontend
- [ ] Verify token exchange happens on backend only
- [ ] Verify OAuth token encrypted in database
- [ ] Verify CSRF state parameter validation
- [ ] Verify state tokens expire (10 min)
- [ ] Verify HTTPS required for callback URL (production)

---

## Security Considerations

### OAuth Security Best Practices
1. **Client Secret Protection**: Store in environment variable, never in code or frontend
2. **Backend Token Exchange**: Never expose client_secret to frontend
3. **Token Encryption**: AES-256-GCM encryption for OAuth tokens in database
4. **CSRF Protection**: Random state parameter with 10-minute expiration
5. **HTTPS Only**: Production callback URL must use HTTPS
6. **Scope Limitation**: Request only necessary scopes (`account:write`, `trading`)

### Encryption Details
- **Algorithm**: AES-256-GCM
- **Key Derivation**: scryptSync from `BROKER_ENCRYPTION_KEY` env var
- **IV**: Random 16-byte IV per token
- **Auth Tag**: GCM authentication tag stored separately

---

## Deployment Checklist

### Development Environment
- [ ] Register Alpaca OAuth app (paper trading)
- [ ] Add dev redirect URI: `http://localhost:8787/api/oauth/alpaca/callback`
- [ ] Add credentials to `.env`
- [ ] Test OAuth flow end-to-end

### Production Environment
- [ ] Register Alpaca OAuth app (live trading)
- [ ] Submit for Alpaca review (if offering live trading)
- [ ] Add production redirect URI: `https://yourdomain.com/api/oauth/alpaca/callback`
- [ ] Update `ALPACA_OAUTH_REDIRECT_URI` env var
- [ ] Ensure HTTPS enabled on production domain
- [ ] Test OAuth flow in production

---

## Open Questions

1. **Token Refresh**: Alpaca docs don't mention token expiration. Should we implement refresh flow proactively?
   - **Decision**: Not in MVP. Add later if needed.

2. **Multiple OAuth Apps**: Should we support multiple Alpaca accounts per user?
   - **Decision**: Not in MVP. Single OAuth connection per user.

3. **Token Revocation Detection**: How to detect when Alpaca externally revokes token?
   - **Decision**: Detect 401 errors and prompt user to re-link.

4. **Offline Token Storage**: Should we cache token for offline development?
   - **Decision**: No. Always fetch from database.

---

## Success Metrics

### User Experience
- **Onboarding Time**: Reduce from ~5 minutes (manual keys) to <30 seconds (OAuth)
- **Connection Success Rate**: >95% OAuth success rate
- **User Preference**: >80% of users choose OAuth over manual keys

### Technical
- **OAuth Latency**: <50ms overhead for OAuth token retrieval
- **Error Rate**: <1% OAuth flow failures
- **Security**: Zero credential exposure incidents

---

## Dependencies

### External
- **Alpaca OAuth App**: Must register and receive `client_id` + `client_secret`
- **Alpaca Review**: May require 1-2 business days for live trading approval
- **HTTPS Certificate**: Production deployment requires valid SSL/TLS

### Internal
- **Database Migration**: OAuth columns must be added before deployment
- **Environment Variables**: `ALPACA_OAUTH_*` vars must be set
- **Encryption Key**: `BROKER_ENCRYPTION_KEY` must be configured

---

## Risks & Mitigation

### Risk 1: Alpaca Review Delay
**Impact**: Live trading unavailable until approval
**Mitigation**: Start with paper trading (no approval required)

### Risk 2: OAuth Token Revocation
**Impact**: Users suddenly lose access
**Mitigation**: Detect 401 errors, prompt re-authentication, maintain manual key fallback

### Risk 3: Client Secret Exposure
**Impact**: Security breach, unauthorized access
**Mitigation**: Store in environment variable, backend-only token exchange, regular secret rotation

### Risk 4: Backward Compatibility Break
**Impact**: Existing manual key users lose access
**Mitigation**: Keep manual key system fully functional, OAuth as additive feature

---

## Future Enhancements

### Post-MVP Features
1. **Token Refresh Flow**: Implement automatic token refresh (if Alpaca adds expiration)
2. **Multiple Account Support**: Allow users to link multiple Alpaca accounts
3. **OAuth Analytics**: Track OAuth usage, success rates, error patterns
4. **Automatic Token Rotation**: Detect and re-authenticate when Alpaca rotates tokens
5. **Offline Mode**: Cache OAuth status for offline development

---

## References

### Alpaca Documentation
- [Using OAuth2 and Trading API](https://docs.alpaca.markets/docs/using-oauth2-and-trading-api)
- [About Connect API](https://docs.alpaca.markets/docs/about-connect-api)
- [OAuth Guide](https://alpaca.markets/learn/oauth-guide)
- [OAuth Documentation](https://alpaca.markets/docs/oauth/guide/)

### Standards
- [OAuth 2.0 RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749)
- [OAuth Security Best Practices](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics)

---

## Appendix

### Environment Variables

```bash
# Required for OAuth integration
ALPACA_OAUTH_CLIENT_ID=your_client_id_here
ALPACA_OAUTH_CLIENT_SECRET=your_client_secret_here
ALPACA_OAUTH_REDIRECT_URI=http://localhost:8787/api/oauth/alpaca/callback

# Existing (no changes)
BROKER_ENCRYPTION_KEY=your-32-character-encryption-key
```

### Database Migration Script

```sql
-- Migration: Add OAuth support to broker_credentials table
-- Date: 2026-01-23
-- Description: Add columns for OAuth token storage

ALTER TABLE broker_credentials
  ADD COLUMN auth_method TEXT DEFAULT 'manual';

ALTER TABLE broker_credentials
  ADD COLUMN oauth_token TEXT;

ALTER TABLE broker_credentials
  ADD COLUMN oauth_token_iv TEXT;

ALTER TABLE broker_credentials
  ADD COLUMN oauth_token_tag TEXT;

-- Verify existing rows default to manual
-- All existing credentials should have auth_method='manual'
```

---

**Document Version**: 1.0
**Last Updated**: 2026-01-23
**Owner**: Development Team
**Reviewers**: TBD
**Approval**: Pending
