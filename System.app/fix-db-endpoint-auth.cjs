const fs = require('fs');
let content = fs.readFileSync('./server/index.mjs', 'utf8');

// Normalize line endings
content = content.replace(/\r\n/g, '\n');

// Add authenticate middleware to database viewer endpoint
const oldEndpoint = `// GET /api/admin/db/:table - Get all rows from a table
app.get('/api/admin/db/:table', async (req, res) => {`;

const newEndpoint = `// GET /api/admin/db/:table - Get all rows from a table
app.get('/api/admin/db/:table', authenticate, requireAdmin, async (req, res) => {`;

if (content.includes(oldEndpoint)) {
  content = content.replace(oldEndpoint, newEndpoint);
  console.log('Added authenticate middleware to /api/admin/db/:table');
} else {
  console.log('Endpoint pattern not found');
}

// Also check if tickers/registry/all needs auth
const oldTickerEndpoint = `app.get('/api/tickers/registry/all',`;
if (content.includes(oldTickerEndpoint)) {
  // Check if it already has authenticate
  const lineStart = content.indexOf(oldTickerEndpoint);
  const lineEnd = content.indexOf('\n', lineStart);
  const line = content.substring(lineStart, lineEnd);
  if (!line.includes('authenticate')) {
    content = content.replace(
      oldTickerEndpoint,
      `app.get('/api/tickers/registry/all', authenticate,`
    );
    console.log('Added authenticate middleware to /api/tickers/registry/all');
  } else {
    console.log('/api/tickers/registry/all already has auth');
  }
} else {
  console.log('Tickers endpoint pattern not found');
}

// Restore CRLF
content = content.replace(/\n/g, '\r\n');
fs.writeFileSync('./server/index.mjs', content);
console.log('File saved');
