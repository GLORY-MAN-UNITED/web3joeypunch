// Web3 integration for token transfers
// Token contract configuration
const TOKEN_CONFIG = {
    ADDRESS: '0x6F373aC322c54f428c9eDdCd7E8a6b49f90f194a',
    SERVER_ADDRESS: '0x20B8d89a98D48652e3216DE302490acD3e3466B8',
    ABI: [
        "function transfer(address to, uint256 amount) returns (bool)",
        "function balanceOf(address owner) view returns (uint256)",
        "function decimals() view returns (uint8)",
        "function symbol() view returns (string)",
        "function allowance(address owner, address spender) view returns (uint256)",
        "function approve(address spender, uint256 amount) returns (bool)"
    ]
};

// ERC20 Token transfer functions using MetaMask
class TokenTransfer {
    constructor() {
        this.provider = null;
        this.signer = null;
        this.contract = null;
        this.init();
    }

    async init() {
        if (typeof window.ethereum !== 'undefined') {
            this.provider = new ethers.BrowserProvider(window.ethereum);
        }
    }

    async connect() {
        if (!window.ethereum) {
            throw new Error('MetaMask is not installed');
        }

        try {
            await window.ethereum.request({ method: 'eth_requestAccounts' });
            this.provider = new ethers.BrowserProvider(window.ethereum);
            
            // Check if connected to Sepolia testnet
            const network = await this.provider.getNetwork();
            if (network.chainId !== 11155111n) { // Sepolia chain ID
                try {
                    await window.ethereum.request({
                        method: 'wallet_switchEthereumChain',
                        params: [{ chainId: '0xaa36a7' }], // Sepolia chain ID in hex
                    });
                } catch (switchError) {
                    throw new Error('Please switch to Sepolia testnet in MetaMask');
                }
            }
            
            this.signer = await this.provider.getSigner();
            this.contract = new ethers.Contract(TOKEN_CONFIG.ADDRESS, TOKEN_CONFIG.ABI, this.signer);
            
            // Test contract connection
            try {
                await this.contract.symbol();
            } catch (contractError) {
                throw new Error('Cannot connect to token contract. Please make sure you are on Sepolia testnet.');
            }
            
            return await this.signer.getAddress();
        } catch (error) {
            throw new Error('Failed to connect to MetaMask: ' + error.message);
        }
    }

    async getBalance(address) {
        if (!this.contract) {
            await this.connect();
        }

        try {
            const balance = await this.contract.balanceOf(address);
            const decimals = await this.contract.decimals();
            return ethers.formatUnits(balance, decimals);
        } catch (error) {
            if (error.code === 'BAD_DATA') {
                throw new Error('Cannot read token balance. Please make sure you are connected to Sepolia testnet.');
            }
            throw new Error('Failed to get balance: ' + error.message);
        }
    }

    async transferToServer(amount) {
        if (!this.contract || !this.signer) {
            await this.connect();
        }

        try {
            // Check network again before transfer
            const network = await this.provider.getNetwork();
            if (network.chainId !== 11155111n) {
                throw new Error('Wrong network. Please switch to Sepolia testnet.');
            }
            
            const decimals = await this.contract.decimals();
            const transferAmount = ethers.parseUnits(amount.toString(), decimals);
            
            // Check balance first
            const userAddress = await this.signer.getAddress();
            const balance = await this.contract.balanceOf(userAddress);
            
            if (balance < transferAmount) {
                throw new Error(`Insufficient balance. Need ${amount} tokens, but only have ${ethers.formatUnits(balance, decimals)} tokens`);
            }

            // Execute transfer
            const tx = await this.contract.transfer(TOKEN_CONFIG.SERVER_ADDRESS, transferAmount);
            
            return {
                hash: tx.hash,
                from: userAddress,
                to: TOKEN_CONFIG.SERVER_ADDRESS,
                amount: amount,
                transaction: tx
            };
        } catch (error) {
            if (error.code === 4001) {
                throw new Error('Transaction rejected by user');
            }
            if (error.code === 'CALL_EXCEPTION') {
                throw new Error('Contract call failed. Please check if you are on Sepolia testnet and have VOTE tokens.');
            }
            if (error.code === 'BAD_DATA') {
                throw new Error('Cannot read from contract. Please make sure you are connected to Sepolia testnet.');
            }
            throw new Error('Transfer failed: ' + error.message);
        }
    }

    async waitForTransaction(txHash) {
        if (!this.provider) {
            await this.connect();
        }

        try {
            const receipt = await this.provider.waitForTransaction(txHash);
            return receipt;
        } catch (error) {
            throw new Error('Transaction confirmation failed: ' + error.message);
        }
    }
}

// Create global instance
const tokenTransfer = new TokenTransfer();

// Token authorization modal
function createTokenAuthModal(tokenAmount, onApprove, onCancel) {
    const modal = document.createElement('div');
    modal.className = 'token-auth-modal';
    modal.innerHTML = `
        <div class="modal-overlay">
            <div class="modal-content">
                <h3>🏆 Authorize Token Transfer</h3>
                <div class="auth-details">
                    <div class="reward-summary">
                        <div class="reward-icon">🎯</div>
                        <div class="reward-text">
                            <strong>${tokenAmount} VOTE Token Reward</strong>
                            <p>Tokens will be held in escrow and awarded to the best answer</p>
                        </div>
                    </div>
                    
                    <div class="transfer-info">
                        <h4>🔒 Escrow Transfer Required</h4>
                        <p>Your tokens will be safely held until the question expires</p>
                        <div class="escrow-address">
                            <small>Escrow Address:</small>
                            <code>${TOKEN_CONFIG.SERVER_ADDRESS.substring(0, 10)}...${TOKEN_CONFIG.SERVER_ADDRESS.substring(TOKEN_CONFIG.SERVER_ADDRESS.length - 8)}</code>
                        </div>
                    </div>
                    
                    <div class="warning">
                        💡 <strong>Winner takes all:</strong> Only the highest-endorsed answer will receive all ${tokenAmount} tokens when time expires.
                    </div>
                </div>
                <div class="modal-actions">
                    <button id="authorizeBtn" class="btn-primary">
                        <span class="btn-icon">🚀</span>
                        Authorize & Post Question
                    </button>
                    <button id="cancelAuthBtn" class="btn-secondary">Cancel</button>
                </div>
                <div id="authStatus" class="auth-status"></div>
            </div>
        </div>
    `;

    // Add styles
    const style = document.createElement('style');
    style.textContent = `
        .token-auth-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 1000;
        }
        
        .modal-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.7);
            display: flex;
            justify-content: center;
            align-items: center;
        }
        
        .modal-content {
            background: white;
            border-radius: 12px;
            padding: 2rem;
            max-width: 480px;
            width: 90%;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
            border: 1px solid #e1e8ed;
        }
        
        .modal-content h3 {
            margin: 0 0 1.5rem 0;
            color: #1da1f2;
            text-align: center;
            font-size: 1.4rem;
            font-weight: 600;
        }
        
        .reward-summary {
            display: flex;
            align-items: center;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 1.25rem;
            border-radius: 10px;
            margin-bottom: 1.5rem;
        }
        
        .reward-icon {
            font-size: 2rem;
            margin-right: 1rem;
        }
        
        .reward-text strong {
            font-size: 1.1rem;
            display: block;
            margin-bottom: 0.25rem;
        }
        
        .reward-text p {
            margin: 0;
            opacity: 0.9;
            font-size: 0.9rem;
        }
        
        .transfer-info {
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 8px;
            padding: 1.25rem;
            margin-bottom: 1.5rem;
        }
        
        .transfer-info h4 {
            margin: 0 0 0.75rem 0;
            color: #495057;
            font-size: 1rem;
        }
        
        .transfer-info p {
            margin: 0 0 1rem 0;
            color: #6c757d;
            line-height: 1.5;
        }
        
        .escrow-address {
            background: white;
            padding: 0.75rem;
            border-radius: 6px;
            border: 1px solid #dee2e6;
        }
        
        .escrow-address small {
            display: block;
            color: #6c757d;
            margin-bottom: 0.25rem;
            font-size: 0.8rem;
        }
        
        .escrow-address code {
            font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace;
            font-size: 0.9rem;
            color: #495057;
            background: none;
            padding: 0;
        }
        
        .warning {
            background: linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%);
            border: 1px solid #f8d7da;
            border-radius: 8px;
            padding: 1rem;
            margin: 1rem 0;
            color: #721c24;
            text-align: center;
        }
        
        .modal-actions {
            display: flex;
            gap: 1rem;
            margin-top: 2rem;
        }
        
        .btn-primary, .btn-secondary {
            flex: 1;
            padding: 0.875rem 1.5rem;
            border: none;
            border-radius: 8px;
            font-size: 1rem;
            font-weight: 500;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            transition: all 0.3s ease;
            text-transform: none;
        }
        
        .btn-primary {
            background: linear-gradient(135deg, #1da1f2 0%, #1a91da 100%);
            color: white;
            box-shadow: 0 4px 12px rgba(29, 161, 242, 0.3);
        }
        
        .btn-primary:hover {
            background: linear-gradient(135deg, #1a91da 0%, #1781c2 100%);
            box-shadow: 0 6px 16px rgba(29, 161, 242, 0.4);
            transform: translateY(-1px);
        }
        
        .btn-primary:disabled {
            background: #adb5bd;
            box-shadow: none;
            cursor: not-allowed;
            transform: none;
        }
        
        .btn-secondary {
            background: #f8f9fa;
            color: #495057;
            border: 1px solid #dee2e6;
        }
        
        .btn-secondary:hover {
            background: #e9ecef;
            border-color: #adb5bd;
        }
        
        .auth-status {
            margin-top: 1rem;
            padding: 1rem;
            border-radius: 8px;
            display: none;
            font-weight: 500;
            text-align: center;
        }
        
        .auth-status.success {
            background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%);
            border: 1px solid #28a745;
            color: #155724;
            display: block;
        }
        
        .auth-status.error {
            background: linear-gradient(135deg, #f8d7da 0%, #f5c6cb 100%);
            border: 1px solid #dc3545;
            color: #721c24;
            display: block;
        }
        
        .auth-status.loading {
            background: linear-gradient(135deg, #d1ecf1 0%, #bee5eb 100%);
            border: 1px solid #17a2b8;
            color: #0c5460;
            display: block;
        }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(modal);

    // Event handlers
    const authorizeBtn = modal.querySelector('#authorizeBtn');
    const cancelBtn = modal.querySelector('#cancelAuthBtn');
    const authStatus = modal.querySelector('#authStatus');

    function showStatus(message, type) {
        authStatus.className = `auth-status ${type}`;
        authStatus.textContent = message;
    }
    
    function showNetworkError() {
        authStatus.className = 'auth-status error';
        authStatus.innerHTML = `
            <div>❌ Wrong Network</div>
            <div style="margin-top: 0.5rem; font-size: 0.9rem;">
                Please switch to <strong>Sepolia Testnet</strong> in MetaMask:
                <br>1. Open MetaMask
                <br>2. Click network dropdown
                <br>3. Select "Sepolia test network"
            </div>
        `;
    }

    authorizeBtn.addEventListener('click', async () => {
        authorizeBtn.disabled = true;
        authorizeBtn.innerHTML = '<span>🔄</span> Processing...';
        showStatus('Connecting to MetaMask...', 'loading');

        try {
            // Connect and transfer
            await tokenTransfer.connect();
            showStatus('Please approve the transaction in MetaMask...', 'loading');
            
            const result = await tokenTransfer.transferToServer(tokenAmount);
            showStatus('Transaction sent! Waiting for confirmation...', 'loading');
            
            const receipt = await tokenTransfer.waitForTransaction(result.hash);
            showStatus('✅ Transfer confirmed! Posting your question...', 'success');
            
            // Wait a moment then proceed
            setTimeout(() => {
                modal.remove();
                onApprove(result);
            }, 1500);
            
        } catch (error) {
            console.error('Token authorization failed:', error);
            
            if (error.message.includes('Sepolia') || error.message.includes('network') || error.message.includes('BAD_DATA')) {
                showNetworkError();
            } else {
                showStatus('❌ ' + error.message, 'error');
            }
            
            authorizeBtn.disabled = false;
            authorizeBtn.innerHTML = '<span class="btn-icon">🚀</span> Authorize & Post Question';
        }
    });

    cancelBtn.addEventListener('click', () => {
        modal.remove();
        onCancel();
    });

    // Close on overlay click
    modal.querySelector('.modal-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
            modal.remove();
            onCancel();
        }
    });

    return modal;
}

// Export for use in other scripts
window.tokenTransfer = tokenTransfer;
window.createTokenAuthModal = createTokenAuthModal;
window.TOKEN_CONFIG = TOKEN_CONFIG;