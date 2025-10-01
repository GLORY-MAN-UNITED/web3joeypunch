const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Create database connection
const dbPath = path.join(__dirname, 'qa_database.sqlite');
const db = new sqlite3.Database(dbPath);

// Initialize database tables
function initDatabase() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Users table
            db.run(`CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                wallet_address TEXT UNIQUE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`, (err) => {
                if (err) {
                    console.error('Error creating users table:', err);
                } else {
                    console.log('Users table created/verified');
                    // Check if wallet_address column exists, add it if not
                    db.run(`PRAGMA table_info(users)`, (err, rows) => {
                        if (!err) {
                            // Try to add wallet_address column if it doesn't exist
                            db.run(`ALTER TABLE users ADD COLUMN wallet_address TEXT UNIQUE`, (alterErr) => {
                                if (alterErr && !alterErr.message.includes('duplicate column name')) {
                                    console.error('Error adding wallet_address column:', alterErr);
                                } else if (!alterErr) {
                                    console.log('Added wallet_address column to existing users table');
                                }
                            });
                        }
                    });
                }
            });

            // Questions table
            db.run(`CREATE TABLE IF NOT EXISTS questions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                influence_points REAL DEFAULT 0,
                token_reward INTEGER DEFAULT 1,
                time_limit_minutes INTEGER DEFAULT 10,
                deadline DATETIME,
                reward_distributed INTEGER DEFAULT 0,
                winning_answer_id INTEGER,
                transfer_hash TEXT,
                reward_transfer_hash TEXT,
                ai_answer TEXT,
                ai_answer_updated_at DATETIME,
                FOREIGN KEY (user_id) REFERENCES users (id),
                FOREIGN KEY (winning_answer_id) REFERENCES answers (id)
            )`, (err) => {
                if (err) {
                    console.error('Error creating questions table:', err);
                } else {
                    console.log('Questions table created/verified');
                    // Add transfer_hash column if it doesn't exist
                    db.run(`ALTER TABLE questions ADD COLUMN transfer_hash TEXT`, (alterErr) => {
                        if (alterErr && !alterErr.message.includes('duplicate column name')) {
                            console.error('Error adding transfer_hash column:', alterErr);
                        } else if (!alterErr) {
                            console.log('Added transfer_hash column to questions table');
                        }
                    });
                    // Add reward_transfer_hash column if it doesn't exist
                    db.run(`ALTER TABLE questions ADD COLUMN reward_transfer_hash TEXT`, (alterErr) => {
                        if (alterErr && !alterErr.message.includes('duplicate column name')) {
                            console.error('Error adding reward_transfer_hash column:', alterErr);
                        } else if (!alterErr) {
                            console.log('Added reward_transfer_hash column to questions table');
                        }
                    });
                    db.run(`ALTER TABLE questions ADD COLUMN ai_answer TEXT`, (alterErr) => {
                        if (alterErr && !alterErr.message.includes('duplicate column name')) {
                            console.error('Error adding ai_answer column:', alterErr);
                        }
                    });
                    db.run(`ALTER TABLE questions ADD COLUMN ai_answer_updated_at DATETIME`, (alterErr) => {
                        if (alterErr && !alterErr.message.includes('duplicate column name')) {
                            console.error('Error adding ai_answer_updated_at column:', alterErr);
                        }
                    });
                }
            });

            // Answers table
            db.run(`CREATE TABLE IF NOT EXISTS answers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                question_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                influence_points REAL DEFAULT 0,
                FOREIGN KEY (question_id) REFERENCES questions (id),
                FOREIGN KEY (user_id) REFERENCES users (id)
            )`, (err) => {
                if (err) {
                    console.error('Error creating answers table:', err);
                } else {
                    console.log('Answers table created/verified');
                }
            });

            // Endorsements table to track who endorsed what
            db.run(`CREATE TABLE IF NOT EXISTS endorsements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                target_type TEXT NOT NULL CHECK (target_type IN ('question', 'answer')),
                target_id INTEGER NOT NULL,
                influence_value REAL DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id),
                UNIQUE(user_id, target_type, target_id)
            )`, (err) => {
                if (err) {
                    console.error('Error creating endorsements table:', err);
                    reject(err);
                } else {
                    console.log('Endorsements table created/verified');
                    console.log('Database initialization completed');
                    resolve();
                }
            });
        });
    });
}

module.exports = { db, initDatabase };
