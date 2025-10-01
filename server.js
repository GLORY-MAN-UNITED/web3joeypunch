const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const { spawn } = require('child_process');
const { db, initDatabase } = require('./database');
const cors = require('cors');
const app = express();
const { getTokenBalance } = require('./balance');  // 引入区块链余额查询函数
const { mintTokensToUser } = require('./mint');  // 引入代币铸造函数

app.use(cors());

const PORT = process.env.PORT || 3000;

// Cache resolved paths for the local RAG helper so we avoid recomputing them.
const RAG_SCRIPT_PATH = path.join(__dirname, 'chunk_rag', 'answer.py');
const ADD_FILE_SCRIPT_PATH = path.join(__dirname, 'chunk_rag', 'add_file.py');
const RAG_DATA_DIR = path.join(__dirname, 'chunk_rag', 'data');

function escapeHtml(value) {
    if (!value) {
        return '';
    }
    return value.replace(/[&<>"']/g, (char) => {
        switch (char) {
            case '&':
                return '&amp;';
            case '<':
                return '&lt;';
            case '>':
                return '&gt;';
            case '"':
                return '&quot;';
            case "'":
                return '&#39;';
            default:
                return char;
        }
    });
}

function renderBasicMarkdown(value) {
    if (!value) {
        return '';
    }
    const escaped = escapeHtml(value);
    const lines = escaped.split(/\r?\n/).map((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('### ')) {
            return `<h3>${trimmed.slice(4).trim()}</h3>`;
        }
        return trimmed;
    });
    const withHeadings = lines.join('\n');
    const withBold = withHeadings.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    return withBold
        .replace(/\n{2,}/g, '<br><br>')
        .replace(/\n/g, '<br>');
}

async function generateAIAnswer(questionText) {
    const cleanedQuestion = (questionText || '').trim();
    if (!cleanedQuestion) {
        return null;
    }

    const pythonExecutable = process.env.PYTHON || process.env.PYTHON_PATH || 'python3';

    return new Promise((resolve) => {
        const subprocess = spawn(
            pythonExecutable,
            [RAG_SCRIPT_PATH, cleanedQuestion, '--data-dir', RAG_DATA_DIR],
            {
                env: process.env,
            }
        );

        let output = '';
        let errorOutput = '';

        subprocess.stdout.on('data', (data) => {
            output += data.toString();
        });

        subprocess.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        subprocess.on('error', (error) => {
            console.error('Failed to start RAG subprocess:', error);
            resolve(null);
        });

        subprocess.on('close', (code) => {
            if (code === 0 && output.trim()) {
                resolve(output.trim());
            } else {
                if (errorOutput) {
                    console.error('RAG subprocess error:', errorOutput.trim());
                }
                resolve(null);
            }
        });
    });
}

async function addQAPairToRag(questionText, answerText) {
    const cleanedQuestion = (questionText || '').trim();
    const cleanedAnswer = (answerText || '').trim();
    if (!cleanedQuestion || !cleanedAnswer) {
        return false;
    }

    const pythonExecutable = process.env.PYTHON || process.env.PYTHON_PATH || 'python3';

    return new Promise((resolve) => {
        const subprocess = spawn(
            pythonExecutable,
            [ADD_FILE_SCRIPT_PATH, cleanedQuestion, cleanedAnswer, '--data-dir', RAG_DATA_DIR],
            {
                env: process.env,
            }
        );

        let errorOutput = '';

        subprocess.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        subprocess.on('error', (error) => {
            console.error('Failed to start add_file subprocess:', error);
            resolve(false);
        });

        subprocess.on('close', (code) => {
            if (code === 0) {
                console.log('Stored QA pair in RAG for question snippet:', cleanedQuestion.slice(0, 80));
                resolve(true);
            } else {
                if (errorOutput) {
                    console.error('add_file subprocess error:', errorOutput.trim());
                }
                resolve(false);
            }
        });
    });
}

function buildRagQuestionText(question) {
    const parts = [question.title, question.content].filter(part => part && part.toString().trim());
    return parts.join('\n\n').trim();
}

async function ensureAiAnswerForQuestion(question) {
    if (question.ai_answer && question.ai_answer.toString().trim()) {
        return question.ai_answer;
    }

    const ragPromptParts = [question.title || '', question.content || ''].filter(Boolean);
    const ragPrompt = ragPromptParts.join('\n\n').slice(0, 2000);
    try {
        const aiAnswer = await generateAIAnswer(ragPrompt);
        if (!aiAnswer) {
            return null;
        }
        await new Promise((resolve) => {
            db.run(
                'UPDATE questions SET ai_answer = ?, ai_answer_updated_at = ? WHERE id = ?',
                [aiAnswer, new Date().toISOString(), question.id],
                (updateErr) => {
                    if (updateErr) {
                        console.error('Failed to persist AI answer during expiration:', updateErr);
                    } else {
                        question.ai_answer = aiAnswer;
                    }
                    resolve();
                }
            );
        });
        return aiAnswer;
    } catch (error) {
        console.error('Failed to generate AI answer for expired question:', error);
        return null;
    }
}

async function persistQuestionToRag(question, winningAnswer) {
    try {
        const questionText = buildRagQuestionText(question);
        if (!questionText) {
            return;
        }

        const hasStrongHumanAnswer = winningAnswer && Number(winningAnswer.influence_points || 0) > 0 && winningAnswer.content;
        if (hasStrongHumanAnswer) {
            const stored = await addQAPairToRag(questionText, winningAnswer.content);
            if (stored) {
                return;
            }
            console.warn('Failed to store human answer in RAG for question', question.id, '- falling back to AI answer');
        }

        const aiAnswer = await ensureAiAnswerForQuestion(question);
        if (aiAnswer) {
            const stored = await addQAPairToRag(questionText, aiAnswer);
            if (!stored) {
                console.warn('Failed to store AI answer in RAG for question', question.id);
            }
        }
    } catch (error) {
        console.error('Failed to persist QA pair to RAG:', error);
    }
}

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
app.get('/', async (req, res) => {  // 增加 async 关键字
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    
    const query = `
        SELECT q.*, u.username, u.wallet_address, 
               (SELECT COUNT(*) FROM answers WHERE question_id = q.id) as answer_count
        FROM questions q 
        JOIN users u ON q.user_id = u.id 
        ORDER BY q.created_at DESC
    `;
    
    db.all(query, [], async (err, questions) => {  // 增加 async 关键字
        if (err) {
            console.error(err);
            return res.status(500).send('Database error');
        }
        
        if (req.session.userId) {
            // 从数据库查询用户的 wallet_address（不再查 tokens）
            db.get('SELECT wallet_address FROM users WHERE id = ?', [req.session.userId], async (err, user) => {
                // 调用区块链查询函数（传入钱包地址）
                const userTokens = user?.wallet_address ? await getTokenBalance(user.wallet_address) : 0;
                const walletAddress = user ? user.wallet_address : null;
                const homePage = generateHomePage(questions, req.session.userId, req.session.username, userTokens, walletAddress);
                res.send(homePage);
            });
        } else {
            const homePage = generateHomePage(questions, null, null, 0, null);
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

// Profile page
app.get('/profile', requireAuth, async (req, res) => {  // 增加 async 关键字
    // 从数据库查询 wallet_address（不再查 tokens）
    db.get('SELECT username, wallet_address, created_at FROM users WHERE id = ?', [req.session.userId], async (err, user) => {
        if (err || !user) {
            return res.status(404).send('User not found');
        }
        // 调用区块链查询余额
        const userTokens = user.wallet_address ? await getTokenBalance(user.wallet_address) : 0;
        res.send(generateProfilePage({
            ...user,
            tokens: userTokens  // 用区块链余额替换数据库 tokens
        }));
    });
});

// Ask question page
app.get('/ask', requireAuth, async (req, res) => {  // 增加 async 关键字
    // 从数据库查询 wallet_address（不再查 tokens）
    db.get('SELECT wallet_address FROM users WHERE id = ?', [req.session.userId], async (err, user) => {
        // 调用区块链查询余额
        const userTokens = user?.wallet_address ? await getTokenBalance(user.wallet_address) : 0;
        const walletAddress = user ? user.wallet_address : null;
        res.send(generateAskPage(req.session.username, userTokens, walletAddress));
    });
});

// Question detail page
app.get('/question/:id', async (req, res) => {  // 增加 async 关键字
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    
    const questionId = req.params.id;
    
    // 问题查询：只查 wallet_address，不查 tokens
    const questionQuery = `
        SELECT q.*, u.username, u.wallet_address
        FROM questions q 
        JOIN users u ON q.user_id = u.id 
        WHERE q.id = ?
    `;
    
    db.get(questionQuery, [questionId], async (err, question) => {  // 增加 async
        if (err || !question) {
            return res.status(404).send('Question not found');
        }
        
        // 答案查询：只查 username，不查 tokens
        const answersQuery = `
            SELECT a.*, u.username
            FROM answers a 
            JOIN users u ON a.user_id = u.id 
            WHERE a.question_id = ? 
            ORDER BY a.influence_points DESC, a.created_at ASC
        `;
        
        db.all(answersQuery, [questionId], async (err, answers) => {  // 增加 async
            if (err) {
                console.error(err);
                return res.status(500).send('Database error');
            }

            let aiAnswer = question.ai_answer || null;
            if (!aiAnswer) {
                try {
                    const ragPromptParts = [question.title || '', question.content || ''].filter(Boolean);
                    const ragPrompt = ragPromptParts.join('\n\n').slice(0, 2000);
                    aiAnswer = await generateAIAnswer(ragPrompt);
                    if (aiAnswer) {
                        db.run(
                            'UPDATE questions SET ai_answer = ?, ai_answer_updated_at = ? WHERE id = ?',
                            [aiAnswer, new Date().toISOString(), questionId],
                            (updateErr) => {
                                if (updateErr) {
                                    console.error('Failed to persist AI answer:', updateErr);
                                }
                            }
                        );
                        question.ai_answer = aiAnswer;
                    }
                } catch (ragError) {
                    console.error('Failed to generate AI answer:', ragError);
                }
            }

            if (req.session.userId) {
                // 从数据库查询当前用户的 wallet_address
                db.get('SELECT wallet_address FROM users WHERE id = ?', [req.session.userId], async (err, user) => {
                    // 调用区块链查询余额
                    const userTokens = user?.wallet_address ? await getTokenBalance(user.wallet_address) : 0;
                    const walletAddress = user ? user.wallet_address : null;
                    const questionPage = generateQuestionPage(question, answers, req.session.userId, req.session.username, userTokens, walletAddress, aiAnswer);
                    res.send(questionPage);
                });
            } else {
                const questionPage = generateQuestionPage(question, answers, null, null, 0, null, aiAnswer);
                res.send(questionPage);
            }
        });
    });
});

// API Routes

// Register user
app.post('/api/register', async (req, res) => {
    const { username, password, walletAddress } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }
    
    if (!walletAddress) {
        return res.status(400).json({ error: 'Wallet address is required. Please connect your MetaMask wallet.' });
    }
    
    // Validate Ethereum address format
    const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    if (!ethAddressRegex.test(walletAddress)) {
        return res.status(400).json({ error: 'Invalid wallet address format' });
    }
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.run('INSERT INTO users (username, password_hash, wallet_address) VALUES (?, ?, ?)',
            [username, hashedPassword, walletAddress.toLowerCase()], async function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        if (err.message.includes('username')) {
                            return res.status(400).json({ error: 'Username already exists' });
                        } else if (err.message.includes('wallet_address')) {
                            return res.status(400).json({ error: 'This wallet address is already registered' });
                        }
                    }
                    return res.status(500).json({ error: 'Registration failed' });
                }
                
                const userId = this.lastID;
                req.session.userId = userId;
                req.session.username = username;
                req.session.walletAddress = walletAddress.toLowerCase();
                
                // Mint 20 tokens to the new user's wallet
                try {
                    const txHash = await mintTokensToUser(walletAddress.toLowerCase(), 20);
                    console.log(`Successfully minted 20 tokens to new user ${username} (${walletAddress.toLowerCase()}). TX: ${txHash}`);
                    
                    res.json({ 
                        success: true, 
                        message: 'Registration successful! 20 tokens have been minted to your wallet.',
                        walletAddress: walletAddress.toLowerCase(),
                        mintTxHash: txHash
                    });
                } catch (mintError) {
                    console.error('Token minting failed for new user:', mintError);
                    // Registration was successful, but minting failed
                    res.json({ 
                        success: true, 
                        message: 'Registration successful! However, token minting failed. Please contact support.',
                        walletAddress: walletAddress.toLowerCase(),
                        mintError: 'Token minting failed'
                    });
                }
            });
    } catch (error) {
        console.error('Registration error:', error);
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
                req.session.walletAddress = user.wallet_address;
                res.json({ 
                    success: true, 
                    message: 'Login successful',
                    hasWallet: !!user.wallet_address
                });
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

// Get user wallet info
app.get('/api/user/wallet', requireAuth, (req, res) => {
    db.get('SELECT wallet_address FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({ 
            success: true, 
            walletAddress: user.wallet_address,
            hasWallet: !!user.wallet_address
        });
    });
});

// Update user wallet address
app.post('/api/user/wallet', requireAuth, (req, res) => {
    const { walletAddress } = req.body;
    
    if (!walletAddress) {
        return res.status(400).json({ error: 'Wallet address is required' });
    }
    
    // Validate Ethereum address format
    const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    if (!ethAddressRegex.test(walletAddress)) {
        return res.status(400).json({ error: 'Invalid wallet address format' });
    }
    
    db.run('UPDATE users SET wallet_address = ? WHERE id = ?', 
        [walletAddress.toLowerCase(), req.session.userId], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: 'This wallet address is already registered to another user' });
                }
                return res.status(500).json({ error: 'Failed to update wallet address' });
            }
            
            req.session.walletAddress = walletAddress.toLowerCase();
            res.json({ 
                success: true, 
                message: 'Wallet address updated successfully',
                walletAddress: walletAddress.toLowerCase()
            });
        });
});

// Ask a question
app.post('/api/questions', requireAuth, async (req, res) => {
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
    
    // Get user's wallet address and check blockchain token balance
    db.get('SELECT wallet_address FROM users WHERE id = ?', [req.session.userId], async (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!user || !user.wallet_address) {
            return res.status(400).json({ error: 'Wallet address not found. Please connect your wallet.' });
        }
        
        try {
            // Check blockchain token balance
            const userTokens = await getTokenBalance(user.wallet_address);
            
            if (userTokens < tokenReward) {
                return res.status(400).json({ error: `Not enough tokens. You have ${userTokens} tokens but need ${tokenReward} tokens to post this question.` });
            }
            
            // Calculate deadline
            const deadline = new Date();
            deadline.setMinutes(deadline.getMinutes() + timeLimit);
            
            // Post question (token transfer will happen when question expires and reward is distributed)
            db.run(`INSERT INTO questions (title, content, user_id, token_reward, time_limit_minutes, deadline) 
                    VALUES (?, ?, ?, ?, ?, ?)`,
                [title, content, req.session.userId, tokenReward, timeLimit, deadline.toISOString()], function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Failed to post question' });
                    }
                    
                    res.json({ 
                        success: true, 
                        questionId: this.lastID,
                        message: `Question posted with ${tokenReward} token reward! Time limit: ${timeLimit} minutes. Tokens will be transferred when the question expires.`
                    });
                });
        } catch (error) {
            console.error('Error checking token balance:', error);
            return res.status(500).json({ error: 'Failed to check token balance' });
        }
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
app.post('/api/endorse/question', requireAuth, async (req, res) => {
    const { questionId } = req.body;
    
    if (!questionId) {
        return res.status(400).json({ error: 'Question ID is required' });
    }
    
    try {
        // Get user's wallet address
        const user = await new Promise((resolve, reject) => {
            db.get('SELECT wallet_address FROM users WHERE id = ?', [req.session.userId], (err, user) => {
                if (err) reject(err);
                else resolve(user);
            });
        });
        
        if (!user || !user.wallet_address) {
            return res.status(404).json({ error: 'User not found or wallet not connected' });
        }
        
        // Get user's blockchain token balance for weighted voting
        const userTokens = await getTokenBalance(user.wallet_address);
        
        // Check if user already endorsed this question
        const existingEndorsement = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM endorsements WHERE user_id = ? AND target_type = ? AND target_id = ?', 
                [req.session.userId, 'question', questionId], (err, endorsement) => {
                    if (err) reject(err);
                    else resolve(endorsement);
                });
        });
        
        if (existingEndorsement) {
            return res.status(400).json({ error: 'You have already endorsed this question' });
        }
        
        // Calculate influence value based on user's token balance
        const influenceValue = Math.round((userTokens / 10) * 10) / 10; // Round to 1 decimal place
        
        // Add endorsement (no token cost)
        await new Promise((resolve, reject) => {
            db.run('INSERT INTO endorsements (user_id, target_type, target_id, influence_value) VALUES (?, ?, ?, ?)',
                [req.session.userId, 'question', questionId, influenceValue], function(err) {
                    if (err) reject(err);
                    else resolve();
                });
        });
        
        // Update question influence points
        await new Promise((resolve, reject) => {
            db.run('UPDATE questions SET influence_points = influence_points + ? WHERE id = ?',
                [influenceValue, questionId], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
        });
        
        res.json({ 
            success: true, 
            message: 'Endorsement recorded successfully!'
        });
        
    } catch (error) {
        console.error('Error endorsing question:', error);
        return res.status(500).json({ error: 'Failed to endorse question' });
    }
});

// Endorse an answer
app.post('/api/endorse/answer', requireAuth, async (req, res) => {
    const { answerId } = req.body;
    
    if (!answerId) {
        return res.status(400).json({ error: 'Answer ID is required' });
    }
    
    try {
        // Check if user is trying to endorse their own answer
        const answer = await new Promise((resolve, reject) => {
            db.get('SELECT user_id FROM answers WHERE id = ?', [answerId], (err, answer) => {
                if (err) reject(err);
                else resolve(answer);
            });
        });
        
        if (!answer) {
            return res.status(404).json({ error: 'Answer not found' });
        }
        
        if (answer.user_id === req.session.userId) {
            return res.status(400).json({ error: 'You cannot endorse your own answer' });
        }
        
        // Get user's wallet address
        const user = await new Promise((resolve, reject) => {
            db.get('SELECT wallet_address FROM users WHERE id = ?', [req.session.userId], (err, user) => {
                if (err) reject(err);
                else resolve(user);
            });
        });
        
        if (!user || !user.wallet_address) {
            return res.status(404).json({ error: 'User not found or wallet not connected' });
        }
        
        // Get user's blockchain token balance for weighted voting
        const userTokens = await getTokenBalance(user.wallet_address);
        
        // Check if user already endorsed this answer
        const existingEndorsement = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM endorsements WHERE user_id = ? AND target_type = ? AND target_id = ?', 
                [req.session.userId, 'answer', answerId], (err, endorsement) => {
                    if (err) reject(err);
                    else resolve(endorsement);
                });
        });
        
        if (existingEndorsement) {
            return res.status(400).json({ error: 'You have already endorsed this answer' });
        }
        
        // Calculate influence value based on user's token balance
        const influenceValue = Math.round((userTokens / 10) * 10) / 10; // Round to 1 decimal place
        
        // Add endorsement (no token cost)
        await new Promise((resolve, reject) => {
            db.run('INSERT INTO endorsements (user_id, target_type, target_id, influence_value) VALUES (?, ?, ?, ?)',
                [req.session.userId, 'answer', answerId, influenceValue], function(err) {
                    if (err) reject(err);
                    else resolve();
                });
        });
        
        // Update answer influence points
        await new Promise((resolve, reject) => {
            db.run('UPDATE answers SET influence_points = influence_points + ? WHERE id = ?',
                [influenceValue, answerId], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
        });
        
        res.json({ 
            success: true, 
            message: 'Endorsement recorded successfully!'
        });
        
    } catch (error) {
        console.error('Error endorsing answer:', error);
        return res.status(500).json({ error: 'Failed to endorse answer' });
    }
});

// HTML Template Functions
function generateBasePage(title, content, username = null, userTokens = 0, walletAddress = null) {
    const walletInfo = walletAddress ? 
        `<div class="nav-wallet-info">
            <span>🦊</span>
            <span class="nav-wallet-address">${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)}</span>
         </div>` : '';
    
    const authSection = username ? 
        `<div style="display: flex; align-items: center; gap: 1rem;">
            <span class="user-info">Welcome, ${username} | Tokens: ${userTokens}</span>
            ${walletInfo}
            <a href="/profile" class="btn btn-secondary">Profile</a>
            <button onclick="logout()" class="btn btn-secondary">Logout</button>
         </div>` :
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

function generateHomePage(questions, userId, username, userTokens = 0, walletAddress = null) {
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

    return generateBasePage('Home', content, username, userTokens, walletAddress);
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
            <div class="wallet-section">
                <h3>🦊 Connect MetaMask Wallet</h3>
                <p>Connect your MetaMask wallet to enable token transfers and rewards.</p>
                <button type="button" id="connectWalletBtn" class="btn btn-secondary">Connect MetaMask</button>
                <div id="walletInfo" class="wallet-info" style="display: none;">
                    <p>✅ Wallet Connected</p>
                    <p id="walletAddress"></p>
                </div>
                <div id="walletError" class="wallet-error" style="display: none; color: red;"></div>
            </div>
            <form id="registerForm" class="auth-form">
                <div class="form-group">
                    <label for="username">Username:</label>
                    <input type="text" id="username" name="username" required>
                </div>
                <div class="form-group">
                    <label for="password">Password:</label>
                    <input type="password" id="password" name="password" required>
                </div>
                <input type="hidden" id="walletAddressInput" name="walletAddress">
                <button type="submit" class="btn btn-primary" id="registerBtn" disabled>Register</button>
                <p class="register-note">⚠️ Please connect your MetaMask wallet before registering.</p>
            </form>
            <p>Already have an account? <a href="/login">Login here</a></p>
        </div>
    `;

    return generateBasePage('Register', content);
}

function generateAskPage(username, userTokens = 0, walletAddress = null) {
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

    return generateBasePage('Ask Question', content, username, userTokens, walletAddress);
}

function generateQuestionPage(question, answers, userId, username, userTokens = 0, walletAddress = null, aiAnswer = null) {
    const now = new Date();
    const deadline = new Date(question.deadline);
    const isExpired = deadline <= now;
    const timeLeft = isExpired ? 0 : Math.max(0, Math.ceil((deadline - now) / 60000)); // minutes left

    const aiAnswerHtml = aiAnswer ? (() => {
        const aiAnswerContent = renderBasicMarkdown(aiAnswer);
        const isLong = aiAnswer.length > 600;
        const collapseClass = isLong ? ' collapsed' : '';
        const toggleButton = isLong ? '<button class="ai-toggle" data-target="ai-answer-body">Expand Oracle Insight</button>' : '';
        return `
        <div class="ai-answer-card${collapseClass}">
            <div class="ai-answer-header">
                <span class="ai-avatar">🤖</span>
                <div>
                    <h3>JoeyPouch Oracle</h3>
                    <p class="ai-subtitle">Autonomous insight crafted by our RAG system</p>
                </div>
                ${toggleButton}
            </div>
            <div class="ai-answer-body" id="ai-answer-body">
                <p>${aiAnswerContent}</p>
            </div>
        </div>
        `;
    })() : '';

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
            ${aiAnswerHtml}
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

    return generateBasePage(question.title, content, username, userTokens, walletAddress);
}

function generateProfilePage(user) {
    const content = `
        <div class="profile-container">
            <h2>👤 User Profile</h2>
            <div class="profile-card">
                <div class="profile-info">
                    <h3>Account Information</h3>
                    <div class="info-row">
                        <span class="label">Username:</span>
                        <span class="value">${user.username}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">Tokens:</span>
                        <span class="value token-amount">💰 ${user.tokens}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">Member since:</span>
                        <span class="value">${new Date(user.created_at).toLocaleDateString()}</span>
                    </div>
                </div>
                
                <div class="wallet-management">
                    <h3>🦊 Wallet Management</h3>
                    ${user.wallet_address ? `
                        <div class="current-wallet">
                            <div class="wallet-connected">
                                <div class="connection-status">
                                    <div class="status-indicator"></div>
                                    <span>Wallet Connected</span>
                                </div>
                                <div class="wallet-address">${user.wallet_address}</div>
                                <button type="button" id="updateWalletBtn" class="btn btn-secondary">Update Wallet</button>
                            </div>
                        </div>
                    ` : `
                        <div class="no-wallet">
                            <p>⚠️ No wallet connected. Connect your MetaMask wallet to enable token transfers.</p>
                            <button type="button" id="connectWalletBtn" class="btn btn-primary">Connect MetaMask</button>
                        </div>
                    `}
                    
                    <div id="walletUpdateForm" class="wallet-update-form" style="display: none;">
                        <h4>Connect New Wallet</h4>
                        <p>Click the button below to connect a different MetaMask wallet.</p>
                        <button type="button" id="connectNewWalletBtn" class="btn btn-primary">Connect New Wallet</button>
                        <button type="button" id="cancelUpdateBtn" class="btn btn-secondary">Cancel</button>
                    </div>
                    
                    <div id="walletInfo" class="wallet-info" style="display: none;">
                        <p>✅ New Wallet Connected</p>
                        <p id="newWalletAddress"></p>
                        <button type="button" id="confirmUpdateBtn" class="btn btn-primary">Confirm Update</button>
                        <button type="button" id="cancelConfirmBtn" class="btn btn-secondary">Cancel</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    return generateBasePage('Profile', content, user.username, user.tokens, user.wallet_address);
}

// Function to check and distribute rewards for expired questions
function checkExpiredQuestions() {
    const now = new Date().toISOString();
    
    db.all(`
        SELECT id, token_reward, user_id, title, content, ai_answer 
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
                SELECT a.id, a.user_id, a.influence_points, a.content, u.username
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
                                persistQuestionToRag(question, winningAnswer).catch((ragError) => {
                                    console.error('Failed to persist winning answer to RAG:', ragError);
                                });
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
                            persistQuestionToRag(question, null).catch((ragError) => {
                                console.error('Failed to persist AI answer to RAG:', ragError);
                            });
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
