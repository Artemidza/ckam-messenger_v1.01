const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Создаем папку для данных если её нет
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Функции для работы с файлами
function loadUsers() {
    try {
        const filePath = path.join(DATA_DIR, 'users.json');
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading users:', error);
    }
    
    // Начальные пользователи
    return {
        'demo': { password: 'demo', online: false, lastSeen: Date.now() },
        'alex': { password: '123', online: false, lastSeen: Date.now() },
        'maria': { password: '123', online: false, lastSeen: Date.now() },
        'artem': { password: '123', online: false, lastSeen: Date.now() }
    };
}

function saveUsers(users) {
    try {
        const filePath = path.join(DATA_DIR, 'users.json');
        fs.writeFileSync(filePath, JSON.stringify(users, null, 2));
    } catch (error) {
        console.error('Error saving users:', error);
    }
}

function loadMessages() {
    try {
        const filePath = path.join(DATA_DIR, 'messages.json');
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading messages:', error);
    }
    return {};
}

function saveMessages(messages) {
    try {
        const filePath = path.join(DATA_DIR, 'messages.json');
        fs.writeFileSync(filePath, JSON.stringify(messages, null, 2));
    } catch (error) {
        console.error('Error saving messages:', error);
    }
}

// Загружаем данные
let users = loadUsers();
let messages = loadMessages();
const onlineUsers = new Map(); // username -> WebSocket

// API endpoints
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/users', (req, res) => {
    const usersList = Object.keys(users).map(username => ({
        username,
        online: onlineUsers.has(username),
        lastSeen: users[username].lastSeen
    }));
    res.json(usersList);
});

app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }
    
    if (username.length < 3) {
        return res.status(400).json({ error: 'Имя должно быть не менее 3 символов' });
    }
    
    if (password.length < 3) {
        return res.status(400).json({ error: 'Пароль должен быть не менее 3 символов' });
    }
    
    if (users[username]) {
        return res.status(400).json({ error: 'Пользователь уже существует' });
    }
    
    users[username] = {
        password,
        online: false,
        lastSeen: Date.now(),
        createdAt: new Date().toISOString()
    };
    
    saveUsers(users);
    
    res.json({ 
        success: true, 
        username,
        message: 'Регистрация успешна!' 
    });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!users[username]) {
        return res.status(401).json({ error: 'Пользователь не найден' });
    }
    
    if (users[username].password !== password) {
        return res.status(401).json({ error: 'Неверный пароль' });
    }
    
    users[username].lastSeen = Date.now();
    saveUsers(users);
    
    res.json({ 
        success: true, 
        username,
        message: 'Вход выполнен успешно' 
    });
});

app.get('/api/messages/:withUser', (req, res) => {
    const currentUser = req.query.currentUser;
    const withUser = req.params.withUser;
    
    if (!currentUser || !withUser) {
        return res.status(400).json({ error: 'Не указаны пользователи' });
    }
    
    const chatId = [currentUser, withUser].sort().join('_');
    const chatMessages = messages[chatId] || [];
    
    res.json({ messages: chatMessages });
});

// WebSocket для реального времени
wss.on('connection', (ws, req) => {
    let currentUser = null;
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            
            switch (message.type) {
                case 'login':
                    currentUser = message.username;
                    onlineUsers.set(currentUser, ws);
                    
                    // Обновляем статус пользователя
                    if (users[currentUser]) {
                        users[currentUser].online = true;
                        users[currentUser].lastSeen = Date.now();
                    }
                    
                    // Уведомляем всех о новом онлайн пользователе
                    broadcastToAll({
                        type: 'user_status',
                        username: currentUser,
                        online: true,
                        timestamp: Date.now()
                    });
                    
                    // Отправляем текущему пользователю список всех пользователей
                    ws.send(JSON.stringify({
                        type: 'init',
                        currentUser: currentUser,
                        users: Object.keys(users).map(u => ({
                            username: u,
                            online: onlineUsers.has(u),
                            lastSeen: users[u].lastSeen
                        }))
                    }));
                    break;
                    
                case 'message':
                    if (!currentUser || !message.receiver || !message.text) {
                        return;
                    }
                    
                    const chatMessage = {
                        id: Date.now(),
                        sender: currentUser,
                        receiver: message.receiver,
                        text: message.text.trim(),
                        timestamp: Date.now(),
                        read: false
                    };
                    
                    // Сохраняем сообщение
                    const chatId = [chatMessage.sender, chatMessage.receiver].sort().join('_');
                    if (!messages[chatId]) messages[chatId] = [];
                    messages[chatId].push(chatMessage);
                    saveMessages(messages);
                    
                    // Отправляем отправителю подтверждение
                    ws.send(JSON.stringify({
                        type: 'message_sent',
                        message: chatMessage
                    }));
                    
                    // Отправляем получателю, если он онлайн
                    const receiverWs = onlineUsers.get(message.receiver);
                    if (receiverWs && receiverWs.readyState === WebSocket.OPEN) {
                        receiverWs.send(JSON.stringify({
                            type: 'new_message',
                            message: chatMessage
                        }));
                        
                        // Помечаем как прочитанное
                        chatMessage.read = true;
                    }
                    break;
                    
                case 'typing':
                    if (!currentUser || !message.receiver) return;
                    
                    const typingWs = onlineUsers.get(message.receiver);
                    if (typingWs && typingWs.readyState === WebSocket.OPEN) {
                        typingWs.send(JSON.stringify({
                            type: 'user_typing',
                            username: currentUser,
                            isTyping: message.isTyping
                        }));
                    }
                    break;
                    
                case 'read_message':
                    if (!currentUser || !message.messageId || !message.sender) return;
                    
                    const readChatId = [currentUser, message.sender].sort().join('_');
                    if (messages[readChatId]) {
                        const msg = messages[readChatId].find(m => m.id === message.messageId);
                        if (msg) {
                            msg.read = true;
                            saveMessages(messages);
                        }
                    }
                    break;
                    
                case 'get_users':
                    ws.send(JSON.stringify({
                        type: 'users_list',
                        users: Object.keys(users).map(u => ({
                            username: u,
                            online: onlineUsers.has(u),
                            lastSeen: users[u].lastSeen
                        }))
                    }));
                    break;
            }
        } catch (error) {
            console.error('WebSocket error:', error);
        }
    });
    
    ws.on('close', () => {
        if (currentUser) {
            onlineUsers.delete(currentUser);
            
            if (users[currentUser]) {
                users[currentUser].online = false;
                users[currentUser].lastSeen = Date.now();
            }
            
            // Уведомляем всех о выходе пользователя
            broadcastToAll({
                type: 'user_status',
                username: currentUser,
                online: false,
                timestamp: Date.now()
            });
        }
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

function broadcastToAll(data) {
    const message = JSON.stringify(data);
    onlineUsers.forEach((ws, username) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
        }
    });
}

// Статический файл для всех маршрутов
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Порт из переменной окружения или 3000 по умолчанию
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`🌐 Доступен по адресу: http://localhost:${PORT}`);
    console.log(`📡 WebSocket: ws://localhost:${PORT}`);
    
    // Автоматически создаем тестовых пользователей если их нет
    if (!fs.existsSync(path.join(DATA_DIR, 'users.json'))) {
        saveUsers(users);
        console.log('👤 Созданы тестовые пользователи: demo/demo, alex/123, maria/123, artem/123');
    }
});

// Обработка завершения работы
process.on('SIGINT', () => {
    console.log('🔄 Сохранение данных перед выходом...');
    saveUsers(users);
    saveMessages(messages);
    console.log('👋 Сервер остановлен');
    process.exit(0);
});
