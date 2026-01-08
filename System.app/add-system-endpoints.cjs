const fs = require('fs');
let content = fs.readFileSync('./server/index.mjs', 'utf8');

// Normalize line endings
content = content.replace(/\r\n/g, '\n');

// Find the location after /api/admin/me endpoint
const marker = `// GET /api/admin/me - Check current user's admin status
app.get('/api/admin/me', authenticate, async (req, res) => {
  res.json({
    userId: req.user.id,
    email: req.user.email,
    role: req.user.role,
    isMainAdmin: isMainAdmin(req.user),
    isAdmin: hasAdminAccess(req.user.role),
    isEngineer: hasEngineerAccess(req.user.role),
    // Legacy field
    isSuperAdmin: isMainAdmin(req.user)
  })
})`;

const newEndpoints = `// GET /api/admin/me - Check current user's admin status
app.get('/api/admin/me', authenticate, async (req, res) => {
  res.json({
    userId: req.user.id,
    email: req.user.email,
    role: req.user.role,
    isMainAdmin: isMainAdmin(req.user),
    isAdmin: hasAdminAccess(req.user.role),
    isEngineer: hasEngineerAccess(req.user.role),
    // Legacy field
    isSuperAdmin: isMainAdmin(req.user)
  })
})

// GET /api/admin/systems/user - Get all user systems (from main atlas.db)
app.get('/api/admin/systems/user', authenticate, requireSuperAdmin, async (req, res) => {
  try {
    await ensureDbInitialized()
    const { sqlite } = await import('./db/index.mjs')

    const systems = sqlite.prepare(\`
      SELECT
        b.id,
        b.owner_id,
        u.display_name as owner_name,
        u.email as owner_email,
        b.name,
        b.description,
        b.visibility,
        b.tags,
        b.fund_slot,
        b.created_at,
        b.updated_at,
        b.deleted_at,
        ROUND(m.cagr * 100, 2) as cagr_pct,
        ROUND(m.sharpe_ratio, 2) as sharpe,
        ROUND(m.max_drawdown * 100, 2) as maxdd_pct,
        ROUND(m.sortino_ratio, 2) as sortino,
        m.trading_days
      FROM bots b
      LEFT JOIN users u ON b.owner_id = u.id
      LEFT JOIN bot_metrics m ON b.id = m.bot_id
      ORDER BY b.created_at DESC
    \`).all()

    res.json({ systems })
  } catch (err) {
    console.error('Error fetching user systems:', err)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/admin/systems/atlas - Get all Atlas systems (from private atlas-private.db)
app.get('/api/admin/systems/atlas', authenticate, requireSuperAdmin, async (req, res) => {
  try {
    const systems = atlasDb.getAtlasBots()

    // Enhance with owner info from main db
    await ensureDbInitialized()
    const { sqlite } = await import('./db/index.mjs')

    const enhancedSystems = systems.map(sys => {
      const owner = sqlite.prepare('SELECT display_name, email FROM users WHERE id = ?').get(sys.ownerId)
      return {
        ...sys,
        ownerName: owner?.display_name || 'Unknown',
        ownerEmail: owner?.email || 'Unknown'
      }
    })

    res.json({ systems: enhancedSystems })
  } catch (err) {
    console.error('Error fetching atlas systems:', err)
    res.status(500).json({ error: err.message })
  }
})`;

if (content.includes(marker)) {
  content = content.replace(marker, newEndpoints);
  // Restore CRLF if needed (Windows)
  content = content.replace(/\n/g, '\r\n');
  fs.writeFileSync('./server/index.mjs', content);
  console.log('Successfully added user and atlas systems endpoints');
} else {
  console.log('Marker not found');
  // Debug
  const idx = content.indexOf("app.get('/api/admin/me'");
  console.log('Found /api/admin/me at:', idx);
  if (idx !== -1) {
    console.log('Content:', content.substring(idx, idx + 500));
  }
}
