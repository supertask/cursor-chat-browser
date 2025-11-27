
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(process.cwd(), '.temp', 'db', 'filtered.vscdb');

console.log('Opening database:', dbPath);

if (!fs.existsSync(dbPath)) {
  console.error('Database file not found!');
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
const targetId = '807a3680-0665-44fa-988e-a441a910362e';
const key = `composerData:${targetId}`;

console.log(`Searching for key: ${key}`);

// 1. Search for "mermaid" in ALL records
console.log('\n--- Searching entire DB for "mermaid" ---');
const allRows = db.prepare("SELECT key, value FROM cursorDiskKV").all();
let foundCount = 0;
allRows.forEach(row => {
    if (row.value && row.value.toLowerCase().includes('mermaid')) {
        console.log(`Found "mermaid" in key: ${row.key}`);
        foundCount++;
        // If it's the target chat, show context
        if (row.key.includes(targetId)) {
            const index = row.value.toLowerCase().indexOf('mermaid');
            console.log('Context in target:', row.value.substring(index - 50, index + 50));
        }
    }
});
console.log(`Total records with "mermaid": ${foundCount}`);

// 2. List all keys related to target ID
console.log(`\n--- All keys related to ${targetId} ---`);
allRows.forEach(row => {
    if (row.key.includes(targetId)) {
        console.log(`Key: ${row.key}, Value length: ${row.value.length}`);
    }
});

const row = db.prepare("SELECT value FROM cursorDiskKV WHERE key = ?").get(key);

if (row) {
  console.log('Record found!');
  const jsonStr = row.value;
  console.log('Raw JSON length:', jsonStr.length);
  
  // Check for "mermaid" in raw string
  const index = jsonStr.toLowerCase().indexOf('mermaid');
  if (index !== -1) {
    console.log(`"mermaid" found in raw JSON at index ${index}`);
    console.log('Context:', jsonStr.substring(index - 50, index + 50));
  } else {
    console.log('"mermaid" NOT found in raw JSON');
  }

  try {
    const data = JSON.parse(jsonStr);
    console.log('Parsed JSON successfully');
    console.log('Name:', data.name);
    
    // Check conversation text if available
    if (data.conversation) {
        console.log('Conversation length:', data.conversation.length);
        data.conversation.forEach((msg, i) => {
            if (msg.text && msg.text.toLowerCase().includes('mermaid')) {
                console.log(`Found "mermaid" in message ${i} (type ${msg.type})`);
            }
        });
    }

  } catch (e) {
    console.error('Error parsing JSON:', e);
  }

} else {
  console.error('Record not found in database.');
}

db.close();

