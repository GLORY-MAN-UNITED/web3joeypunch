# Joey Pouch - Q&A Website# Joey Pouch - Q&A Website



A simple question and answer website with a token reward system and weighted voting.A simple question and answer website with a token reward system and weighted voting.



## Features## Features



- **User Registration & Login** - Create accounts and manage sessions- **User Registration & Login** - Create accounts and manage sessions

- **Ask Questions** - Post questions with token rewards (1-10 tokens) and time limits (1-10 minutes)- **Ask Questions** - Post questions with token rewards (1-10 tokens) and time limits (1-10 minutes)

- **Answer Questions** - Provide answers to earn token rewards- **Answer Questions** - Provide answers to earn token rewards

- **Weighted Endorsement System** - Free endorsements weighted by your token balance (influence = tokens ÷ 10)- **Weighted Endorsement System** - Free endorsements weighted by your token balance (influence = tokens ÷ 10)

- **Token Economy** - Start with 20 tokens, earn more by providing winning answers- **Token Economy** - Start with 20 tokens, earn more by providing winning answers



## Quick Start## Quick Start



1. **Install and Run**:1. **Install and Run**:

   ```bash   ```bash

   npm install   npm install

   npm start   npm start

   ```   ```



2. **Open Browser**: Go to `http://localhost:3000`2. **Open Browser**: Go to `http://localhost:3000`



3. **Register** → **Ask Questions** → **Answer & Endorse**3. **Register** → **Ask Questions** → **Answer & Endorse**



## How It Works## How It Works



### Token Reward System### Token Reward System

- Ask questions with 1-10 token rewards and 1-10 minute time limits- Ask questions with 1-10 token rewards and 1-10 minute time limits

- When time expires, all reward tokens go to the answer with highest influence points- When time expires, all reward tokens go to the answer with highest influence points

- Answering winning questions earns you tokens- Answering winning questions earns you tokens



### Weighted Voting### Weighted Voting

- Endorsements are **free** but weighted by your token balance- Endorsements are **free** but weighted by your token balance

- Your influence per endorsement = your tokens ÷ 10- Your influence per endorsement = your tokens ÷ 10

- Example: 18 tokens = 1.8 influence points per endorsement- Example: 18 tokens = 1.8 influence points per endorsement



### Files### Files

- `server.js` - Main application- `server.js` - Main application

- `database.js` - SQLite database setup  - `database.js` - SQLite database setup  

- `public/` - HTML, CSS, JavaScript- `public/` - HTML, CSS, JavaScript

- `check-db.js` - Database inspection tool- `check-db.js` - Database inspection tool



That's it! Simple Q&A with gamification. 🎉That's it! Simple Q&A with gamification. 🎉

## Usage Guide

1. **Register an Account**:
   - Go to `/register`
   - Enter username and password
   - Click "Register"

2. **Login**:
   - Go to `/login`
   - Enter your credentials
   - Click "Login"

3. **Ask a Question**:
   - After logging in, click "Ask Question" or go to `/ask`
   - Enter a descriptive title (minimum 10 characters)
   - Provide detailed content (minimum 20 characters)
   - Click "Post Question"

4. **Answer a Question**:
   - Click on any question to view details
   - Scroll down to the "Your Answer" section (visible only when logged in)
   - Write your answer (minimum 20 characters)
   - Click "Post Answer"

5. **Endorse Content**:
   - Click on any question to view details
   - Click "Endorse" button next to questions or answers you find valuable
   - Each endorsement costs 1 token
   - You cannot endorse your own content
   - You can only endorse each item once

6. **Browse Questions**:
   - The home page shows all questions with:
     - Influence Points count
     - Answer count
     - Question title and excerpt
     - Author and date information

## Token System

- **Starting Tokens**: Each new user receives 20 tokens
- **Token Costs**:
  - Posting a question: 1 token
  - Endorsing a question: 1 token  
  - Endorsing an answer: 1 token
- **Current Token Count**: Displayed in the top navigation when logged in

## Security Features

- Password hashing using bcryptjs
- Session-based authentication
- SQL injection protection through parameterized queries
- Input validation on both client and server side
- CSRF protection through session management

## Customization

### Database
- The SQLite database file `qa_database.sqlite`
- Use any SQLite browser to view/edit the database directly

### Server Configuration
- Change the port in `server.js` (default: 3000)
- Update session secret in production
- Modify database path if needed

## Development

For development, you can use:
```bash
npm run dev
```

This uses nodemon to automatically restart the server when files change.

## Troubleshooting

**Database Issues**:
- Delete `qa_database.sqlite` and restart the server to reset the database

**Port Conflicts**:
- Change the PORT in `server.js` or set environment variable: `PORT=4000 npm start`

**Permission Issues**:
- Ensure the application has write permissions in the directory for SQLite

## License

MIT License - Feel free to use and modify as needed.
