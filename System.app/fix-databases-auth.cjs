const fs = require('fs');
let content = fs.readFileSync('./src/App.tsx', 'utf8');

// Normalize line endings
content = content.replace(/\r\n/g, '\n');

// Fix fetchTable to include auth header
const oldFetchTable = `  const fetchTable = useCallback(async (table: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(\`\${API_BASE}/admin/db/\${table}\`)`;

const newFetchTable = `  const fetchTable = useCallback(async (table: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(\`\${API_BASE}/admin/db/\${table}\`, {
        headers: { 'Authorization': \`Bearer \${getAuthToken()}\` }
      })`;

if (content.includes(oldFetchTable)) {
  content = content.replace(oldFetchTable, newFetchTable);
  console.log('Fixed fetchTable auth header');
} else {
  console.log('fetchTable pattern not found');
}

// Fix fetchTickers to include auth header
const oldFetchTickers = `      const res = await fetch(\`\${API_BASE}/tickers/registry/all?\${params}\`)`;

const newFetchTickers = `      const res = await fetch(\`\${API_BASE}/tickers/registry/all?\${params}\`, {
        headers: { 'Authorization': \`Bearer \${getAuthToken()}\` }
      })`;

if (content.includes(oldFetchTickers)) {
  content = content.replace(oldFetchTickers, newFetchTickers);
  console.log('Fixed fetchTickers auth header');
} else {
  console.log('fetchTickers pattern not found');
}

// Restore CRLF
content = content.replace(/\n/g, '\r\n');
fs.writeFileSync('./src/App.tsx', content);
console.log('File saved');
