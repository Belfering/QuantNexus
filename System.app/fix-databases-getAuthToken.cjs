const fs = require('fs');
let content = fs.readFileSync('./src/App.tsx', 'utf8');

// Normalize line endings
content = content.replace(/\r\n/g, '\n');

// Add getAuthToken function inside DatabasesPanel, after the tickerLimit declaration
const marker = `  const tickerLimit = 500

  // Debounce ticker search`;

const replacement = `  const tickerLimit = 500

  // Get auth token from storage
  const getAuthToken = () => localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken')

  // Debounce ticker search`;

if (content.includes(marker)) {
  content = content.replace(marker, replacement);
  console.log('Added getAuthToken to DatabasesPanel');
} else {
  console.log('Marker not found');
}

// Restore CRLF
content = content.replace(/\n/g, '\r\n');
fs.writeFileSync('./src/App.tsx', content);
console.log('File saved');
