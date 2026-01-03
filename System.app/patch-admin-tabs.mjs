import fs from 'fs';

let content = fs.readFileSync('./src/App.tsx', 'utf8');

// Find the closing of User Management button and add new tabs before </div>
const searchPattern = `        {/* User Management tab - only visible to main admin (super admin) */}
        {isSuperAdmin && (
          <button
            className={\`tab-btn \${adminTab === 'User Management' ? 'active' : ''}\`}
            onClick={() => setAdminTab('User Management')}
          >
            User Management
          </button>
        )}
      </div>`;

const replacement = `        {/* User Management tab - only visible to main admin (super admin) */}
        {isSuperAdmin && (
          <button
            className={\`tab-btn \${adminTab === 'User Management' ? 'active' : ''}\`}
            onClick={() => setAdminTab('User Management')}
          >
            User Management
          </button>
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
      </div>`;

if (content.includes(searchPattern)) {
  content = content.replace(searchPattern, replacement);
  fs.writeFileSync('./src/App.tsx', content);
  console.log('Successfully added User Systems and Atlas Systems tabs');
} else {
  console.log('Search pattern not found. File may have different formatting.');
  // Try a more flexible approach
  const regex = /(\{\/\* User Management tab[^}]+\}\s*\{isSuperAdmin && \(\s*<button[^>]+>\s*User Management\s*<\/button>\s*\)\}\s*)(<\/div>)/s;
  if (regex.test(content)) {
    const newTabs = `{/* User Systems tab - view all user-created systems */}
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
        `;
    content = content.replace(regex, `$1${newTabs}$2`);
    fs.writeFileSync('./src/App.tsx', content);
    console.log('Added tabs using regex approach');
  } else {
    console.log('Regex approach also failed');
  }
}
