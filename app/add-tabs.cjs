const fs = require('fs');
let content = fs.readFileSync('./src/App.tsx', 'utf8');

// Normalize line endings
content = content.replace(/\r\n/g, '\n');

// Find the exact location after User Management button closing and before </div>
const searchStr = `          </button>
        )}
      </div>

      {adminTab === 'Atlas Overview' && (`;

const replaceStr = `          </button>
        )}
        {/* User Systems tab - view all user-created systems */}
        {isSuperAdmin && (
          <button
            className={\`tab-btn \${adminTab === 'User Systems' ? 'active' : ''}\`}
            onClick={() => setAdminTab('User Systems')}
          >
            User Systems
          </button>
        )}
        {/* Atlas Systems tab - view all Atlas admin systems */}
        {isSuperAdmin && (
          <button
            className={\`tab-btn \${adminTab === 'Atlas Systems' ? 'active' : ''}\`}
            onClick={() => setAdminTab('Atlas Systems')}
          >
            Atlas Systems
          </button>
        )}
      </div>

      {adminTab === 'Atlas Overview' && (`;

// Find the User Management section first to ensure we replace in the right location
const userMgmtIdx = content.indexOf("setAdminTab('User Management')");
if (userMgmtIdx === -1) {
  console.log('User Management tab not found');
  process.exit(1);
}

// Find the search string after User Management
const searchIdx = content.indexOf(searchStr, userMgmtIdx);
if (searchIdx === -1) {
  console.log('Search string not found after User Management');
  console.log('Looking for:', JSON.stringify(searchStr.substring(0, 100)));

  // Debug: show what's there
  const snippet = content.substring(userMgmtIdx, userMgmtIdx + 500);
  console.log('Actual content:', JSON.stringify(snippet.substring(0, 300)));
  process.exit(1);
}

content = content.substring(0, searchIdx) + replaceStr + content.substring(searchIdx + searchStr.length);

// Restore CRLF if needed (Windows)
content = content.replace(/\n/g, '\r\n');

fs.writeFileSync('./src/App.tsx', content);
console.log('Successfully added User Systems and Atlas Systems tabs');
