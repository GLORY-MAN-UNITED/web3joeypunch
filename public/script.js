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
    
    // Register form handler
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const formData = new FormData(registerForm);
            const data = {
                username: formData.get('username'),
                password: formData.get('password')
            };
            
            // Basic validation
            if (data.password.length < 6) {
                showMessage('Password must be at least 6 characters long.');
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
                    showMessage('Registration successful! Redirecting...', 'success');
                    setTimeout(() => {
                        window.location.href = '/';
                    }, 1000);
                } else {
                    showMessage(result.error);
                }
            } catch (error) {
                showMessage('Registration failed. Please try again.');
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
