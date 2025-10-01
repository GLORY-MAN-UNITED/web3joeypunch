const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Connect to the database
const dbPath = path.join(__dirname, 'qa_database.sqlite');
const db = new sqlite3.Database(dbPath);

console.log('🔍 Checking Joey Pouch Database...\n');

// Check if database exists
const fs = require('fs');
if (!fs.existsSync(dbPath)) {
    console.log('❌ Database file not found!');
    process.exit(1);
}

console.log('✅ Database file exists\n');

// Function to run queries and display results
function runQuery(query, title) {
    return new Promise((resolve, reject) => {
        console.log(`📊 ${title}:`);
        console.log('─'.repeat(50));
        
        db.all(query, [], (err, rows) => {
            if (err) {
                console.error('❌ Error:', err.message);
                reject(err);
                return;
            }
            
            if (rows.length === 0) {
                console.log('(No data found)\n');
            } else {
                console.table(rows);
                console.log(`Total records: ${rows.length}\n`);
            }
            resolve(rows);
        });
    });
}

// Main function to check all tables
async function checkDatabase() {
    try {
        // Check table structure
        await runQuery(`
            SELECT name, sql 
            FROM sqlite_master 
            WHERE type='table' 
            ORDER BY name
        `, 'Database Tables Structure');

        // Check users
        await runQuery('SELECT * FROM users', 'Users Table');

        // Check questions
        await runQuery(`
            SELECT q.id, q.title, q.content, u.username as author, 
                   q.created_at, q.influence_points 
            FROM questions q 
            LEFT JOIN users u ON q.user_id = u.id 
            ORDER BY q.created_at DESC
        `, 'Questions Table');

        // Check answers
        await runQuery(`
            SELECT a.id, a.content, q.title as question_title, 
                   u.username as author, a.created_at, a.influence_points 
            FROM answers a 
            LEFT JOIN questions q ON a.question_id = q.id 
            LEFT JOIN users u ON a.user_id = u.id 
            ORDER BY a.created_at DESC
        `, 'Answers Table');

        // Check endorsements
        await runQuery(`
            SELECT e.id, e.user_id, u.username as endorser, 
                   e.target_type, e.target_id, e.influence_value, e.created_at
            FROM endorsements e 
            LEFT JOIN users u ON e.user_id = u.id 
            ORDER BY e.created_at DESC
        `, 'Endorsements Table');

        // Summary statistics
        console.log('📈 Database Summary:');
        console.log('─'.repeat(50));
        
        const userCount = await new Promise((resolve) => {
            db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
                resolve(row ? row.count : 0);
            });
        });
        
        const questionCount = await new Promise((resolve) => {
            db.get('SELECT COUNT(*) as count FROM questions', (err, row) => {
                resolve(row ? row.count : 0);
            });
        });
        
        const answerCount = await new Promise((resolve) => {
            db.get('SELECT COUNT(*) as count FROM answers', (err, row) => {
                resolve(row ? row.count : 0);
            });
        });

        console.log(`👥 Total Users: ${userCount}`);
        console.log(`❓ Total Questions: ${questionCount}`);
        console.log(`💬 Total Answers: ${answerCount}`);
        
    } catch (error) {
        console.error('❌ Error checking database:', error);
    } finally {
        db.close((err) => {
            if (err) {
                console.error('❌ Error closing database:', err.message);
            } else {
                console.log('\n✅ Database connection closed');
            }
        });
    }
}

// Run the check
checkDatabase();
