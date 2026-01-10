const fs = require('fs');
let content = fs.readFileSync('./src/App.tsx', 'utf8');

// Normalize line endings
content = content.replace(/\r\n/g, '\n');

// 1. Update type to remove 'User Systems'
content = content.replace(
  "type AdminSubtab = 'Atlas Overview' | 'Nexus Maintenance' | 'Ticker Data' | 'User Management' | 'Trading Control' | 'User Systems' | 'Atlas Systems'",
  "type AdminSubtab = 'Atlas Overview' | 'Nexus Maintenance' | 'Ticker Data' | 'User Management' | 'Trading Control' | 'Atlas Systems'"
);
console.log('Updated AdminSubtab type');

// 2. Remove User Systems tab button
const userSystemsTabButton = `        {/* User Systems tab - view all user-created systems */}
        {isSuperAdmin && (
          <button
            className={\`tab-btn \${adminTab === 'User Systems' ? 'active' : ''}\`}
            onClick={() => setAdminTab('User Systems')}
          >
            User Systems
          </button>
        )}`;

content = content.replace(userSystemsTabButton, '');
console.log('Removed User Systems tab button');

// 3. Remove User Systems state variables
const userSystemsState = `
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
`;

content = content.replace(userSystemsState, '');
console.log('Removed User Systems state');

// 4. Remove User Systems useEffect
const userSystemsEffect = `
  // Fetch User Systems when tab is active
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
`;

content = content.replace(userSystemsEffect, '');
console.log('Removed User Systems useEffect');

// 5. Remove User Systems tab content UI
const userSystemsUI = `
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
`;

content = content.replace(userSystemsUI, '');
console.log('Removed User Systems UI');

// Restore CRLF
content = content.replace(/\n/g, '\r\n');
fs.writeFileSync('./src/App.tsx', content);
console.log('File saved');
