/**
 * Utilities for downloading files from the browser.
 */

/**
 * Download a text file with the given content.
 */
export const downloadTextFile = (
  filename: string,
  text: string,
  mime = 'text/plain'
): void => {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * Download a CSV file.
 */
export const downloadCsv = (filename: string, csvContent: string): void => {
  downloadTextFile(filename, csvContent, 'text/csv;charset=utf-8;')
}

/**
 * Download a JSON file.
 */
export const downloadJson = (filename: string, data: unknown): void => {
  const json = JSON.stringify(data, null, 2)
  downloadTextFile(filename, json, 'application/json')
}

/**
 * Download a blob as a file.
 */
export const downloadBlob = (filename: string, blob: Blob): void => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
