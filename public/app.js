// Конфигурация
let socket = null;
let currentUser = null;
let activeChat = null;
let users = {};

// DOM элементы
const authModal = document.getElementById('authModal');
const registerModal = document.getElementById('registerModal');
const mainApp = document.getElementById('mainApp');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    // Проверяем, есть ли сохраненный пользователь
    const savedUser = localStorage.getItem('ckam_current_user');
    if (savedUser) {
        autoLogin(savedUser);
    } else {
        showLogin();
    }
    
    // Настройка форм
    setupForms();
});

function showLogin() {
    authModal.style.display = 'flex';
    registerModal.style.display = 'none';
    updateInviteLink();
}

function showRegister() {
    authModal.style.display = 'none';
    registerModal.style.display = 'flex';
}

function setupForms() {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await login();
    });
    
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await register();
    });
}

async function autoLogin(username) {
    // Проверяем пользователя через API
    try {
        const response = await fetch('/api/users');
        const allUsers = await response.json();
        const userExists = allUsers.some(u => u.username === username);
        
        if (userExists) {
            // Просто показываем главный интерфейс
            // В реальном приложении нужно проверить пароль
            currentUser = username;
            showMainApp();
            connectWebSocket();
        } else {
            showLogin();
        }
    } catch (error) {
        console.error('Auto login error:', error);
        showLogin();
    }
}

async function login() {
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentUser = username;
            localStorage.setItem('ckam_current_user', username);
            showMainApp();
            connectWebSocket();
        } else {
            showError('loginError', data.error || 'Ошибка входа');
        }
    } catch (error) {
        showError('loginError', 'Ошибка соединения с сервером');
    }
}

async function register() {
    const username = document.getElementById('registerUsername').value;
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('registerConfirmPassword').value;
    
    if (password !== confirmPassword) {
        showError('registerError', 'Пароли не совпадают');
        return;
    }
    
    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showLogin();
            document.getElementById('loginUsername').value = username;
            document.getElementById('loginPassword').value = password;
        } else {
            showError('registerError', data.error || 'Ошибка регистрации');
        }
    } catch (error) {
        showError('registerError', 'Ошибка соединения с сервером');
    }
}

function showMainApp() {
    authModal.style.display = 'none';
    registerModal.style.display = 'none';
    mainApp.style.display = 'flex';
    
    // Обновляем информацию о пользователе
    document.getElementById('username').textContent = currentUser;
    document.getElementById('userAvatar').textContent = currentUser.charAt(0).toUpperCase();
    
    // Загружаем пользователей
    loadUsers();
}

function showError(elementId, message) {
    const element = document.getElementById(elementId);
    element.textContent = message;
    element.style.display = 'block';
    setTimeout(() => {
        element.style.display = 'none';
    }, 5000);
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    socket = new WebSocket(wsUrl);
    
    socket.onopen = () => {
        console.log('WebSocket connected');
        socket.send(JSON.stringify({
            type: 'login',
            username: currentUser
        }));
    };
    
    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };
    
    socket.onclose = () => {
        console.log('WebSocket disconnected');
        setTimeout(connectWebSocket, 3000);
    };
    
    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'init':
            // Инициализация пользователей
            data.users.forEach(user => {
                users[user.username] = user;
            });
            updateChatList();
            break;
            
        case 'new_message':
            // Новое сообщение
            if (activeChat === data.message.sender) {
                addMessage(data.message);
            } else {
                showNotification(data.message.sender, data.message.text);
            }
            updateChatList();
            break;
            
        case 'user_status':
            // Изменение статуса пользователя
            if (users[data.username]) {
                users[data.username].online = data.online;
                users[data.username].lastSeen = data.timestamp;
            }
            updateChatList();
            break;
            
        case 'users_list':
            // Обновление списка пользователей
            users = {};
            data.users.forEach(user => {
                users[user.username] = user;
            });
            updateChatList();
            break;
            
        case 'messages':
            // Загрузка истории сообщений
            if (data.withUser === activeChat) {
                loadMessages(data.messages);
            }
            break;
            
        case 'user_typing':
            // Пользователь печатает
            showTypingIndicator(data.username, data.isTyping);
            break;
    }
}

function loadUsers() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'get_users' }));
    }
}

function updateChatList() {
    const chatsList = document.getElementById('chatsList');
    chatsList.innerHTML = '';
    
    Object.keys(users).forEach(username => {
        if (username !== currentUser) {
            const user = users[username];
            const chatItem = document.createElement('div');
            chatItem.className = 'chat-item' + (activeChat === username ? ' active' : '');
            chatItem.onclick = () => openChat(username);
            chatItem.innerHTML = `
                <div class="avatar">
                    ${username.charAt(0).toUpperCase()}
                    ${user.online ? '<span class="online-dot"></span>' : ''}
                </div>
                <div>
                    <h4>${username}</h4>
                    <p>${user.online ? 'online' : 'offline'}</p>
                </div>
            `;
            chatsList.appendChild(chatItem);
        }
    });
}

function openChat(username) {
    activeChat = username;
    
    // Показываем окно чата
    document.getElementById('emptyChat').style.display = 'none';
    document.getElementById('activeChat').style.display = 'flex';
    
    // Обновляем информацию о чате
    document.getElementById('chatName').textContent = username;
    document.getElementById('chatAvatar').textContent = username.charAt(0).toUpperCase();
    document.getElementById('chatStatus').textContent = users[username]?.online ? 'online' : 'offline';
    
    // Загружаем сообщения
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'get_messages',
            withUser: username
        }));
    }
    
    // Фокус на поле ввода
    document.getElementById('messageInput').focus();
}

function loadMessages(messages) {
    const container = document.getElementById('messagesContainer');
    container.innerHTML = '';
    
    messages.forEach(msg => {
        addMessage(msg);
    });
    
    // Прокручиваем вниз
    container.scrollTop = container.scrollHeight;
}

function addMessage(msg) {
    const container = document.getElementById('messagesContainer');
    const isOutgoing = msg.sender === currentUser;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isOutgoing ? 'message-outgoing' : 'message-incoming'}`;
    
    const time = new Date(msg.timestamp);
    const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}`;
    
    messageDiv.innerHTML = `
        ${!isOutgoing ? `<div class="message-sender">${msg.sender}</div>` : ''}
        <div class="message-bubble">
            <div class="message-text">${msg.text}</div>
            <div class="message-time">${timeStr}</div>
        </div>
    `;
    
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
}

function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    
    if (!text || !activeChat || !socket || socket.readyState !== WebSocket.OPEN) return;
    
    socket.send(JSON.stringify({
        type: 'message',
        receiver: activeChat,
        text: text
    }));
    
    // Добавляем сообщение в интерфейс
    addMessage({
        sender: currentUser,
        text: text,
        timestamp: Date.now(),
        read: false
    });
    
    // Очищаем поле ввода
    input.value = '';
    input.style.height = 'auto';
    
    // Обновляем список чатов
    updateChatList();
}

function searchUsers() {
    const searchTerm = document.getElementById('globalSearch').value.toLowerCase();
    const chatItems = document.querySelectorAll('.chat-item');
    
    chatItems.forEach(item => {
        const userName = item.querySelector('h4').textContent.toLowerCase();
        if (userName.includes(searchTerm)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

function showNotification(user, message) {
    const notification = document.getElementById('notification');
    notification.querySelector('span').textContent = `💬 ${user}: ${message.substring(0, 30)}${message.length > 30 ? '...' : ''}`;
    notification.style.display = 'flex';
    notification.dataset.user = user;
    
    setTimeout(() => {
        notification.style.display = 'none';
    }, 5000);
}

function openNotificationChat() {
    const user = document.getElementById('notification').dataset.user;
    if (user) {
        openChat(user);
        document.getElementById('notification').style.display = 'none';
    }
}

function updateInviteLink() {
    const link = window.location.href.split('?')[0];
    document.getElementById('inviteLink').textContent = link;
}

function copyInviteLink() {
    const link = window.location.href.split('?')[0];
    navigator.clipboard.writeText(link).then(() => {
        alert('Ссылка скопирована в буфер обмена!');
    });
}

function showSettings() {
    // Реализация настроек
    alert('Настройки будут добавлены в следующей версии');
}

function showTypingIndicator(username, isTyping) {
    const statusElement = document.getElementById('chatStatus');
    if (activeChat === username) {
        statusElement.textContent = isTyping ? 'печатает...' : (users[username]?.online ? 'online' : 'offline');
    }
}

// Обработка нажатия Enter в поле ввода
document.getElementById('messageInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// Авторазмер текстового поля
document.getElementById('messageInput').addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
});
