const fs = require('fs');
let content = fs.readFileSync('./src/App.tsx', 'utf8');

// Normalize line endings
content = content.replace(/\r\n/g, '\n');

// Add useEffect for User Systems and Atlas Systems after the check super admin useEffect
const marker = `  // Check if current user is super admin and fetch users for User Management tab
  useEffect(() => {
    // Check super admin status on mount
    const checkSuperAdmin = async () => {
      try {
        const res = await fetch('/api/admin/me', {
          headers: { 'Authorization': \`Bearer \${getAuthToken()}\` }
        })
        if (res.ok) {
          const data = await res.json()
          setIsSuperAdmin(data.isSuperAdmin === true)
        }
      } catch {
        setIsSuperAdmin(false)
      }
    }
    void checkSuperAdmin()
  }, [])`;

const replacement = `  // Check if current user is super admin and fetch users for User Management tab
  useEffect(() => {
    // Check super admin status on mount
    const checkSuperAdmin = async () => {
      try {
        const res = await fetch('/api/admin/me', {
          headers: { 'Authorization': \`Bearer \${getAuthToken()}\` }
        })
        if (res.ok) {
          const data = await res.json()
          setIsSuperAdmin(data.isSuperAdmin === true)
        }
      } catch {
        setIsSuperAdmin(false)
      }
    }
    void checkSuperAdmin()
  }, [])

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
  }, [adminTab, isSuperAdmin])`;

if (content.includes(marker)) {
  content = content.replace(marker, replacement);
  console.log('Added useEffect hooks for fetching systems');

  // Restore CRLF if needed (Windows)
  content = content.replace(/\n/g, '\r\n');
  fs.writeFileSync('./src/App.tsx', content);
  console.log('File saved');
} else {
  console.log('Marker not found');
}
