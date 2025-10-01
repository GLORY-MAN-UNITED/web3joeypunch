const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const { db, initDatabase } = require('./database');
const cors = require('cors');
const app = express();

app.use(cors());

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: 'your-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Set to true if using HTTPS
}));

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Routes

// Home page - show all questions
app.get('/', (req, res) => {
    // Prevent caching to ensure fresh data
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    
    const query = `
        SELECT q.*, u.username, u.tokens,
               (SELECT COUNT(*) FROM answers WHERE question_id = q.id) as answer_count
        FROM questions q 
        JOIN users u ON q.user_id = u.id 
        ORDER BY q.created_at DESC
    `;
    
    db.all(query, [], (err, questions) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Database error');
        }
        
        if (req.session.userId) {
            db.get('SELECT tokens FROM users WHERE id = ?', [req.session.userId], (err, user) => {
                const userTokens = user ? user.tokens : 0;
                const homePage = generateHomePage(questions, req.session.userId, req.session.username, userTokens);
                res.send(homePage);
            });
        } else {
            const homePage = generateHomePage(questions, null, null, 0);
            res.send(homePage);
        }
    });
});

// Login page
app.get('/login', (req, res) => {
    if (req.session.userId) {
        return res.redirect('/');
    }
    res.send(generateLoginPage());
});

// Register page
app.get('/register', (req, res) => {
    if (req.session.userId) {
        return res.redirect('/');
    }
    res.send(generateRegisterPage());
});

// Ask question page
app.get('/ask', requireAuth, (req, res) => {
    db.get('SELECT tokens FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        const userTokens = user ? user.tokens : 0;
        res.send(generateAskPage(req.session.username, userTokens));
    });
});

// Question detail page
app.get('/question/:id', (req, res) => {
    // Prevent caching to ensure fresh data
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    
    const questionId = req.params.id;
    
    // Get question details
    const questionQuery = `
        SELECT q.*, u.username, u.tokens
        FROM questions q 
        JOIN users u ON q.user_id = u.id 
        WHERE q.id = ?
    `;
    
    db.get(questionQuery, [questionId], (err, question) => {
        if (err || !question) {
            return res.status(404).send('Question not found');
        }
        
        // Get answers for this question
        const answersQuery = `
            SELECT a.*, u.username, u.tokens
            FROM answers a 
            JOIN users u ON a.user_id = u.id 
            WHERE a.question_id = ? 
            ORDER BY a.influence_points DESC, a.created_at ASC
        `;
        
        db.all(answersQuery, [questionId], (err, answers) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Database error');
            }
            
            if (req.session.userId) {
                db.get('SELECT tokens FROM users WHERE id = ?', [req.session.userId], (err, user) => {
                    const userTokens = user ? user.tokens : 0;
                    const questionPage = generateQuestionPage(question, answers, req.session.userId, req.session.username, userTokens);
                    res.send(questionPage);
                });
            } else {
                const questionPage = generateQuestionPage(question, answers, null, null, 0);
                res.send(questionPage);
            }
        });
    });
});

// API Routes

// Register user
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)',
            [username, hashedPassword], function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ error: 'Username already exists' });
                    }
                    return res.status(500).json({ error: 'Registration failed' });
                }
                
                req.session.userId = this.lastID;
                req.session.username = username;
                res.json({ success: true, message: 'Registration successful' });
            });
    } catch (error) {
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login user
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }
    
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Login failed' });
        }
        
        if (!user) {
            return res.status(400).json({ error: 'Invalid username or password' });
        }
        
        try {
            const isValid = await bcrypt.compare(password, user.password_hash);
            if (isValid) {
                req.session.userId = user.id;
                req.session.username = user.username;
                res.json({ success: true, message: 'Login successful' });
            } else {
                res.status(400).json({ error: 'Invalid username or password' });
            }
        } catch (error) {
            res.status(500).json({ error: 'Login failed' });
        }
    });
});

// Logout user
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true, message: 'Logged out successfully' });
});

// Ask a question
app.post('/api/questions', requireAuth, (req, res) => {
    const { title, content, token_reward = 1, time_limit_minutes = 10 } = req.body;
    
    if (!title || !content) {
        return res.status(400).json({ error: 'Title and content are required' });
    }
    
    // Validate token reward
    const tokenReward = parseInt(token_reward);
    if (tokenReward < 1 || tokenReward > 10) {
        return res.status(400).json({ error: 'Token reward must be between 1 and 10' });
    }
    
    // Validate time limit
    const timeLimit = parseInt(time_limit_minutes);
    if (timeLimit < 1 || timeLimit > 10) {
        return res.status(400).json({ error: 'Time limit must be between 1 and 10 minutes' });
    }
    
    // Check if user has tokens
    db.get('SELECT tokens FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!user || user.tokens < tokenReward) {
            return res.status(400).json({ error: `Not enough tokens. You need ${tokenReward} tokens to post this question.` });
        }
        
        // Calculate deadline
        const deadline = new Date();
        deadline.setMinutes(deadline.getMinutes() + timeLimit);
        
        // Deduct tokens and post question
        db.run('UPDATE users SET tokens = tokens - ? WHERE id = ?', [tokenReward, req.session.userId], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Failed to deduct tokens' });
            }
            
            db.run(`INSERT INTO questions (title, content, user_id, token_reward, time_limit_minutes, deadline) 
                    VALUES (?, ?, ?, ?, ?, ?)`,
                [title, content, req.session.userId, tokenReward, timeLimit, deadline.toISOString()], function(err) {
                    if (err) {
                        // Rollback token deduction
                        db.run('UPDATE users SET tokens = tokens + ? WHERE id = ?', [tokenReward, req.session.userId]);
                        return res.status(500).json({ error: 'Failed to post question' });
                    }
                    
                    res.json({ 
                        success: true, 
                        questionId: this.lastID,
                        message: `Question posted with ${tokenReward} token reward! Time limit: ${timeLimit} minutes.`
                    });
                });
        });
    });
});

// Post an answer
app.post('/api/answers', requireAuth, (req, res) => {
    const { questionId, content } = req.body;
    
    if (!questionId || !content) {
        return res.status(400).json({ error: 'Question ID and content are required' });
    }
    
    db.run('INSERT INTO answers (content, question_id, user_id) VALUES (?, ?, ?)',
        [content, questionId, req.session.userId], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Failed to post answer' });
            }
            
            res.json({ success: true, answerId: this.lastID });
        });
});

// Endorse a question
app.post('/api/endorse/question', requireAuth, (req, res) => {
    const { questionId } = req.body;
    
    if (!questionId) {
        return res.status(400).json({ error: 'Question ID is required' });
    }
    
    // Get user's token balance for weighted voting
    db.get('SELECT tokens FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Check if user already endorsed this question
        db.get('SELECT id FROM endorsements WHERE user_id = ? AND target_type = ? AND target_id = ?', 
            [req.session.userId, 'question', questionId], (err, existingEndorsement) => {
                if (err) {
                    return res.status(500).json({ error: 'Database error' });
                }
                
                if (existingEndorsement) {
                    return res.status(400).json({ error: 'You have already endorsed this question' });
                }
                
                // Calculate influence value based on user's token balance
                const influenceValue = Math.round((user.tokens / 10) * 10) / 10; // Round to 1 decimal place
                
                // Add endorsement (no token cost)
                db.run('INSERT INTO endorsements (user_id, target_type, target_id, influence_value) VALUES (?, ?, ?, ?)',
                    [req.session.userId, 'question', questionId, influenceValue], function(err) {
                        if (err) {
                            console.error('Error inserting endorsement:', err);
                            return res.status(500).json({ error: 'Failed to endorse' });
                        }
                        
                        // Update question influence points
                        db.run('UPDATE questions SET influence_points = influence_points + ? WHERE id = ?',
                            [influenceValue, questionId], (err) => {
                                if (err) {
                                    console.error('Error updating question influence points:', err);
                                }
                                res.json({ 
                                    success: true, 
                                    message: 'Endorsement recorded successfully!'
                                });
                            });
                    });
            });
    });
});

// Endorse an answer
app.post('/api/endorse/answer', requireAuth, (req, res) => {
    const { answerId } = req.body;
    
    if (!answerId) {
        return res.status(400).json({ error: 'Answer ID is required' });
    }
    
    // Check if user is trying to endorse their own answer
    db.get('SELECT user_id FROM answers WHERE id = ?', [answerId], (err, answer) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!answer) {
            return res.status(404).json({ error: 'Answer not found' });
        }
        
        if (answer.user_id === req.session.userId) {
            return res.status(400).json({ error: 'You cannot endorse your own answer' });
        }
        
        // Get user's token balance for weighted voting
        db.get('SELECT tokens FROM users WHERE id = ?', [req.session.userId], (err, user) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            
            // Check if user already endorsed this answer
            db.get('SELECT id FROM endorsements WHERE user_id = ? AND target_type = ? AND target_id = ?', 
                [req.session.userId, 'answer', answerId], (err, existingEndorsement) => {
                    if (err) {
                        return res.status(500).json({ error: 'Database error' });
                    }
                    
                    if (existingEndorsement) {
                        return res.status(400).json({ error: 'You have already endorsed this answer' });
                    }
                    
                    // Calculate influence value based on user's token balance
                    const influenceValue = Math.round((user.tokens / 10) * 10) / 10; // Round to 1 decimal place
                    
                    // Add endorsement (no token cost)
                    db.run('INSERT INTO endorsements (user_id, target_type, target_id, influence_value) VALUES (?, ?, ?, ?)',
                        [req.session.userId, 'answer', answerId, influenceValue], function(err) {
                            if (err) {
                                console.error('Error inserting answer endorsement:', err);
                                return res.status(500).json({ error: 'Failed to endorse' });
                            }
                            
                            // Update answer influence points
                            db.run('UPDATE answers SET influence_points = influence_points + ? WHERE id = ?',
                                [influenceValue, answerId], (err) => {
                                    if (err) {
                                        console.error('Error updating answer influence points:', err);
                                    }
                                    res.json({ 
                                        success: true, 
                                        message: 'Endorsement recorded successfully!'
                                    });
                                });
                        });
                });
        });
    });
});

// HTML Template Functions
function generateBasePage(title, content, username = null, userTokens = 0) {
    const authSection = username ? 
        `<span class="user-info">Welcome, ${username} | Tokens: ${userTokens}</span>
         <button onclick="logout()" class="btn btn-secondary">Logout</button>` :
        `<a href="/login" class="btn btn-secondary">Login</a>
         <a href="/register" class="btn btn-primary">Register</a>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - Joey Pouch</title>
    <link rel="stylesheet" href="/style.css">
</head>
<body>
    <header class="header">
        <div class="container">
            <nav class="nav">
                <a href="/" class="logo">Joey Pouch</a>
                <div class="nav-links">${authSection}</div>
            </nav>
        </div>
    </header>
    <main class="container">${content}</main>
    <script src="/script.js"></script>
</body>
</html>`;
}

function generateHomePage(questions, userId, username, userTokens = 0) {
    const questionsHtml = questions.map(q => {
        const now = new Date();
        const deadline = new Date(q.deadline);
        const isExpired = deadline <= now;
        const timeLeft = isExpired ? 0 : Math.max(0, Math.ceil((deadline - now) / 60000)); // minutes left
        
        return `
        <div class="question-item ${isExpired ? 'expired' : ''}">
            <div class="question-stats">
                <div class="stat">
                    <div class="number">${Number(q.influence_points).toFixed(1)}</div>
                    <div class="label">Influence Points</div>
                </div>
                <div class="stat">
                    <div class="number">${q.answer_count}</div>
                    <div class="label">answers</div>
                </div>
                <div class="stat token-reward">
                    <div class="number">🏆 ${q.token_reward}</div>
                    <div class="label">token reward</div>
                </div>
            </div>
            <div class="question-content">
                <h3><a href="/question/${q.id}">${q.title}</a></h3>
                <p class="question-excerpt">${q.content.substring(0, 150)}...</p>
                <div class="question-meta">
                    <span class="author">asked by ${q.username}</span>
                    <span class="date">${new Date(q.created_at).toLocaleDateString()}</span>
                    ${isExpired ? 
                        `<span class="time-status expired">⏰ Expired ${q.reward_distributed ? '(Reward distributed)' : '(Pending reward)'}</span>` :
                        `<span class="time-status active">⏰ ${timeLeft}m left</span>`
                    }
                </div>
            </div>
        </div>
        `;
    }).join('');

    const content = `
        <div class="page-header">
            <h1>All Questions</h1>
            ${userId ? '<a href="/ask" class="btn btn-primary">Ask Question</a>' : ''}
        </div>
        <div class="questions-list">
            ${questions.length > 0 ? questionsHtml : '<p>No questions yet. Be the first to ask!</p>'}
        </div>
    `;

    return generateBasePage('Home', content, username, userTokens);
}

function generateLoginPage() {
    const content = `
        <div class="auth-container">
            <h2>Login</h2>
            <form id="loginForm" class="auth-form">
                <div class="form-group">
                    <label for="username">Username:</label>
                    <input type="text" id="username" name="username" required>
                </div>
                <div class="form-group">
                    <label for="password">Password:</label>
                    <input type="password" id="password" name="password" required>
                </div>
                <button type="submit" class="btn btn-primary">Login</button>
            </form>
            <p>Don't have an account? <a href="/register">Register here</a></p>
        </div>
    `;

    return generateBasePage('Login', content);
}

function generateRegisterPage() {
    const content = `
        <div class="auth-container">
            <h2>Register</h2>
            <form id="registerForm" class="auth-form">
                <div class="form-group">
                    <label for="username">Username:</label>
                    <input type="text" id="username" name="username" required>
                </div>
                <div class="form-group">
                    <label for="password">Password:</label>
                    <input type="password" id="password" name="password" required>
                </div>
                <button type="submit" class="btn btn-primary">Register</button>
            </form>
            <p>Already have an account? <a href="/login">Login here</a></p>
        </div>
    `;

    return generateBasePage('Register', content);
}

function generateAskPage(username, userTokens = 0) {
    const content = `
        <div class="ask-container">
            <h2>Ask a Question</h2>
            <p class="token-info">💰 You have ${userTokens} tokens.</p>
            <form id="askForm" class="ask-form">
                <div class="form-group">
                    <label for="title">Question Title:</label>
                    <input type="text" id="title" name="title" placeholder="What's your programming question?" required>
                </div>
                <div class="form-group">
                    <label for="content">Question Details:</label>
                    <textarea id="content" name="content" rows="10" placeholder="Provide more details about your question..." required></textarea>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label for="token_reward">Token Reward (1-10):</label>
                        <select id="token_reward" name="token_reward" required>
                            <option value="1">1 token</option>
                            <option value="2">2 tokens</option>
                            <option value="3">3 tokens</option>
                            <option value="4">4 tokens</option>
                            <option value="5">5 tokens</option>
                            <option value="6">6 tokens</option>
                            <option value="7">7 tokens</option>
                            <option value="8">8 tokens</option>
                            <option value="9">9 tokens</option>
                            <option value="10">10 tokens</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="time_limit_minutes">Time Limit:</label>
                        <select id="time_limit_minutes" name="time_limit_minutes" required>
                            <option value="1">1 minute</option>
                            <option value="2">2 minutes</option>
                            <option value="3">3 minutes</option>
                            <option value="4">4 minutes</option>
                            <option value="5">5 minutes</option>
                            <option value="6">6 minutes</option>
                            <option value="7">7 minutes</option>
                            <option value="8">8 minutes</option>
                            <option value="9">9 minutes</option>
                            <option value="10">10 minutes</option>
                        </select>
                    </div>
                </div>
                <p class="reward-info">💡 The user with the highest-endorsed answer will receive all tokens when time expires!</p>
                <button type="submit" class="btn btn-primary" id="postQuestionBtn">
                    Post Question
                </button>
            </form>
        </div>
    `;

    return generateBasePage('Ask Question', content, username, userTokens);
}

function generateQuestionPage(question, answers, userId, username, userTokens = 0) {
    const now = new Date();
    const deadline = new Date(question.deadline);
    const isExpired = deadline <= now;
    const timeLeft = isExpired ? 0 : Math.max(0, Math.ceil((deadline - now) / 60000)); // minutes left
    
    const answersHtml = answers.map(a => {
        const isWinning = question.winning_answer_id === a.id;
        return `
        <div class="answer ${isWinning ? 'winning-answer' : ''}">
            <div class="answer-votes">
                <div class="vote-count">${Number(a.influence_points).toFixed(1)}</div>
                <div class="vote-label">Influence Points</div>
                ${isWinning ? '<div class="winner-badge">🏆 Winner</div>' : ''}
                ${userId && userId !== a.user_id && !isExpired ? `
                    <button class="btn btn-vote" onclick="endorseAnswer(${a.id})">Endorse</button>
                ` : ''}
            </div>
            <div class="answer-content">
                <p>${a.content}</p>
                <div class="answer-meta">
                    <span class="author">answered by ${a.username}</span>
                    <span class="date">${new Date(a.created_at).toLocaleDateString()}</span>
                </div>
            </div>
        </div>
        `;
    }).join('');

    const content = `
        <div class="question-detail">
            <div class="question-header">
                <h1>${question.title}</h1>
                <div class="question-meta">
                    <span class="author">asked by ${question.username}</span>
                    <span class="date">${new Date(question.created_at).toLocaleDateString()}</span>
                </div>
            </div>
            <div class="question-reward-info">
                <div class="reward-box">
                    <div class="reward-amount">🏆 ${question.token_reward} Token Reward</div>
                    <div class="time-info">
                        ${isExpired ? 
                            `<span class="time-status expired">⏰ Time Expired ${question.reward_distributed ? '(Reward Distributed)' : '(Processing...)'}</span>` :
                            `<span class="time-status active">⏰ ${timeLeft} minutes remaining</span>`
                        }
                    </div>
                    ${!isExpired ? '<p class="reward-note">💡 The answer with the most Influence Points will win all tokens when time expires!</p>' : ''}
                </div>
            </div>
            <div class="question-body">
                <div class="question-votes">
                    <div class="vote-count">${Number(question.influence_points).toFixed(1)}</div>
                    <div class="vote-label">Influence Points</div>
                    ${userId && !isExpired ? `
                        <button class="btn btn-vote" onclick="endorseQuestion(${question.id})">Endorse</button>
                    ` : ''}
                </div>
                <div class="question-content">
                    <p>${question.content}</p>
                </div>
            </div>
        </div>

        <div class="answers-section">
            <h3>${answers.length} Answer${answers.length !== 1 ? 's' : ''}</h3>
            <div class="answers-list">
                ${answersHtml}
            </div>
        </div>

        ${userId && !isExpired ? `
            <div class="answer-form-container">
                <h3>Your Answer</h3>
                <form id="answerForm" class="answer-form">
                    <input type="hidden" name="questionId" value="${question.id}">
                    <div class="form-group">
                        <textarea id="answerContent" name="content" rows="6" placeholder="Write your answer..." required></textarea>
                    </div>
                    <button type="submit" class="btn btn-primary">Post Answer</button>
                </form>
            </div>
        ` : isExpired ? '<div class="expired-notice"><p>⏰ This question has expired. No new answers can be posted.</p></div>' : '<p><a href="/login">Login</a> to post an answer.</p>'}
    `;

    return generateBasePage(question.title, content, username, userTokens);
}

// Function to check and distribute rewards for expired questions
function checkExpiredQuestions() {
    const now = new Date().toISOString();
    
    db.all(`
        SELECT id, token_reward, user_id 
        FROM questions 
        WHERE deadline <= ? AND reward_distributed = 0
    `, [now], (err, expiredQuestions) => {
        if (err) {
            console.error('Error checking expired questions:', err);
            return;
        }
        
        expiredQuestions.forEach(question => {
            // Find the answer with highest influence points for this question
            db.get(`
                SELECT a.id, a.user_id, a.influence_points, u.username
                FROM answers a
                JOIN users u ON a.user_id = u.id
                WHERE a.question_id = ?
                ORDER BY a.influence_points DESC, a.created_at ASC
                LIMIT 1
            `, [question.id], (err, winningAnswer) => {
                if (err) {
                    console.error('Error finding winning answer:', err);
                    return;
                }
                
                if (winningAnswer) {
                    // Award tokens to the winning answer's author
                    db.run(`
                        UPDATE users 
                        SET tokens = tokens + ? 
                        WHERE id = ?
                    `, [question.token_reward, winningAnswer.user_id], (err) => {
                        if (err) {
                            console.error('Error awarding tokens:', err);
                            return;
                        }
                        
                        // Mark question as reward distributed and record winning answer
                        db.run(`
                            UPDATE questions 
                            SET reward_distributed = 1, winning_answer_id = ? 
                            WHERE id = ?
                        `, [winningAnswer.id, question.id], (err) => {
                            if (err) {
                                console.error('Error updating question reward status:', err);
                            } else {
                                console.log(`Awarded ${question.token_reward} tokens to user ${winningAnswer.user_id} for winning answer to question ${question.id}`);
                            }
                        });
                    });
                } else {
                    // No answers - mark as expired without reward
                    db.run(`
                        UPDATE questions 
                        SET reward_distributed = 1 
                        WHERE id = ?
                    `, [question.id], (err) => {
                        if (err) {
                            console.error('Error marking question as expired:', err);
                        } else {
                            console.log(`Question ${question.id} expired with no answers - no reward distributed`);
                        }
                    });
                }
            });
        });
    });
}

// Check for expired questions every minute
setInterval(checkExpiredQuestions, 60000);

// Initialize database and start server
initDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('Failed to initialize database:', err);
});
