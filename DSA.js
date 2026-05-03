import express from 'express';
import bodyParser from 'body-parser';
import { GoogleGenAI } from "@google/genai";
import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey_please_change_in_production';

let db;

// Jaccard similarity for fuzzy cache matching
function calculateSimilarity(str1, str2) {
    const tokenize = text => new Set(text.toLowerCase().split(/\W+/).filter(w => w.length > 2));
    const set1 = tokenize(str1);
    const set2 = tokenize(str2);
    if (set1.size === 0 && set2.size === 0) return 1.0;
    if (set1.size === 0 || set2.size === 0) return 0.0;
    
    let intersection = 0;
    for (let word of set1) {
        if (set2.has(word)) intersection++;
    }
    const union = set1.size + set2.size - intersection;
    return intersection / union;
}

// Initialize Database
async function initDB() {
    try {
        db = await open({
            filename: './database.sqlite',
            driver: sqlite3.Database
        });

        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                tokens INTEGER DEFAULT 10,
                last_token_reset DATE DEFAULT CURRENT_DATE
            );
        `);
        
        // Handle migration for existing databases
        try {
            await db.exec(`ALTER TABLE users ADD COLUMN tokens INTEGER DEFAULT 10;`);
        } catch (e) {
            // Column likely already exists
        }
        try {
            await db.exec(`ALTER TABLE users ADD COLUMN last_token_reset DATE;`);
        } catch (e) {
            // Column likely already exists
        }

        await db.exec(`
            CREATE TABLE IF NOT EXISTS chats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                title TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id)
            );
        `);
        await db.exec(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER,
                user_id INTEGER,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
                FOREIGN KEY(user_id) REFERENCES users(id)
            );
        `);
        await db.exec(`
            CREATE TABLE IF NOT EXISTS qa_cache (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                question TEXT UNIQUE NOT NULL,
                answer TEXT NOT NULL
            );
        `);
        console.log("SQLite Database initialized with Token and Cache support.");
    } catch (err) {
        console.error("Error initializing database:", err.message);
    }
}
initDB();

// Authentication Middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: "Access denied. Please login." });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: "Session expired. Please login again." });
        req.user = user;
        next();
    });
}

// User Registration
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: "Username and password required" });

        const existingUser = await db.get('SELECT * FROM users WHERE username = ?', [username]);
        if (existingUser) return res.status(400).json({ error: "Username already exists" });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        await db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, hashedPassword]);
        res.json({ success: true, message: "User registered successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error during registration" });
    }
});

// User Login
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);

        if (!user) return res.status(400).json({ error: "Invalid credentials" });

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) return res.status(400).json({ error: "Invalid credentials" });

        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
        
        // Handle token daily reset on login
        let currentTokens = user.tokens;
        const today = new Date().toISOString().split('T')[0];
        if (user.last_token_reset !== today) {
            await db.run('UPDATE users SET tokens = 10, last_token_reset = ? WHERE id = ?', [today, user.id]);
            currentTokens = 10;
        }

        res.json({ token, username: user.username, tokens: currentTokens });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error during login" });
    }
});

// Get User Info (Tokens)
app.get('/api/user', authenticateToken, async (req, res) => {
    try {
        const user = await db.get('SELECT username, tokens, last_token_reset FROM users WHERE id = ?', [req.user.id]);
        
        const today = new Date().toISOString().split('T')[0];
        if (user.last_token_reset !== today) {
            await db.run('UPDATE users SET tokens = 10, last_token_reset = ? WHERE id = ?', [today, req.user.id]);
            user.tokens = 10;
        }
        res.json({ username: user.username, tokens: user.tokens });
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch user data" });
    }
});

// Get User Chats
app.get('/api/chats', authenticateToken, async (req, res) => {
    try {
        const chats = await db.all('SELECT id, title, created_at FROM chats WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
        res.json(chats);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch chats" });
    }
});

// Create New Chat
app.post('/api/chats', authenticateToken, async (req, res) => {
    try {
        const title = req.body.title || "New Chat";
        const result = await db.run('INSERT INTO chats (user_id, title) VALUES (?, ?)', [req.user.id, title]);
        res.json({ id: result.lastID, title });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to create chat" });
    }
});

// Get Chat Messages
app.get('/api/chats/:id/messages', authenticateToken, async (req, res) => {
    try {
        const chatId = req.params.id;

        // Ensure chat belongs to user
        const chat = await db.get('SELECT * FROM chats WHERE id = ? AND user_id = ?', [chatId, req.user.id]);
        if (!chat) return res.status(404).json({ error: "Chat not found" });

        const messages = await db.all('SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id ASC', [chatId]);
        res.json(messages);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch messages" });
    }
});

// Delete Chat
app.delete('/api/chats/:id', authenticateToken, async (req, res) => {
    try {
        const chatId = req.params.id;
        await db.run('DELETE FROM messages WHERE chat_id = ?', [chatId]);
        await db.run('DELETE FROM chats WHERE id = ? AND user_id = ?', [chatId, req.user.id]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to delete chat" });
    }
});

// Send Chat Message
app.post('/api/chat', authenticateToken, async (req, res) => {
    try {
        const { chatId, message } = req.body;
        const userId = req.user.id;

        if (!message) return res.status(400).json({ error: "Message is required" });
        if (!chatId) return res.status(400).json({ error: "chatId is required" });

        // Ensure chat belongs to user
        const chat = await db.get('SELECT * FROM chats WHERE id = ? AND user_id = ?', [chatId, userId]);
        if (!chat) return res.status(404).json({ error: "Chat not found" });

        // Reset tokens if needed
        const user = await db.get('SELECT tokens, last_token_reset FROM users WHERE id = ?', [userId]);
        const today = new Date().toISOString().split('T')[0];
        let currentTokens = user.tokens;
        if (user.last_token_reset !== today) {
            await db.run('UPDATE users SET tokens = 10, last_token_reset = ? WHERE id = ?', [today, userId]);
            currentTokens = 10;
        }

        // Auto-update title if it's "New Chat" or first message
        if (chat.title === "New Chat") {
            const newTitle = message.length > 30 ? message.substring(0, 30) + '...' : message;
            await db.run('UPDATE chats SET title = ? WHERE id = ?', [newTitle, chatId]);
        }

        // 1. Fuzzy search in cache (learning from past data)
        const allCached = await db.all('SELECT question, answer FROM qa_cache');
        let bestMatch = null;
        let highestSimilarity = 0;

        for (const item of allCached) {
            const sim = calculateSimilarity(message, item.question);
            if (sim > highestSimilarity) {
                highestSimilarity = sim;
                bestMatch = item;
            }
        }

        // Fetch history to check previous context and for Gemini
        const rows = await db.all('SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id ASC', [chatId]);
        
        let isAnsweringFallback = false;
        let questionToCache = message.trim();
        const isYes = message.trim().toLowerCase() === 'yes';
        const isNo = message.trim().toLowerCase() === 'no';

        if (rows.length > 0) {
            const lastMessage = rows[rows.length - 1];
            if (lastMessage.role === 'model' && lastMessage.content === "Currently i do not have answer for your question, If you want i can also answer using Gemini.") {
                if (isYes) {
                    isAnsweringFallback = true;
                    if (rows.length >= 2 && rows[rows.length - 2].role === 'user') {
                        questionToCache = rows[rows.length - 2].content.trim();
                    }
                } else if (isNo) {
                    const noReply = "Okay! Feel free to ask anything else.";
                    await db.run('INSERT INTO messages (chat_id, user_id, role, content) VALUES (?, ?, ?, ?)', [chatId, userId, 'user', message]);
                    await db.run('INSERT INTO messages (chat_id, user_id, role, content) VALUES (?, ?, ?, ?)', [chatId, userId, 'model', noReply]);
                    return res.json({ text: noReply, title: chat.title === "New Chat" ? (message.length > 30 ? message.substring(0, 30) + '...' : message) : undefined, tokens: currentTokens, cached: true });
                }
            }
        }

        // Threshold for similarity (0.65 means they share a majority of key words)
        // Only serve from cache if user is NOT explicitly saying 'yes' to fallback
        if (!isAnsweringFallback && bestMatch && highestSimilarity > 0.65) {
            console.log("Serving from fuzzy cache. Similarity:", highestSimilarity.toFixed(2), "Matched:", bestMatch.question);
            
            // Save user message to DB
            await db.run('INSERT INTO messages (chat_id, user_id, role, content) VALUES (?, ?, ?, ?)', [chatId, userId, 'user', message]);
            // Save model response to DB
            await db.run('INSERT INTO messages (chat_id, user_id, role, content) VALUES (?, ?, ?, ?)', [chatId, userId, 'model', bestMatch.answer]);
            
            return res.json({ text: bestMatch.answer, title: chat.title === "New Chat" ? (message.length > 30 ? message.substring(0, 30) + '...' : message) : undefined, tokens: currentTokens, cached: true });
        }

        if (!isAnsweringFallback) {
            // It's a cache miss and the user is asking a new question
            const fallbackMsg = "Currently i do not have answer for your question, If you want i can also answer using Gemini.";
            
            await db.run('INSERT INTO messages (chat_id, user_id, role, content) VALUES (?, ?, ?, ?)', [chatId, userId, 'user', message]);
            await db.run('INSERT INTO messages (chat_id, user_id, role, content) VALUES (?, ?, ?, ?)', [chatId, userId, 'model', fallbackMsg]);
            
            return res.json({ text: fallbackMsg, title: chat.title === "New Chat" ? (message.length > 30 ? message.substring(0, 30) + '...' : message) : undefined, tokens: currentTokens, cached: true });
        }

        // IF we are here, we are answering fallback (user said 'yes'). Time to call Gemini.
        // Check tokens first.
        if (currentTokens <= 0) {
            return res.status(403).json({ error: "Daily token limit reached. Please try again tomorrow." });
        }

        // Call Gemini
        const geminiHistory = rows.map(row => ({
            role: row.role === 'user' ? 'user' : 'model',
            parts: [{ text: row.content }]
        }));

        // Create a new chat session with history
        const genChat = ai.chats.create({
            model: "gemini-3-flash-preview",
            config: {
                systemInstruction: `You are a Data structure and Algorithm Instructor. You will only reply to the problem related to Data structure and Algorithm. You have to solve query of user in simplest way.
If user ask any question which is not related to Data structure and Algorithm, reply him I am trained only for answering Data Structure and Algorithm related questions.
After Reply you can ask user only if the user ask any question which is not related to Data structure and Algorithm that "If you want i can also answer using Gemini." if user reply yes then answer the question that are not related to Data Structure and Algorithm.
All the explanation should be simple.`,
            },
            history: geminiHistory
        });

        // Send the new message
        const response = await genChat.sendMessage({ message });
        
        // Save to cache for future learning using the ORIGINAL question
        try {
            await db.run('INSERT OR IGNORE INTO qa_cache (question, answer) VALUES (?, ?)', [questionToCache, response.text]);
        } catch (e) {
            console.error("Cache insert error (might be duplicate):", e.message);
        }

        // Deduct Token
        currentTokens -= 1;
        await db.run('UPDATE users SET tokens = ? WHERE id = ?', [currentTokens, userId]);

        // Save user message to DB
        await db.run('INSERT INTO messages (chat_id, user_id, role, content) VALUES (?, ?, ?, ?)', [chatId, userId, 'user', message]);
        // Save model response to DB
        await db.run('INSERT INTO messages (chat_id, user_id, role, content) VALUES (?, ?, ?, ?)', [chatId, userId, 'model', response.text]);

        res.json({ text: response.text, title: chat.title === "New Chat" ? (message.length > 30 ? message.substring(0, 30) + '...' : message) : undefined, tokens: currentTokens, cached: false });
    } catch (error) {
        console.error("Error communicating with Gemini:", error);
        res.status(500).json({ error: "Failed to generate response." });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});