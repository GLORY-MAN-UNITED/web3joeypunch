// Client-side JavaScript for Q&A website

// Utility function to show messages
function showMessage(message, type = 'error') {
    // Remove existing messages
    const existingMessages = document.querySelectorAll('.message');
    existingMessages.forEach(msg => msg.remove());
    
    // Create new message element
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.textContent = message;
    
    // Insert at the top of the main content
    const main = document.querySelector('main');
    if (main) {
        main.insertBefore(messageDiv, main.firstChild);
        
        // Auto-remove success messages after 3 seconds
        if (type === 'success') {
            setTimeout(() => {
                messageDiv.remove();
            }, 3000);
        }
    }
}

// MetaMask connection functions
let currentAccount = null;

// Check if MetaMask is installed
function isMetaMaskInstalled() {
    return typeof window.ethereum !== 'undefined';
}

// Connect to MetaMask
async function connectMetaMask() {
    if (!isMetaMaskInstalled()) {
        showMessage('MetaMask is not installed. Please install MetaMask extension first.');
        return null;
    }

    try {
        // Request account access
        const accounts = await window.ethereum.request({
            method: 'eth_requestAccounts',
        });

        if (accounts.length > 0) {
            currentAccount = accounts[0];
            return currentAccount;
        } else {
            showMessage('No accounts found. Please make sure MetaMask is unlocked.');
            return null;
        }
    } catch (error) {
        console.error('Error connecting to MetaMask:', error);
        if (error.code === 4001) {
            showMessage('Please connect to MetaMask to continue.');
        } else {
            showMessage('Failed to connect to MetaMask. Please try again.');
        }
        return null;
    }
}

// Get current connected account
async function getCurrentAccount() {
    if (!isMetaMaskInstalled()) {
        return null;
    }

    try {
        const accounts = await window.ethereum.request({
            method: 'eth_accounts',
        });
        return accounts.length > 0 ? accounts[0] : null;
    } catch (error) {
        console.error('Error getting current account:', error);
        return null;
    }
}

// Format wallet address for display
function formatAddress(address) {
    if (!address) return '';
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
}

// Login form handler
document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const formData = new FormData(loginForm);
            const data = {
                username: formData.get('username'),
                password: formData.get('password')
            };
            
            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(data)
                });
                
                const result = await response.json();
                
                if (result.success) {
                    showMessage('Login successful! Redirecting...', 'success');
                    setTimeout(() => {
                        window.location.href = '/';
                    }, 1000);
                } else {
                    showMessage(result.error);
                }
            } catch (error) {
                showMessage('Login failed. Please try again.');
            }
        });
    }
    
    // Connect wallet button handler
    const connectWalletBtn = document.getElementById('connectWalletBtn');
    if (connectWalletBtn) {
        connectWalletBtn.addEventListener('click', async function() {
            const walletAddress = await connectMetaMask();
            if (walletAddress) {
                updateWalletUI(walletAddress);
                document.getElementById('walletAddressInput').value = walletAddress;
                document.getElementById('registerBtn').disabled = false;
                document.querySelector('.register-note').textContent = '✅ MetaMask connected! You can now register.';
                document.querySelector('.register-note').style.color = 'green';
            }
        });

        // Check if wallet is already connected
        getCurrentAccount().then(account => {
            if (account) {
                updateWalletUI(account);
                document.getElementById('walletAddressInput').value = account;
                document.getElementById('registerBtn').disabled = false;
                document.querySelector('.register-note').textContent = '✅ MetaMask connected! You can now register.';
                document.querySelector('.register-note').style.color = 'green';
            }
        });
    }

    // Register form handler
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const formData = new FormData(registerForm);
            const data = {
                username: formData.get('username'),
                password: formData.get('password'),
                walletAddress: formData.get('walletAddress')
            };
            
            // Basic validation
            if (data.password.length < 6) {
                showMessage('Password must be at least 6 characters long.');
                return;
            }

            if (!data.walletAddress) {
                showMessage('Please connect your MetaMask wallet first.');
                return;
            }
            
            try {
                const response = await fetch('/api/register', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(data)
                });
                
                const result = await response.json();
                
                if (result.success) {
                    let message = result.message;
                    if (result.mintTxHash) {
                        message = 'Registration successful! 20 tokens have been minted to your wallet. Redirecting...';
                    } else if (result.mintError) {
                        message = 'Registration successful! However, token minting failed. Please contact support. Redirecting...';
                    }
                    showMessage(message, 'success');
                    setTimeout(() => {
                        window.location.href = '/';
                    }, 2000);
                } else {
                    showMessage(result.error);
                }
            } catch (error) {
                showMessage('Registration failed. Please try again.');
            }
        });
    }

    // Update wallet UI
    function updateWalletUI(walletAddress) {
        const walletInfo = document.getElementById('walletInfo');
        const walletAddressElement = document.getElementById('walletAddress');
        const connectWalletBtn = document.getElementById('connectWalletBtn');
        const walletError = document.getElementById('walletError');

        if (walletInfo && walletAddressElement && connectWalletBtn) {
            walletInfo.style.display = 'block';
            walletAddressElement.textContent = `Address: ${formatAddress(walletAddress)}`;
            connectWalletBtn.style.display = 'none';
            walletError.style.display = 'none';
            currentAccount = walletAddress;
        }
    }

    // Profile page wallet management
    const updateWalletBtn = document.getElementById('updateWalletBtn');
    const walletUpdateForm = document.getElementById('walletUpdateForm');
    const connectNewWalletBtn = document.getElementById('connectNewWalletBtn');
    const cancelUpdateBtn = document.getElementById('cancelUpdateBtn');
    const confirmUpdateBtn = document.getElementById('confirmUpdateBtn');
    const cancelConfirmBtn = document.getElementById('cancelConfirmBtn');
    const newWalletAddressElement = document.getElementById('newWalletAddress');
    
    if (updateWalletBtn) {
        updateWalletBtn.addEventListener('click', function() {
            walletUpdateForm.style.display = 'block';
            updateWalletBtn.style.display = 'none';
        });
    }

    if (cancelUpdateBtn) {
        cancelUpdateBtn.addEventListener('click', function() {
            walletUpdateForm.style.display = 'none';
            updateWalletBtn.style.display = 'inline-block';
        });
    }

    if (connectNewWalletBtn) {
        connectNewWalletBtn.addEventListener('click', async function() {
            const walletAddress = await connectMetaMask();
            if (walletAddress) {
                const walletInfo = document.getElementById('walletInfo');
                if (newWalletAddressElement && walletInfo) {
                    newWalletAddressElement.textContent = `New Address: ${walletAddress}`;
                    walletInfo.style.display = 'block';
                    walletUpdateForm.style.display = 'none';
                    currentAccount = walletAddress;
                }
            }
        });
    }

    if (confirmUpdateBtn) {
        confirmUpdateBtn.addEventListener('click', async function() {
            if (!currentAccount) {
                showMessage('No wallet connected. Please try again.');
                return;
            }

            try {
                const response = await fetch('/api/user/wallet', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ walletAddress: currentAccount })
                });

                const result = await response.json();

                if (result.success) {
                    showMessage('Wallet updated successfully! Refreshing page...', 'success');
                    setTimeout(() => {
                        window.location.reload();
                    }, 1500);
                } else {
                    showMessage(result.error);
                }
            } catch (error) {
                showMessage('Failed to update wallet. Please try again.');
            }
        });
    }

    if (cancelConfirmBtn) {
        cancelConfirmBtn.addEventListener('click', function() {
            const walletInfo = document.getElementById('walletInfo');
            if (walletInfo) {
                walletInfo.style.display = 'none';
            }
            if (updateWalletBtn) {
                updateWalletBtn.style.display = 'inline-block';
            }
            currentAccount = null;
        });
    }

    // Profile page - connect wallet for users without wallet
    const profileConnectWalletBtn = document.getElementById('connectWalletBtn');
    if (profileConnectWalletBtn && !document.getElementById('registerForm')) {
        profileConnectWalletBtn.addEventListener('click', async function() {
            const walletAddress = await connectMetaMask();
            if (walletAddress) {
                try {
                    const response = await fetch('/api/user/wallet', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ walletAddress: walletAddress })
                    });

                    const result = await response.json();

                    if (result.success) {
                        showMessage('Wallet connected successfully! Refreshing page...', 'success');
                        setTimeout(() => {
                            window.location.reload();
                        }, 1500);
                    } else {
                        showMessage(result.error);
                    }
                } catch (error) {
                    showMessage('Failed to connect wallet. Please try again.');
                }
            }
        });
    }
    
    // Ask question form handler
    const askForm = document.getElementById('askForm');
    if (askForm) {
        // Dynamic token validation and button update
        const tokenRewardSelect = document.getElementById('token_reward');
        const postQuestionBtn = document.getElementById('postQuestionBtn');
        
        function updateButtonState() {
            const userTokensElement = document.querySelector('.nav-info .tokens');
            if (userTokensElement) {
                const userTokens = parseInt(userTokensElement.textContent.match(/\d+/)[0]);
                const requiredTokens = parseInt(tokenRewardSelect.value);
                
                if (userTokens < requiredTokens) {
                    postQuestionBtn.disabled = true;
                    postQuestionBtn.textContent = `Not Enough Tokens (Need ${requiredTokens})`;
                } else {
                    postQuestionBtn.disabled = false;
                    postQuestionBtn.textContent = `Post Question (${requiredTokens} tokens)`;
                }
            }
        }
        
        if (tokenRewardSelect && postQuestionBtn) {
            tokenRewardSelect.addEventListener('change', updateButtonState);
            updateButtonState(); // Initial state
        }
        
        askForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const formData = new FormData(askForm);
            const data = {
                title: formData.get('title'),
                content: formData.get('content'),
                token_reward: parseInt(formData.get('token_reward')),
                time_limit_minutes: parseInt(formData.get('time_limit_minutes'))
            };
            
            // Basic validation
            if (data.title.length < 10) {
                showMessage('Question title must be at least 10 characters long.');
                return;
            }
            
            if (data.content.length < 20) {
                showMessage('Question content must be at least 20 characters long.');
                return;
            }
            
            if (data.token_reward < 1 || data.token_reward > 10) {
                showMessage('Token reward must be between 1 and 10.');
                return;
            }
            
            if (data.time_limit_minutes < 1 || data.time_limit_minutes > 10) {
                showMessage('Time limit must be between 1 and 10 minutes.');
                return;
            }
            
            try {
                const response = await fetch('/api/questions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(data)
                });
                
                const result = await response.json();
                
                if (result.success) {
                    showMessage(result.message || 'Question posted successfully! Redirecting...', 'success');
                    setTimeout(() => {
                        window.location.href = `/question/${result.questionId}`;
                    }, 1000);
                } else {
                    showMessage(result.error);
                }
            } catch (error) {
                showMessage('Failed to post question. Please try again.');
            }
        });
    }
    
    // Answer form handler
    const answerForm = document.getElementById('answerForm');
    if (answerForm) {
        answerForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const formData = new FormData(answerForm);
            const data = {
                questionId: formData.get('questionId'),
                content: formData.get('content')
            };
            
            // Basic validation
            if (data.content.length < 20) {
                showMessage('Answer must be at least 20 characters long.');
                return;
            }
            
            try {
                const response = await fetch('/api/answers', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(data)
                });
                
                const result = await response.json();
                
                if (result.success) {
                    showMessage('Answer posted successfully! Refreshing page...', 'success');
                    setTimeout(() => {
                        window.location.reload();
                    }, 1000);
                } else {
                    showMessage(result.error);
                }
            } catch (error) {
                showMessage('Failed to post answer. Please try again.');
            }
        });
    }
});

// Logout function
async function logout() {
    try {
        const response = await fetch('/api/logout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            showMessage('Logged out successfully! Redirecting...', 'success');
            setTimeout(() => {
                window.location.href = '/';
            }, 1000);
        } else {
            showMessage('Logout failed. Please try again.');
        }
    } catch (error) {
        showMessage('Logout failed. Please try again.');
    }
}

// Vote for question function
async function endorseQuestion(questionId) {
    try {
        const response = await fetch('/api/endorse/question', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ questionId })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showMessage('Endorsement recorded successfully!', 'success');
            setTimeout(() => {
                // Add cache busting to ensure fresh data
                window.location.href = window.location.href + '?t=' + Date.now();
            }, 1500);
        } else {
            showMessage(result.error);
        }
    } catch (error) {
        showMessage('Failed to endorse. Please try again.');
    }
}

// Vote for answer function
async function endorseAnswer(answerId) {
    try {
        const response = await fetch('/api/endorse/answer', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ answerId })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showMessage('Endorsement recorded successfully!', 'success');
            setTimeout(() => {
                // Add cache busting to ensure fresh data
                window.location.href = window.location.href + '?t=' + Date.now();
            }, 1500);
        } else {
            showMessage(result.error);
        }
    } catch (error) {
        showMessage('Failed to endorse. Please try again.');
    }
}

// Add confirmation for destructive actions
document.addEventListener('DOMContentLoaded', function() {
    const logoutButtons = document.querySelectorAll('button[onclick="logout()"]');
    logoutButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            if (!confirm('Are you sure you want to logout?')) {
                e.preventDefault();
                return false;
            }
        });
    });
    
    // Form validation
    const usernameInputs = document.querySelectorAll('input[name="username"]');
    const passwordInputs = document.querySelectorAll('input[name="password"]');
    const textareas = document.querySelectorAll('textarea');
    
    // Username validation
    usernameInputs.forEach(input => {
        input.addEventListener('blur', function() {
            this.style.borderColor = this.value.length < 3 ? '#dc3545' : '#28a745';
        });
    });
    
    // Password validation
    passwordInputs.forEach(input => {
        input.addEventListener('blur', function() {
            this.style.borderColor = this.value.length < 6 ? '#dc3545' : '#28a745';
        });
    });
    
    // Auto-resize textareas and character count
    textareas.forEach(textarea => {
        // Auto-resize
        textarea.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = this.scrollHeight + 'px';
        });
        
        // Character count
        const charCount = document.createElement('div');
        charCount.className = 'char-count';
        charCount.style.cssText = 'font-size: 0.8rem; color: #666; text-align: right; margin-top: 0.25rem;';
        textarea.parentNode.insertBefore(charCount, textarea.nextSibling);
        
        function updateCharCount() {
            const length = textarea.value.length;
            charCount.textContent = `${length} characters`;
            charCount.style.color = (textarea.name === 'content' && length < 20) ? '#dc3545' : '#666';
        }
        
        updateCharCount();
        textarea.addEventListener('input', updateCharCount);
    });
    
    // Loading states for forms
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
        const submitButton = form.querySelector('button[type="submit"]');
        if (submitButton) {
            submitButton.setAttribute('data-original-text', submitButton.textContent);
        }
        
        form.addEventListener('submit', function() {
            if (submitButton) {
                submitButton.disabled = true;
                submitButton.textContent = 'Please wait...';
                
                // Re-enable after 5 seconds as fallback
                setTimeout(() => {
                    submitButton.disabled = false;
                    submitButton.textContent = submitButton.getAttribute('data-original-text') || 'Submit';
                }, 5000);
            }
        });
    });
});
