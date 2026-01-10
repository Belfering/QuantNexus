// src/tabs/HelpTab.tsx
// Help tab component - lazy loadable wrapper for Help/Support content

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { COLOR_THEMES } from '@/constants'
import { useAuthStore, useUIStore } from '@/stores'
import type { ColorTheme, UserUiState, UserId } from '@/types'

export interface HelpTabProps {
  // UI state (API-persisted)
  uiState: UserUiState
  setUiState: React.Dispatch<React.SetStateAction<UserUiState>>
  // Callbacks
  savePreferencesToApi: (userId: UserId, uiState: UserUiState) => Promise<boolean>
  // Changelog API state
  changelogLoading: boolean
  changelogContent: string | null
}

export function HelpTab({
  uiState,
  setUiState,
  savePreferencesToApi,
  changelogLoading,
  changelogContent,
}: HelpTabProps) {
  // ─── Stores ───────────────────────────────────────────────────────────────────
  const { userId } = useAuthStore()
  const helpTab = useUIStore(s => s.helpTab)

  // Derived from uiState
  const colorTheme = uiState.colorTheme ?? 'slate'
  const theme = uiState.theme

  // Auth store for display name state
  const userDisplayName = useAuthStore(s => s.userDisplayName)
  const displayNameInput = useAuthStore(s => s.displayNameInput)
  const setDisplayNameInput = useAuthStore(s => s.setDisplayNameInput)
  const displayNameAvailable = useAuthStore(s => s.displayNameAvailable)
  const setDisplayNameAvailable = useAuthStore(s => s.setDisplayNameAvailable)
  const displayNameChecking = useAuthStore(s => s.displayNameChecking)
  const displayNameError = useAuthStore(s => s.displayNameError)
  const setDisplayNameError = useAuthStore(s => s.setDisplayNameError)
  const displayNameSuccess = useAuthStore(s => s.displayNameSuccess)
  const displayNameSaving = useAuthStore(s => s.displayNameSaving)
  const saveDisplayName = useAuthStore(s => s.saveDisplayName)

  return (
    <Card className="h-full flex flex-col overflow-hidden m-4">
      <CardContent className="p-6 flex flex-col h-full overflow-auto">
        {helpTab === 'Settings' ? (
          <div className="max-w-3xl mx-auto w-full">
            <h2 className="text-xl font-bold mb-4">Settings</h2>

            <div className="mb-8 p-4 border border-border rounded-lg">
              <h3 className="font-bold mb-2">Display Name</h3>
              <p className="text-muted text-sm mb-3">
                Choose a unique display name that will be shown in the header and on your systems.
                {userDisplayName && <span className="block mt-1">Current: <span className="font-semibold text-foreground">{userDisplayName}</span></span>}
              </p>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Input
                    className={`h-8 text-sm w-64 pr-8 ${
                      displayNameInput.trim().length >= 2
                        ? displayNameAvailable === true
                          ? 'border-green-500 focus:ring-green-500'
                          : displayNameAvailable === false
                            ? 'border-red-500 focus:ring-red-500'
                            : ''
                        : ''
                    }`}
                    value={displayNameInput}
                    onChange={(e) => {
                      setDisplayNameInput(e.target.value)
                      setDisplayNameError(null)
                      setDisplayNameAvailable(null)
                    }}
                    placeholder={userDisplayName || 'Enter a display name'}
                    maxLength={30}
                  />
                  {/* Availability indicator */}
                  <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    {displayNameChecking ? (
                      <span className="text-muted text-xs">...</span>
                    ) : displayNameInput.trim().length >= 2 ? (
                      displayNameAvailable === true ? (
                        <span className="text-green-500 text-sm font-bold">✓</span>
                      ) : displayNameAvailable === false ? (
                        <span className="text-red-500 text-sm font-bold">✗</span>
                      ) : null
                    ) : null}
                  </div>
                </div>
                <Button
                  variant="default"
                  size="sm"
                  onClick={saveDisplayName}
                  disabled={displayNameSaving || !displayNameInput.trim() || displayNameAvailable === false}
                >
                  {displayNameSaving ? 'Saving...' : 'Save'}
                </Button>
              </div>
              {/* Availability status message */}
              {displayNameInput.trim().length >= 2 && !displayNameError && (
                displayNameAvailable === true ? (
                  <p className="text-green-500 text-sm mt-2">This name is available!</p>
                ) : displayNameAvailable === false ? (
                  <p className="text-red-500 text-sm mt-2">This name is not available</p>
                ) : displayNameChecking ? (
                  <p className="text-muted text-sm mt-2">Checking availability...</p>
                ) : null
              )}
              {displayNameError && (
                <p className="text-red-500 text-sm mt-2">{displayNameError}</p>
              )}
              {displayNameSuccess && (
                <p className="text-green-500 text-sm mt-2">Display name updated successfully!</p>
              )}
              <p className="text-muted text-xs mt-2">2-30 characters. Letters, numbers, spaces, underscores, and hyphens only.</p>
            </div>

            <div className="mb-8 p-4 border border-border rounded-lg">
              <h3 className="font-bold mb-2">Theme</h3>
              <div className="flex items-center gap-3">
                <Select
                  className="h-8 text-xs"
                  value={colorTheme}
                  onChange={(e) => setUiState((prev) => ({ ...prev, colorTheme: e.target.value as ColorTheme }))}
                  title="Select color theme"
                >
                  {COLOR_THEMES.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </Select>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setUiState((prev) => ({ ...prev, theme: prev.theme === 'dark' ? 'light' : 'dark' }))}
                  title="Toggle light/dark mode"
                >
                  {theme === 'dark' ? 'Light mode' : 'Dark mode'}
                </Button>
                <Button
                  variant="accent"
                  size="sm"
                  onClick={async () => {
                    if (!userId) return
                    const success = await savePreferencesToApi(userId, uiState)
                    if (success) {
                      alert('Theme preferences saved!')
                    } else {
                      alert('Failed to save preferences')
                    }
                  }}
                  title="Save theme preferences"
                >
                  Save
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto w-full">
            <h2 className="text-xl font-bold mb-4">Help & Support</h2>

            <div className="mb-8 p-4 border border-border rounded-lg">
              <h3 className="font-bold mb-2">Contact</h3>
              <p className="text-muted text-sm">Message me on Discord</p>
            </div>

            <div className="space-y-6">
              <h3 className="text-lg font-bold border-b border-border pb-2">Changelog</h3>

              {changelogLoading ? (
                <div className="text-muted text-sm">Loading changelog...</div>
              ) : changelogContent ? (
                <div className="space-y-4">
                  {(() => {
                    // Parse markdown changelog into sections
                    const sections: { version: string; content: { type: string; items: string[] }[] }[] = []
                    let currentSection: typeof sections[0] | null = null
                    let currentType: { type: string; items: string[] } | null = null

                    console.log('[changelog] Parsing content, length:', changelogContent.length)

                    // Normalize line endings (Windows \r\n -> \n)
                    const normalizedContent = changelogContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

                    for (const line of normalizedContent.split('\n')) {
                      // Version header: ## [1.2.0] - 2026-01-01
                      const versionMatch = line.match(/^## \[(.+?)\] - (.+)$/)
                      if (versionMatch) {
                        console.log('[changelog] Found version:', versionMatch[1])
                        if (currentSection) sections.push(currentSection)
                        currentSection = { version: `[${versionMatch[1]}] - ${versionMatch[2]}`, content: [] }
                        currentType = null
                        continue
                      }
                      // Section header: ### Added, ### Fixed, etc.
                      const typeMatch = line.match(/^### (.+)$/)
                      if (typeMatch && currentSection) {
                        currentType = { type: typeMatch[1], items: [] }
                        currentSection.content.push(currentType)
                        continue
                      }
                      // List item: - Some change
                      const itemMatch = line.match(/^- (.+)$/)
                      if (itemMatch && currentType) {
                        currentType.items.push(itemMatch[1])
                      }
                    }
                    if (currentSection) sections.push(currentSection)
                    console.log('[changelog] Parsed sections:', sections.length, sections)

                    const getTypeColor = (type: string) => {
                      switch (type.toLowerCase()) {
                        case 'added': return 'text-green-600 dark:text-green-400'
                        case 'fixed': return 'text-amber-600 dark:text-amber-400'
                        case 'changed': return 'text-blue-600 dark:text-blue-400'
                        case 'performance': return 'text-purple-600 dark:text-purple-400'
                        case 'features': return 'text-green-600 dark:text-green-400'
                        default: return 'text-muted'
                      }
                    }

                    return sections.map((section, i) => (
                      <div key={i}>
                        <h4 className="font-bold text-sm text-muted mb-2">{section.version}</h4>
                        <div className="pl-4 space-y-3">
                          {section.content.map((typeBlock, j) => (
                            <div key={j}>
                              <div className={`font-semibold text-sm ${getTypeColor(typeBlock.type)}`}>
                                {typeBlock.type}
                              </div>
                              <ul className="list-disc list-inside text-sm text-muted ml-2 space-y-0.5">
                                {typeBlock.items.map((item, k) => (
                                  <li key={k}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  })()}
                </div>
              ) : (
                <div className="text-muted text-sm">Failed to load changelog</div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default HelpTab
