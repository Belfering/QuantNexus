const fs = require('fs');
let content = fs.readFileSync('./src/App.tsx', 'utf8');

// Normalize line endings
content = content.replace(/\r\n/g, '\n');

// 1. Add state for User Systems and Atlas Systems after adminUsersError
const stateMarker = `  const [adminUsersLoading, setAdminUsersLoading] = useState(false)
  const [adminUsersError, setAdminUsersError] = useState<string | null>(null)`;

const newState = `  const [adminUsersLoading, setAdminUsersLoading] = useState(false)
  const [adminUsersError, setAdminUsersError] = useState<string | null>(null)

  // User Systems state (super admin only - from main atlas.db)
  type UserSystem = {
    id: string
    owner_id: string
    owner_name: string | null
    owner_email: string | null
    name: string
    description: string | null
    visibility: string
    tags: string
    fund_slot: number | null
    created_at: string
    updated_at: string
    deleted_at: string | null
    cagr_pct: number | null
    sharpe: number | null
    maxdd_pct: number | null
    sortino: number | null
    trading_days: number | null
  }
  const [userSystems, setUserSystems] = useState<UserSystem[]>([])
  const [userSystemsLoading, setUserSystemsLoading] = useState(false)
  const [userSystemsError, setUserSystemsError] = useState<string | null>(null)

  // Atlas Systems state (super admin only - from private atlas-private.db)
  type AtlasSystem = {
    id: string
    ownerId: string
    ownerName: string
    ownerEmail: string
    name: string
    description: string | null
    visibility: string
    fundSlot: number | null
    tags: string[]
    createdAt: string
    updatedAt: string
    metrics: {
      cagr: number | null
      maxDrawdown: number | null
      sharpeRatio: number | null
      sortinoRatio: number | null
    } | null
  }
  const [atlasSystems, setAtlasSystems] = useState<AtlasSystem[]>([])
  const [atlasSystemsLoading, setAtlasSystemsLoading] = useState(false)
  const [atlasSystemsError, setAtlasSystemsError] = useState<string | null>(null)`;

if (content.includes(stateMarker)) {
  content = content.replace(stateMarker, newState);
  console.log('Added state variables for User Systems and Atlas Systems');
} else {
  console.log('State marker not found');
}

// 2. Add useEffect to fetch User Systems and Atlas Systems
// Find the useEffect that fetches admin users
const effectMarker = `  // User Management tab
  useEffect(() => {
    // Check super admin status on mount`;

const newEffect = `  // Fetch User Systems when tab is active
  useEffect(() => {
    if (adminTab !== 'User Systems' || !isSuperAdmin) return
    let cancelled = false

    const fetchUserSystems = async () => {
      setUserSystemsLoading(true)
      setUserSystemsError(null)
      try {
        const res = await fetch('/api/admin/systems/user', {
          headers: { 'Authorization': \`Bearer \${getAuthToken()}\` }
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || 'Failed to fetch user systems')
        }
        const data = await res.json()
        if (!cancelled) setUserSystems(data.systems || [])
      } catch (e) {
        if (!cancelled) setUserSystemsError(String((e as Error)?.message || e))
      } finally {
        if (!cancelled) setUserSystemsLoading(false)
      }
    }

    void fetchUserSystems()
    return () => { cancelled = true }
  }, [adminTab, isSuperAdmin])

  // Fetch Atlas Systems when tab is active
  useEffect(() => {
    if (adminTab !== 'Atlas Systems' || !isSuperAdmin) return
    let cancelled = false

    const fetchAtlasSystems = async () => {
      setAtlasSystemsLoading(true)
      setAtlasSystemsError(null)
      try {
        const res = await fetch('/api/admin/systems/atlas', {
          headers: { 'Authorization': \`Bearer \${getAuthToken()}\` }
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || 'Failed to fetch atlas systems')
        }
        const data = await res.json()
        if (!cancelled) setAtlasSystems(data.systems || [])
      } catch (e) {
        if (!cancelled) setAtlasSystemsError(String((e as Error)?.message || e))
      } finally {
        if (!cancelled) setAtlasSystemsLoading(false)
      }
    }

    void fetchAtlasSystems()
    return () => { cancelled = true }
  }, [adminTab, isSuperAdmin])

  // User Management tab
  useEffect(() => {
    // Check super admin status on mount`;

if (content.includes(effectMarker)) {
  content = content.replace(effectMarker, newEffect);
  console.log('Added useEffect hooks for fetching systems');
} else {
  console.log('Effect marker not found, looking for alternative...');

  // Try alternate pattern
  const altMarker = /(\s+\/\/ User Management tab\s+useEffect\(\(\) => \{\s+\/\/ Check super admin status)/;
  if (altMarker.test(content)) {
    content = content.replace(altMarker, `
  // Fetch User Systems when tab is active
  useEffect(() => {
    if (adminTab !== 'User Systems' || !isSuperAdmin) return
    let cancelled = false

    const fetchUserSystems = async () => {
      setUserSystemsLoading(true)
      setUserSystemsError(null)
      try {
        const res = await fetch('/api/admin/systems/user', {
          headers: { 'Authorization': \\\`Bearer \\\${getAuthToken()}\\\` }
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || 'Failed to fetch user systems')
        }
        const data = await res.json()
        if (!cancelled) setUserSystems(data.systems || [])
      } catch (e) {
        if (!cancelled) setUserSystemsError(String((e as Error)?.message || e))
      } finally {
        if (!cancelled) setUserSystemsLoading(false)
      }
    }

    void fetchUserSystems()
    return () => { cancelled = true }
  }, [adminTab, isSuperAdmin])

  // Fetch Atlas Systems when tab is active
  useEffect(() => {
    if (adminTab !== 'Atlas Systems' || !isSuperAdmin) return
    let cancelled = false

    const fetchAtlasSystems = async () => {
      setAtlasSystemsLoading(true)
      setAtlasSystemsError(null)
      try {
        const res = await fetch('/api/admin/systems/atlas', {
          headers: { 'Authorization': \\\`Bearer \\\${getAuthToken()}\\\` }
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || 'Failed to fetch atlas systems')
        }
        const data = await res.json()
        if (!cancelled) setAtlasSystems(data.systems || [])
      } catch (e) {
        if (!cancelled) setAtlasSystemsError(String((e as Error)?.message || e))
      } finally {
        if (!cancelled) setAtlasSystemsLoading(false)
      }
    }

    void fetchAtlasSystems()
    return () => { cancelled = true }
  }, [adminTab, isSuperAdmin])

$1`);
    console.log('Added useEffect hooks using regex');
  }
}

// 3. Add UI content for User Systems and Atlas Systems tabs
// Find the closing of User Management tab content
const uiMarker = `      {adminTab === 'User Management' && isSuperAdmin && (
        <div className="space-y-6">
          <div className="font-black text-lg">User Management</div>`;

// We need to find where the User Management tab content ends and add our new tabs there
// Let's find a more specific marker - the end of AdminPanel function
const closingMarker = `        </div>
      )}
    </>
  )
}

// ============================================
// DATABASES PANEL`;

const newUI = `        </div>
      )}

      {/* User Systems Tab - All systems from main user database */}
      {adminTab === 'User Systems' && isSuperAdmin && (
        <div className="space-y-6">
          <div className="font-black text-lg">User Systems</div>
          <p className="text-sm text-muted-foreground">
            All trading systems created by users (stored in atlas.db).
          </p>

          {userSystemsError && (
            <div className="text-destructive text-sm p-3 bg-destructive/10 rounded-lg">
              {userSystemsError}
            </div>
          )}

          {userSystemsLoading ? (
            <div className="text-muted-foreground">Loading user systems...</div>
          ) : (
            <Card className="p-4">
              <div className="text-sm text-muted-foreground mb-2">
                Total: {userSystems.length} systems
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Visibility</TableHead>
                      <TableHead>CAGR</TableHead>
                      <TableHead>Sharpe</TableHead>
                      <TableHead>Max DD</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {userSystems.map(sys => (
                      <TableRow key={sys.id} className={sys.deleted_at ? 'opacity-50' : ''}>
                        <TableCell className="font-medium">{sys.name}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {sys.owner_name || sys.owner_email || 'Unknown'}
                        </TableCell>
                        <TableCell>
                          <span className={\`px-2 py-0.5 rounded text-xs \${
                            sys.visibility === 'nexus' ? 'bg-green-500/20 text-green-500' :
                            sys.visibility === 'atlas' ? 'bg-blue-500/20 text-blue-500' :
                            sys.visibility === 'public' ? 'bg-purple-500/20 text-purple-500' :
                            'bg-muted text-muted-foreground'
                          }\`}>
                            {sys.visibility}
                          </span>
                        </TableCell>
                        <TableCell className={sys.cagr_pct != null ? (sys.cagr_pct >= 0 ? 'text-green-500' : 'text-red-500') : ''}>
                          {sys.cagr_pct != null ? \`\${sys.cagr_pct.toFixed(1)}%\` : '-'}
                        </TableCell>
                        <TableCell>{sys.sharpe != null ? sys.sharpe.toFixed(2) : '-'}</TableCell>
                        <TableCell className="text-red-500">
                          {sys.maxdd_pct != null ? \`\${sys.maxdd_pct.toFixed(1)}%\` : '-'}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {new Date(sys.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          {sys.deleted_at ? (
                            <span className="text-xs text-red-500">Deleted</span>
                          ) : (
                            <span className="text-xs text-green-500">Active</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Atlas Systems Tab - All systems from private Atlas database */}
      {adminTab === 'Atlas Systems' && isSuperAdmin && (
        <div className="space-y-6">
          <div className="font-black text-lg">Atlas Systems</div>
          <p className="text-sm text-muted-foreground">
            Private admin systems (stored in atlas-private.db). Hidden from engineers and regular users.
          </p>

          {atlasSystemsError && (
            <div className="text-destructive text-sm p-3 bg-destructive/10 rounded-lg">
              {atlasSystemsError}
            </div>
          )}

          {atlasSystemsLoading ? (
            <div className="text-muted-foreground">Loading atlas systems...</div>
          ) : atlasSystems.length === 0 ? (
            <Card className="p-6 text-center text-muted-foreground">
              No Atlas systems yet. Create systems from the Build tab and they will appear here.
            </Card>
          ) : (
            <Card className="p-4">
              <div className="text-sm text-muted-foreground mb-2">
                Total: {atlasSystems.length} systems
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Visibility</TableHead>
                      <TableHead>CAGR</TableHead>
                      <TableHead>Sharpe</TableHead>
                      <TableHead>Max DD</TableHead>
                      <TableHead>Fund Slot</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {atlasSystems.map(sys => (
                      <TableRow key={sys.id}>
                        <TableCell className="font-medium">{sys.name}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {sys.ownerName || sys.ownerEmail || 'Unknown'}
                        </TableCell>
                        <TableCell>
                          <span className="px-2 py-0.5 rounded text-xs bg-blue-500/20 text-blue-500">
                            {sys.visibility}
                          </span>
                        </TableCell>
                        <TableCell className={sys.metrics?.cagr != null ? (sys.metrics.cagr >= 0 ? 'text-green-500' : 'text-red-500') : ''}>
                          {sys.metrics?.cagr != null ? \`\${(sys.metrics.cagr * 100).toFixed(1)}%\` : '-'}
                        </TableCell>
                        <TableCell>{sys.metrics?.sharpeRatio != null ? sys.metrics.sharpeRatio.toFixed(2) : '-'}</TableCell>
                        <TableCell className="text-red-500">
                          {sys.metrics?.maxDrawdown != null ? \`\${(sys.metrics.maxDrawdown * 100).toFixed(1)}%\` : '-'}
                        </TableCell>
                        <TableCell>
                          {sys.fundSlot != null ? (
                            <span className="px-2 py-0.5 rounded text-xs bg-amber-500/20 text-amber-500">
                              Slot {sys.fundSlot}
                            </span>
                          ) : '-'}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {new Date(sys.createdAt).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
        </div>
      )}
    </>
  )
}

// ============================================
// DATABASES PANEL`;

if (content.includes(closingMarker)) {
  content = content.replace(closingMarker, newUI);
  console.log('Added UI for User Systems and Atlas Systems tabs');
} else {
  console.log('Closing marker not found');
  // Debug
  const idx = content.indexOf('DATABASES PANEL');
  if (idx !== -1) {
    console.log('Found DATABASES PANEL at:', idx);
    console.log('Content before:', content.substring(idx - 200, idx));
  }
}

// Restore CRLF if needed (Windows)
content = content.replace(/\n/g, '\r\n');
fs.writeFileSync('./src/App.tsx', content);
console.log('File saved');
