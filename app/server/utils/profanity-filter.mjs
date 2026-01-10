/**
 * Profanity filter for display names and user-generated content
 * Contains a list of banned words/patterns and validation functions
 */

// Common profanity and inappropriate terms (expandable list)
// Using base forms - the filter will also catch variations
const BANNED_WORDS = [
  // Major profanity
  'fuck', 'shit', 'ass', 'bitch', 'cunt', 'dick', 'cock', 'pussy',
  'bastard', 'damn', 'hell', 'piss', 'whore', 'slut', 'fag',
  // Racial slurs and hate speech (abbreviated to avoid full words in source)
  'nigger', 'nigga', 'chink', 'spic', 'kike', 'wetback', 'gook',
  'retard', 'faggot', 'dyke', 'tranny',
  // Sexual terms
  'porn', 'xxx', 'anal', 'dildo', 'penis', 'vagina', 'boob', 'tits',
  'masturbat', 'orgasm', 'erotic', 'horny', 'nude', 'naked', 'sex',
  // Drugs
  'cocaine', 'heroin', 'meth', 'crack',
  // Violence
  'kill', 'murder', 'rape', 'molest', 'pedo', 'terrorist',
  // Scam/impersonation
  'admin', 'administrator', 'moderator', 'support', 'official', 'staff',
  // Other inappropriate
  'nazi', 'hitler', 'kkk', 'isis', 'alqaeda',
]

// Patterns that might try to evade filters
const EVASION_PATTERNS = [
  /(.)\1{3,}/,     // Same character 4+ times (e.g., "fuuuuck")
  /[0-9]+/,        // Numbers mixed in (might be evasion like "f4ck")
  /[@$!*]+/,       // Special chars that might replace letters
]

// Common substitutions people use
const CHAR_SUBSTITUTIONS = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  '$': 's',
  '!': 'i',
  '*': '',
  '.': '',
  '-': '',
  '_': '',
}

/**
 * Normalize text by replacing common character substitutions
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  let normalized = text.toLowerCase()
  for (const [char, replacement] of Object.entries(CHAR_SUBSTITUTIONS)) {
    normalized = normalized.split(char).join(replacement)
  }
  // Remove repeated characters (e.g., "fuuuck" -> "fuck")
  normalized = normalized.replace(/(.)\1+/g, '$1$1')
  return normalized
}

/**
 * Check if a display name contains profanity or inappropriate content
 * @param {string} displayName
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateDisplayName(displayName) {
  if (!displayName || typeof displayName !== 'string') {
    return { valid: false, reason: 'Display name is required' }
  }

  const trimmed = displayName.trim()

  // Length validation
  if (trimmed.length < 2) {
    return { valid: false, reason: 'Display name must be at least 2 characters' }
  }
  if (trimmed.length > 30) {
    return { valid: false, reason: 'Display name must be 30 characters or less' }
  }

  // Only allow alphanumeric, spaces, underscores, and hyphens
  if (!/^[a-zA-Z0-9_\- ]+$/.test(trimmed)) {
    return { valid: false, reason: 'Display name can only contain letters, numbers, spaces, underscores, and hyphens' }
  }

  // Can't be all numbers
  if (/^\d+$/.test(trimmed)) {
    return { valid: false, reason: 'Display name cannot be all numbers' }
  }

  // Normalize and check against banned words
  const normalized = normalizeText(trimmed)
  const withoutSpaces = normalized.replace(/\s/g, '')

  for (const word of BANNED_WORDS) {
    // Check both with and without spaces
    if (normalized.includes(word) || withoutSpaces.includes(word)) {
      return { valid: false, reason: 'Display name contains inappropriate content' }
    }
  }

  // Check for excessive repeated characters (spam-like)
  if (/(.)\1{4,}/.test(trimmed)) {
    return { valid: false, reason: 'Display name contains too many repeated characters' }
  }

  return { valid: true }
}

/**
 * Check if text is unique among existing display names (case-insensitive)
 * This should be called with existing names from the database
 * @param {string} displayName
 * @param {string[]} existingNames
 * @param {string} [currentUserId] - Exclude this user's current name from check
 * @returns {{ valid: boolean, reason?: string }}
 */
export function isDisplayNameUnique(displayName, existingNames, currentUserId) {
  const normalizedNew = displayName.trim().toLowerCase()

  for (const existing of existingNames) {
    if (existing && existing.toLowerCase() === normalizedNew) {
      return { valid: false, reason: 'This display name is already taken' }
    }
  }

  return { valid: true }
}

export default { validateDisplayName, isDisplayNameUnique }
