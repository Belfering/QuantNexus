import { useState } from 'react'

export interface UseSaveMenuReturn {
  saveMenuOpen: boolean
  setSaveMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
  saveNewWatchlistName: string
  setSaveNewWatchlistName: React.Dispatch<React.SetStateAction<string>>
  justSavedFeedback: boolean
  setJustSavedFeedback: React.Dispatch<React.SetStateAction<boolean>>
  addToWatchlistBotId: string | null
  setAddToWatchlistBotId: React.Dispatch<React.SetStateAction<string | null>>
  addToWatchlistNewName: string
  setAddToWatchlistNewName: React.Dispatch<React.SetStateAction<string>>
}

export function useSaveMenu(): UseSaveMenuReturn {
  const [saveMenuOpen, setSaveMenuOpen] = useState(false)
  const [saveNewWatchlistName, setSaveNewWatchlistName] = useState('')
  const [justSavedFeedback, setJustSavedFeedback] = useState(false)
  const [addToWatchlistBotId, setAddToWatchlistBotId] = useState<string | null>(null)
  const [addToWatchlistNewName, setAddToWatchlistNewName] = useState('')

  return {
    saveMenuOpen,
    setSaveMenuOpen,
    saveNewWatchlistName,
    setSaveNewWatchlistName,
    justSavedFeedback,
    setJustSavedFeedback,
    addToWatchlistBotId,
    setAddToWatchlistBotId,
    addToWatchlistNewName,
    setAddToWatchlistNewName,
  }
}
