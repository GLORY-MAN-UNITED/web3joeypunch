const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Create database connection
const dbPath = path.join(__dirname, 'qa_database.sqlite');
const db = new sqlite3.Database(dbPath);

console.log('Starting database migration...');

// Add wallet_address column to users table if it doesn't exist
db.serialize(() => {
    // Check if wallet_address column exists
    db.all("PRAGMA table_info(users)", (err, columns) => {
        if (err) {
            console.error('Error checking table structure:', err);
            return;
        }
        
        const hasWalletColumn = columns.some(col => col.name === 'wallet_address');
        
        if (!hasWalletColumn) {
            console.log('Adding wallet_address column to users table...');
            db.run("ALTER TABLE users ADD COLUMN wallet_address TEXT UNIQUE", (err) => {
                if (err) {
                    console.error('Error adding wallet_address column:', err);
                } else {
                    console.log('✅ wallet_address column added successfully!');
                }
            });
        } else {
            console.log('✅ wallet_address column already exists.');
        }
    });
    
    // Display current users without wallet addresses
    db.all("SELECT id, username, wallet_address FROM users WHERE wallet_address IS NULL", (err, users) => {
        if (err) {
            console.error('Error querying users:', err);
            return;
        }
        
        if (users.length > 0) {
            console.log(`\n📋 Found ${users.length} users without wallet addresses:`);
            users.forEach(user => {
                console.log(`  - ID: ${user.id}, Username: ${user.username}`);
            });
            console.log('\nThese users will need to connect their MetaMask wallets through the Profile page.');
        } else {
            console.log('\n✅ All users have wallet addresses or no users exist yet.');
        }
        
        db.close((err) => {
            if (err) {
                console.error('Error closing database:', err);
            } else {
                console.log('\n🎉 Database migration completed successfully!');
            }
        });
    });
});