document.addEventListener('DOMContentLoaded', () => {
    // Auth Elements
    const authContainer = document.getElementById('auth-container');
    const appContainer = document.getElementById('app-container');
    const authForm = document.getElementById('auth-form');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const registerBtn = document.getElementById('register-btn');
    const authError = document.getElementById('auth-error');
    const authSuccess = document.getElementById('auth-success');
    const currentUserSpan = document.getElementById('current-user');
    const tokensLeftSpan = document.getElementById('tokens-left');
    const logoutBtn = document.getElementById('logout-btn');

    // Sidebar Elements
    const chatList = document.getElementById('chat-list');
    const newChatBtn = document.getElementById('new-chat-btn');
    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.querySelector('.sidebar');

    // Chat Elements
    const chatBox = document.getElementById('chat-box');
    const userInput = document.getElementById('user-input');
    const sendBtn = document.getElementById('send-btn');
    
    // State
    let token = localStorage.getItem('jwt_token');
    let username = localStorage.getItem('username');
    let activeChatId = null;

    // Initialization
    if (token) {
        showApp();
        loadUserInfo();
        loadChats();
    } else {
        showAuth();
    }

    async function loadUserInfo() {
        try {
            const res = await fetch('/api/user', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                tokensLeftSpan.textContent = data.tokens;
            }
        } catch (e) {
            console.error("Failed to load user info", e);
        }
    }

    function showAuth() {
        authContainer.classList.remove('hidden');
        appContainer.classList.add('hidden');
    }

    function showApp() {
        authContainer.classList.add('hidden');
        appContainer.classList.remove('hidden');
        currentUserSpan.textContent = username;
    }

    function showError(msg) {
        authError.textContent = msg;
        authError.classList.remove('hidden');
        authSuccess.classList.add('hidden');
    }

    function showSuccess(msg) {
        authSuccess.textContent = msg;
        authSuccess.classList.remove('hidden');
        authError.classList.add('hidden');
    }

    // Auth Event Listeners
    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const user = usernameInput.value.trim();
        const pass = passwordInput.value;

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: user, password: pass })
            });
            const data = await res.json();
            
            if (res.ok) {
                token = data.token;
                username = data.username;
                localStorage.setItem('jwt_token', token);
                localStorage.setItem('username', username);
                tokensLeftSpan.textContent = data.tokens;
                
                usernameInput.value = '';
                passwordInput.value = '';
                authError.classList.add('hidden');
                authSuccess.classList.add('hidden');
                showApp();
                loadChats();
            } else {
                showError(data.error);
            }
        } catch (err) {
            showError('Network error. Try again.');
        }
    });

    registerBtn.addEventListener('click', async () => {
        const user = usernameInput.value.trim();
        const pass = passwordInput.value;

        if (!user || !pass) {
            showError("Username and password required");
            return;
        }

        try {
            const res = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: user, password: pass })
            });
            const data = await res.json();
            
            if (res.ok) {
                showSuccess("Registration successful! You can now login.");
            } else {
                showError(data.error);
            }
        } catch (err) {
            showError('Network error. Try again.');
        }
    });

    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('username');
        token = null;
        username = null;
        activeChatId = null;
        chatBox.innerHTML = '';
        showAuth();
    });

    // Mobile Menu
    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });
    }

    // Sidebar Listeners
    newChatBtn.addEventListener('click', () => {
        activeChatId = null;
        renderEmptyState();
        updateActiveChatItem();
        if (window.innerWidth <= 768) sidebar.classList.remove('open');
    });

    async function loadChats() {
        try {
            const res = await fetch('/api/chats', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (res.status === 401 || res.status === 403) {
                logoutBtn.click();
                return;
            }

            const chats = await res.json();
            renderChatList(chats);
            
            // Auto-load latest chat or show empty state
            if (chats.length > 0) {
                loadChatMessages(chats[0].id);
            } else {
                renderEmptyState();
            }
        } catch (e) {
            console.error("Failed to load chats", e);
        }
    }

    function renderChatList(chats) {
        chatList.innerHTML = '';
        chats.forEach(chat => {
            const li = document.createElement('li');
            li.className = `chat-item ${chat.id === activeChatId ? 'active' : ''}`;
            li.dataset.id = chat.id;
            
            li.innerHTML = `
                <span class="chat-item-title">${chat.title || 'New Chat'}</span>
                <button class="chat-item-delete" title="Delete Chat">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            `;
            
            li.addEventListener('click', (e) => {
                if (e.target.closest('.chat-item-delete')) {
                    deleteChat(chat.id);
                } else {
                    loadChatMessages(chat.id);
                    if (window.innerWidth <= 768) sidebar.classList.remove('open');
                }
            });
            
            chatList.appendChild(li);
        });
    }

    function updateActiveChatItem() {
        document.querySelectorAll('.chat-item').forEach(item => {
            if (parseInt(item.dataset.id) === activeChatId) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }

    async function deleteChat(id) {
        if (!confirm("Delete this chat?")) return;
        try {
            await fetch(`/api/chats/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (activeChatId === id) {
                activeChatId = null;
                renderEmptyState();
            }
            loadChats();
        } catch (err) {
            console.error("Failed to delete chat", err);
        }
    }

    async function loadChatMessages(chatId) {
        activeChatId = chatId;
        updateActiveChatItem();
        
        try {
            const res = await fetch(`/api/chats/${chatId}/messages`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const messages = await res.json();
            
            chatBox.innerHTML = '';
            if (messages.length === 0) {
                renderEmptyState();
            } else {
                messages.forEach(msg => {
                    const sender = msg.role === 'model' ? 'ai' : 'user';
                    addMessage(msg.content, sender, true);
                });
            }
        } catch (err) {
            console.error("Failed to load messages", err);
        }
    }

    function renderEmptyState() {
        chatBox.innerHTML = `
            <div class="empty-state">
                <div class="greeting">
                    <h1>Hello, <span class="gradient-text">${username || 'Developer'}</span></h1>
                    <p>How can I help you with Data Structures & Algorithms today?</p>
                </div>
            </div>
        `;
    }

    // Input Listeners
    userInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        if (this.value === '') {
            this.style.height = 'auto';
            sendBtn.classList.remove('active');
        } else {
            sendBtn.classList.add('active');
        }
    });

    userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    sendBtn.addEventListener('click', handleSend);

    async function handleSend() {
        const text = userInput.value.trim();
        if (!text) return;

        // If no active chat, create one first
        if (!activeChatId) {
            try {
                const res = await fetch('/api/chats', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ title: "New Chat" })
                });
                const chat = await res.json();
                activeChatId = chat.id;
                // Add to UI immediately, we will reload it properly later or update title
                const li = document.createElement('li');
                li.className = 'chat-item active';
                li.dataset.id = activeChatId;
                li.innerHTML = `<span class="chat-item-title">New Chat</span>
                                <button class="chat-item-delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>`;
                chatList.prepend(li);
                updateActiveChatItem();
            } catch (err) {
                console.error("Failed to create chat", err);
                return;
            }
        }

        // Remove empty state if present
        const emptyState = document.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        addMessage(text, 'user');
        userInput.value = '';
        userInput.style.height = 'auto';
        sendBtn.classList.remove('active');

        const typingId = addTypingIndicator();

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ chatId: activeChatId, message: text })
            });
            
            if (response.status === 401 || response.status === 403) {
                logoutBtn.click();
                return;
            }

            const data = await response.json();
            const typingEl = document.getElementById(typingId);
            if (typingEl) typingEl.remove();

            if (data.error) {
                addMessage("Sorry, an error occurred: " + data.error, 'ai');
            } else {
                if (data.tokens !== undefined) {
                    tokensLeftSpan.textContent = data.tokens;
                }
                
                let responseText = data.text;
                if (data.cached) {
                    responseText = "*(Answer from database - 0 tokens used)*\n\n" + responseText;
                }

                addMessage(responseText, 'ai', true);
                // Update title if it changed
                if (data.title) {
                    const activeLi = document.querySelector(`.chat-item[data-id="${activeChatId}"] .chat-item-title`);
                    if (activeLi) activeLi.textContent = data.title;
                }
            }
        } catch (error) {
            const typingEl = document.getElementById(typingId);
            if (typingEl) typingEl.remove();
            addMessage("Network error. Please try again.", 'ai');
        }
    }

    function addMessage(text, sender, isMarkdown = false) {
        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper';
        
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${sender}-message`;
        
        let innerHTML = '';
        
        if (sender === 'ai') {
            innerHTML += `
                <div class="ai-avatar">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10H12V2z"></path><path d="M12 12 2.1 14.9a10 10 0 0 0 19.8 0L12 12z"></path></svg>
                </div>
            `;
        }

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        
        if (isMarkdown && sender === 'ai' && typeof marked !== 'undefined') {
            contentDiv.innerHTML = marked.parse(text);
        } else {
            contentDiv.textContent = text;
        }

        msgDiv.innerHTML = innerHTML;
        msgDiv.appendChild(contentDiv);
        wrapper.appendChild(msgDiv);
        chatBox.appendChild(wrapper);
        scrollToBottom();
    }

    function addTypingIndicator() {
        const id = 'typing-' + Date.now();
        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper';
        wrapper.id = id;
        
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ai-message`;
        
        msgDiv.innerHTML = `
            <div class="ai-avatar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10H12V2z"></path><path d="M12 12 2.1 14.9a10 10 0 0 0 19.8 0L12 12z"></path></svg>
            </div>
            <div class="message-content">
                <div class="typing-indicator">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            </div>
        `;
        
        wrapper.appendChild(msgDiv);
        chatBox.appendChild(wrapper);
        scrollToBottom();
        return id;
    }

    function scrollToBottom() {
        chatBox.scrollTop = chatBox.scrollHeight;
    }
});
