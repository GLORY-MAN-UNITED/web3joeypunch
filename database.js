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
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                tokens INTEGER DEFAULT 20
            )`, (err) => {
                if (err) {
                    console.error('Error creating users table:', err);
                } else {
                    console.log('Users table created/verified');
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
                FOREIGN KEY (user_id) REFERENCES users (id),
                FOREIGN KEY (winning_answer_id) REFERENCES answers (id)
            )`, (err) => {
                if (err) {
                    console.error('Error creating questions table:', err);
                } else {
                    console.log('Questions table created/verified');
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
