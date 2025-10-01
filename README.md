# Web3 Q&A Platform

A blockchain-powered Q&A website where users stake tokens on questions and winners get rewarded.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables in `.env`:
```
PRIVATE_KEY="your_wallet_private_key"
SEPOLIA_RPC_URL="your_sepolia_rpc_url"
VOTE_TOKEN_ADDRESS="your_token_contract_address"
```

3. Start the server:
```bash
node server.js
```

4. Open http://localhost:3000

## How It Works

- **Post Questions**: Users authorize token transfer to escrow, then post questions
- **Answer Questions**: Anyone can answer and get endorsed by others  
- **Win Rewards**: Highest-endorsed answer gets all escrowed tokens when time expires

## Key Features

- MetaMask integration for token transfers
- Automatic reward distribution via blockchain
- Winner-takes-all reward system
- Real-time balance checking

## Files

- `server.js` - Main web server
- `serverReward.js` - Blockchain reward transfers
- `public/tokenAuth.js` - MetaMask integration
- `database.js` - SQLite database setup
- `balance.js` - Token balance queries
- `transfer.js` - Manual token transfers
- `mint.js` - Token minting for new users