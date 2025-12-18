const express = require('express');
const mysql = require('mysql2/promise');
const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');

const app = express();
const port = 3000;

// ============================================
// DATA STRUCTURES
// ============================================

// In-memory session store for anti-cheat validation (single player)
const sessions = new Map(); // sessionId -> { startTime }

// Multiplayer room management
const rooms = new Map(); // roomCode -> Room

// Player -> Room mapping for quick lookup
const playerRooms = new Map(); // WebSocket -> roomCode

// Player colors for capture grid
const PLAYER_COLORS = [
    '#0a84ff', // Blue
    '#ff453a', // Red
    '#30d158', // Green
    '#bf5af2', // Purple
    '#ff9f0a', // Orange
    '#64d2ff', // Cyan
    '#ffd60a', // Yellow
    '#ff6b6b', // Coral
];

// Room class
class Room {
    constructor(code, host, hostName) {
        this.code = code;
        this.host = host; // WebSocket of host
        this.hostName = hostName;
        this.players = new Map(); // WebSocket -> PlayerInfo
        this.state = 'lobby'; // 'lobby' | 'playing' | 'finished'
        this.hardMode = false;
        this.captureGrid = this.createCaptureGrid();
        this.winner = null;
        this.rankings = [];
        this.createdAt = Date.now();
        
        // Add host as first player
        this.addPlayer(host, hostName);
    }
    
    createCaptureGrid() {
        // 10x10 grid, 0 = empty, playerId (1-8) = captured
        return Array.from({ length: 10 }, () => Array(10).fill(0));
    }
    
    addPlayer(ws, name) {
        const playerId = this.players.size + 1;
        const color = PLAYER_COLORS[(playerId - 1) % PLAYER_COLORS.length];
        
        this.players.set(ws, {
            id: playerId,
            name: name,
            color: color,
            score: 0,
            lines: 0,
            tilesOwned: 0,
            eliminated: false,
            lastClearSize: 0, // Track last line clear for territory battles
        });
        
        return playerId;
    }
    
    removePlayer(ws) {
        const player = this.players.get(ws);
        if (player) {
            this.players.delete(ws);
            // If host left and game is in lobby, assign new host
            if (ws === this.host && this.state === 'lobby' && this.players.size > 0) {
                const newHost = this.players.keys().next().value;
                this.host = newHost;
                return { newHost: newHost, player: player };
            }
        }
        return { player: player };
    }
    
    getPlayerList() {
        const list = [];
        for (const [ws, info] of this.players) {
            list.push({
                id: info.id,
                name: info.name,
                color: info.color,
                isHost: ws === this.host,
                eliminated: info.eliminated,
                score: info.score,
                tilesOwned: info.tilesOwned,
            });
        }
        return list;
    }
    
    isNameTaken(name, excludeWs = null) {
        const normalizedName = name.toLowerCase().trim();
        for (const [ws, info] of this.players) {
            if (ws !== excludeWs && info.name.toLowerCase() === normalizedName) {
                return true;
            }
        }
        return false;
    }
    
    // Get initial position for player (equally spaced around the grid)
    getInitialPosition(playerId, totalPlayers) {
        // Place players equally spaced around the perimeter or in a grid pattern
        const positions = [
            { x: 2, y: 2 },   // Top-left
            { x: 7, y: 2 },   // Top-right
            { x: 7, y: 7 },   // Bottom-right
            { x: 2, y: 7 },   // Bottom-left
            { x: 4, y: 1 },   // Top-center
            { x: 8, y: 4 },   // Right-center
            { x: 4, y: 8 },   // Bottom-center
            { x: 1, y: 4 },   // Left-center
        ];
        
        return positions[(playerId - 1) % positions.length];
    }
    
    // Count tiles owned by each player
    countTiles() {
        const counts = {};
        for (let y = 0; y < 10; y++) {
            for (let x = 0; x < 10; x++) {
                const owner = this.captureGrid[y][x];
                if (owner > 0) {
                    counts[owner] = (counts[owner] || 0) + 1;
                }
            }
        }
        return counts;
    }
    
    // Check for win condition: player owns all 100 tiles
    checkWin() {
        const tileCounts = this.countTiles();
        
        for (const [ws, player] of this.players) {
            if (player.eliminated) continue;
            
            const tilesOwned = tileCounts[player.id] || 0;
            
            // Win if player owns all 100 tiles
            if (tilesOwned === 100) {
                return player;
            }
        }
        
        return null;
    }
    
    // BFS to find if player has a connected path across the grid
    hasPath(playerId, direction) {
        const visited = new Set();
        const queue = [];
        
        // Start from left column (horizontal) or top row (vertical)
        if (direction === 'horizontal') {
            for (let y = 0; y < 10; y++) {
                if (this.captureGrid[y][0] === playerId) {
                    queue.push({ x: 0, y });
                    visited.add(`0,${y}`);
                }
            }
        } else {
            for (let x = 0; x < 10; x++) {
                if (this.captureGrid[0][x] === playerId) {
                    queue.push({ x, y: 0 });
                    visited.add(`${x},0`);
                }
            }
        }
        
        while (queue.length > 0) {
            const { x, y } = queue.shift();
            
            // Check if reached the other side
            if (direction === 'horizontal' && x === 9) return true;
            if (direction === 'vertical' && y === 9) return true;
            
            // Check neighbors (4-directional)
            const neighbors = [
                { x: x - 1, y },
                { x: x + 1, y },
                { x, y: y - 1 },
                { x, y: y + 1 },
            ];
            
            for (const n of neighbors) {
                const key = `${n.x},${n.y}`;
                if (n.x >= 0 && n.x < 10 && n.y >= 0 && n.y < 10 &&
                    !visited.has(key) && this.captureGrid[n.y][n.x] === playerId) {
                    visited.add(key);
                    queue.push(n);
                }
            }
        }
        
        return false;
    }
    
    // Capture tiles when a player clears lines - Clockwise spiral pattern with aggressive overriding
    captureTiles(playerId, linesCleared) {
        if (linesCleared <= 0) return [];
        
        const player = [...this.players.values()].find(p => p.id === playerId);
        if (!player) return [];
        
        player.lastClearSize = linesCleared;
        
        const captured = [];
        let remaining = linesCleared;
        
        // Find all cells owned by this player
        const ownedCells = [];
        for (let y = 0; y < 10; y++) {
            for (let x = 0; x < 10; x++) {
                if (this.captureGrid[y][x] === playerId) {
                    ownedCells.push({ x, y });
                }
            }
        }
        
        // If player has no territory yet, place at their initial position
        if (ownedCells.length === 0 && remaining > 0) {
            const pos = this.getInitialPosition(playerId, this.players.size);
            // Override whatever is there
            this.captureGrid[pos.y][pos.x] = playerId;
            captured.push(pos);
            remaining--;
            ownedCells.push(pos);
        }
        
        // Capture tiles in clockwise spiral pattern from owned territory
        while (remaining > 0 && ownedCells.length > 0) {
            const spiralCells = this.getSpiralCells(ownedCells);
            
            if (spiralCells.length === 0) {
                // No more cells to capture - board is full or unreachable
                break;
            }
            
            // Take cells in clockwise order
            for (const cell of spiralCells) {
                if (remaining <= 0) break;
                
                // Override any tile (empty or opponent)
                this.captureGrid[cell.y][cell.x] = playerId;
                captured.push(cell);
                ownedCells.push(cell);
                remaining--;
            }
        }
        
        // Update tile counts for all players and check for elimination
        const counts = this.countTiles();
        for (const [ws, p] of this.players) {
            p.tilesOwned = counts[p.id] || 0;
            
            // Eliminate players with zero tiles
            if (p.tilesOwned === 0 && !p.eliminated && p.id !== playerId) {
                p.eliminated = true;
            }
        }
        
        return captured;
    }
    
    // Get next layer of cells in clockwise spiral pattern
    getSpiralCells(ownedCells) {
        const borderCells = new Map(); // key -> {x, y, angle}
        
        // Find all cells adjacent to owned territory
        for (const cell of ownedCells) {
            const neighbors = [
                { x: cell.x, y: cell.y - 1, angle: 0 },      // Top
                { x: cell.x + 1, y: cell.y, angle: 90 },     // Right
                { x: cell.x, y: cell.y + 1, angle: 180 },    // Bottom
                { x: cell.x - 1, y: cell.y, angle: 270 },    // Left
            ];
            
            for (const n of neighbors) {
                if (n.x >= 0 && n.x < 10 && n.y >= 0 && n.y < 10) {
                    const key = `${n.x},${n.y}`;
                    // Check if this cell is not already owned by this player
                    const owner = this.captureGrid[n.y][n.x];
                    const ownerPlayerId = ownedCells.length > 0 ? 
                        this.captureGrid[ownedCells[0].y][ownedCells[0].x] : 0;
                    
                    if (owner !== ownerPlayerId && !borderCells.has(key)) {
                        // Calculate angle from center of owned territory
                        const centerX = ownedCells.reduce((sum, c) => sum + c.x, 0) / ownedCells.length;
                        const centerY = ownedCells.reduce((sum, c) => sum + c.y, 0) / ownedCells.length;
                        const angle = Math.atan2(n.y - centerY, n.x - centerX) * (180 / Math.PI);
                        const normalizedAngle = (angle + 360) % 360;
                        
                        borderCells.set(key, { x: n.x, y: n.y, angle: normalizedAngle });
                    }
                }
            }
        }
        
        // Sort by angle (clockwise from top: 0°, 90°, 180°, 270°)
        const sorted = Array.from(borderCells.values()).sort((a, b) => a.angle - b.angle);
        
        return sorted;
    }
    
    // Calculate final rankings
    calculateRankings() {
        const rankings = [];
        
        for (const [ws, player] of this.players) {
            rankings.push({
                id: player.id,
                name: player.name,
                color: player.color,
                score: player.score,
                lines: player.lines,
                tilesOwned: player.tilesOwned,
                eliminated: player.eliminated,
            });
        }
        
        // Sort by: winner first (100 tiles), then alive status, then tiles owned, then score
        rankings.sort((a, b) => {
            if (this.winner && a.name === this.winner.name) return -1;
            if (this.winner && b.name === this.winner.name) return 1;
            if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
            if (a.tilesOwned !== b.tilesOwned) return b.tilesOwned - a.tilesOwned;
            return b.score - a.score;
        });
        
        this.rankings = rankings;
        return rankings;
    }
}

// Generate unique room code
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars
    let code;
    do {
        code = '';
        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
    } while (rooms.has(code));
    return code;
}

// Cleanup old sessions and rooms
setInterval(() => {
    const now = Date.now();
    
    // Clean sessions older than 24 hours
    for (const [id, session] of sessions.entries()) {
        if (now - session.startTime > 24 * 60 * 60 * 1000) {
            sessions.delete(id);
        }
    }
    
    // Clean rooms older than 2 hours with no players
    for (const [code, room] of rooms.entries()) {
        if (room.players.size === 0 && now - room.createdAt > 2 * 60 * 60 * 1000) {
            rooms.delete(code);
        }
    }
}, 60 * 60 * 1000);

// ============================================
// DATABASE CONFIGURATION
// ============================================

const dbConfig = {
    host: process.env.DB_HOST || 'mysql',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'secret',
    database: process.env.DB_NAME || process.env.MYSQL_DATABASE || 'testdb'
};

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ============================================
// DATABASE FUNCTIONS
// ============================================

async function initDatabase() {
    const connection = await mysql.createConnection({
        host: dbConfig.host,
        user: dbConfig.user,
        password: dbConfig.password
    });

    await connection.query(
        `CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    );
    await connection.end();

    const dbConnection = await mysql.createConnection(dbConfig);

    await dbConnection.query(`
        CREATE TABLE IF NOT EXISTS scores (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            name_key VARCHAR(255) NOT NULL,
            score INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_name_key (name_key)
        ) ENGINE=InnoDB;
    `);

    await dbConnection.query(`
        CREATE TABLE IF NOT EXISTS scores_hard (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            name_key VARCHAR(255) NOT NULL,
            score INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_name_key (name_key)
        ) ENGINE=InnoDB;
    `);

    await dbConnection.end();
}

async function getLeaderboard(hardMode = false) {
    const tableName = hardMode ? 'scores_hard' : 'scores';
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.query(
        `SELECT name, score FROM ${tableName} ORDER BY score DESC, created_at ASC`
    );
    await connection.end();
    return rows;
}

async function upsertScore(name, score, hardMode = false) {
    const tableName = hardMode ? 'scores_hard' : 'scores';
    const nameKey = name.toLowerCase();
    const connection = await mysql.createConnection(dbConfig);

    await connection.query(
        `INSERT INTO ${tableName} (name, name_key, score)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE score = GREATEST(score, VALUES(score));`,
        [name, nameKey, score]
    );

    await connection.end();
}

// ============================================
// WEBSOCKET HANDLING
// ============================================

wss.on('connection', (ws) => {
    console.log('New client connected');

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            // Route message to appropriate handler
            switch (data.type) {
                // Single player
                case 'start_game':
                    handleStartGame(ws);
                    break;
                case 'sync':
                    await sendLeaderboard(ws);
                    break;
                case 'submit_score':
                    await handleSubmitScore(ws, data);
                    break;
                    
                // Multiplayer
                case 'create_room':
                    handleCreateRoom(ws, data);
                    break;
                case 'join_room':
                    handleJoinRoom(ws, data);
                    break;
                case 'leave_room':
                    handleLeaveRoom(ws);
                    break;
                case 'start_multiplayer':
                    handleStartMultiplayer(ws, data);
                    break;
                case 'line_clear':
                    await handleLineClear(ws, data);
                    break;
                case 'player_eliminated':
                    handlePlayerEliminated(ws, data);
                    break;
                case 'update_score':
                    handleUpdateScore(ws, data);
                    break;
                    
                default:
                    // Legacy support for old format
                    if (data.name && data.score !== undefined) {
                        await handleSubmitScore(ws, data);
                    } else {
                        ws.send(JSON.stringify({ error: 'Unknown message type' }));
                    }
            }
        } catch (error) {
            console.error('Error processing message:', error);
            ws.send(JSON.stringify({ error: 'Invalid JSON format or server error' }));
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        handleLeaveRoom(ws);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });

    // Send initial leaderboard
    sendLeaderboard(ws).catch((err) => {
        console.error('Error sending initial leaderboard:', err);
    });
});

// ============================================
// SINGLE PLAYER HANDLERS
// ============================================

function handleStartGame(ws) {
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, { startTime: Date.now() });
    ws.send(JSON.stringify({ type: 'session_started', sessionId }));
}

async function handleSubmitScore(ws, data) {
    if (!data.name || data.score === undefined) {
        ws.send(JSON.stringify({ error: 'Invalid message format' }));
        return;
    }

    // Validate session for anti-cheat
    if (!data.sessionId) {
        ws.send(JSON.stringify({ error: 'Security violation: Missing session ID' }));
        return;
    }

    const session = sessions.get(data.sessionId);
    if (!session) {
        ws.send(JSON.stringify({ error: 'Security violation: Invalid or expired session' }));
        return;
    }

    const name = data.name.replace(/\s+/g, '');
    const score = Number(data.score);
    const lines = Number(data.lines || 0);

    if (!name) {
        ws.send(JSON.stringify({ error: 'Name cannot be empty' }));
        return;
    }

    if (!Number.isFinite(score) || score < 0) {
        if (score === 0) return;
        ws.send(JSON.stringify({ error: 'Invalid score' }));
        return;
    }

    // Feasibility checks
    const now = Date.now();
    const elapsedSeconds = (now - session.startTime) / 1000;

    if (elapsedSeconds < 0.1) {
        ws.send(JSON.stringify({ error: 'Too fast' }));
        return;
    }

    const maxPossibleLines = 20 + (elapsedSeconds * 10);
    if (lines > maxPossibleLines) {
        console.warn(`Rejected score: Impossible line rate. Lines: ${lines}, Elapsed: ${elapsedSeconds}`);
        ws.send(JSON.stringify({ error: 'Score rejected: Impossible gameplay detected' }));
        return;
    }

    if (lines === 0 && score > 0) {
        console.warn(`Rejected score: Score > 0 with 0 lines.`);
        ws.send(JSON.stringify({ error: 'Score rejected: Score mismatch' }));
        return;
    }

    if (score > lines * 400) {
        console.warn(`Rejected score: Score too high for lines. Score: ${score}, Lines: ${lines}`);
        ws.send(JSON.stringify({ error: 'Score rejected: Score mismatch' }));
        return;
    }

    const hardMode = data.hardMode === true;
    await upsertScore(name, score, hardMode);
    console.log(`Score recorded: ${name} - ${score} (Lines: ${lines}, Time: ${elapsedSeconds.toFixed(1)}s, Hard: ${hardMode})`);

    ws.send(JSON.stringify({
        success: true,
        message: `Score for ${name} recorded: ${score}`
    }));

    await broadcastLeaderboard();
}

// ============================================
// MULTIPLAYER HANDLERS
// ============================================

function handleCreateRoom(ws, data) {
    const name = (data.name || '').trim().replace(/\s+/g, '');
    
    if (!name) {
        ws.send(JSON.stringify({ type: 'error', message: 'Name is required' }));
        return;
    }
    
    if (name.length > 20) {
        ws.send(JSON.stringify({ type: 'error', message: 'Name too long (max 20 characters)' }));
        return;
    }
    
    // Leave any existing room
    handleLeaveRoom(ws);
    
    const code = generateRoomCode();
    const room = new Room(code, ws, name);
    rooms.set(code, room);
    playerRooms.set(ws, code);
    
    ws.send(JSON.stringify({
        type: 'room_created',
        roomCode: code,
        playerId: 1,
        isHost: true,
        players: room.getPlayerList(),
    }));
    
    console.log(`Room ${code} created by ${name}`);
}

function handleJoinRoom(ws, data) {
    const name = (data.name || '').trim().replace(/\s+/g, '');
    const code = (data.roomCode || '').toUpperCase().trim();
    
    if (!name) {
        ws.send(JSON.stringify({ type: 'error', message: 'Name is required' }));
        return;
    }
    
    if (!code) {
        ws.send(JSON.stringify({ type: 'error', message: 'Room code is required' }));
        return;
    }
    
    const room = rooms.get(code);
    
    if (!room) {
        ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
        return;
    }
    
    if (room.state !== 'lobby') {
        ws.send(JSON.stringify({ type: 'error', message: 'Game already in progress' }));
        return;
    }
    
    if (room.players.size >= 8) {
        ws.send(JSON.stringify({ type: 'error', message: 'Room is full' }));
        return;
    }
    
    if (room.isNameTaken(name)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Name already taken in this room' }));
        return;
    }
    
    // Leave any existing room
    handleLeaveRoom(ws);
    
    const playerId = room.addPlayer(ws, name);
    playerRooms.set(ws, code);
    
    // Notify the joining player
    ws.send(JSON.stringify({
        type: 'room_joined',
        roomCode: code,
        playerId: playerId,
        isHost: false,
        players: room.getPlayerList(),
        hardMode: room.hardMode,
    }));
    
    // Notify other players
    broadcastToRoom(code, {
        type: 'player_joined',
        players: room.getPlayerList(),
    }, ws);
    
    console.log(`${name} joined room ${code}`);
}

function handleLeaveRoom(ws) {
    const code = playerRooms.get(ws);
    if (!code) return;
    
    const room = rooms.get(code);
    if (!room) {
        playerRooms.delete(ws);
        return;
    }
    
    const result = room.removePlayer(ws);
    playerRooms.delete(ws);
    
    if (result.player) {
        console.log(`${result.player.name} left room ${code}`);
    }
    
    // If room is empty, delete it
    if (room.players.size === 0) {
        rooms.delete(code);
        console.log(`Room ${code} deleted (empty)`);
        return;
    }
    
    // If game was playing and someone left, check if only one player remains
    if (room.state === 'playing') {
        const alivePlayers = [...room.players.values()].filter(p => !p.eliminated);
        if (alivePlayers.length <= 1) {
            // End the game
            room.state = 'finished';
            if (alivePlayers.length === 1) {
                room.winner = alivePlayers[0];
            }
            const rankings = room.calculateRankings();
            
            broadcastToRoom(code, {
                type: 'game_over',
                winner: room.winner ? { name: room.winner.name, color: room.winner.color } : null,
                rankings: rankings,
                captureGrid: room.captureGrid,
            });
        }
    }
    
    // Notify remaining players
    const updateMsg = {
        type: 'player_left',
        players: room.getPlayerList(),
        leftPlayer: result.player ? result.player.name : null,
    };
    
    if (result.newHost) {
        updateMsg.newHostId = room.players.get(result.newHost).id;
    }
    
    broadcastToRoom(code, updateMsg);
}

function handleStartMultiplayer(ws, data) {
    const code = playerRooms.get(ws);
    if (!code) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not in a room' }));
        return;
    }
    
    const room = rooms.get(code);
    if (!room) {
        ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
        return;
    }
    
    if (ws !== room.host) {
        ws.send(JSON.stringify({ type: 'error', message: 'Only host can start the game' }));
        return;
    }
    
    if (room.players.size < 2) {
        ws.send(JSON.stringify({ type: 'error', message: 'Need at least 2 players to start' }));
        return;
    }
    
    if (room.state !== 'lobby') {
        ws.send(JSON.stringify({ type: 'error', message: 'Game already started' }));
        return;
    }
    
    // Set hard mode if specified
    room.hardMode = data.hardMode === true;
    room.state = 'playing';
    room.captureGrid = room.createCaptureGrid(); // Reset capture grid
    
    // Reset all player stats
    for (const [playerWs, player] of room.players) {
        player.score = 0;
        player.lines = 0;
        player.tilesOwned = 0;
        player.eliminated = false;
        player.lastClearSize = 0;
    }
    
    broadcastToRoom(code, {
        type: 'game_started',
        hardMode: room.hardMode,
        players: room.getPlayerList(),
        captureGrid: room.captureGrid,
    });
    
    console.log(`Game started in room ${code} (Hard: ${room.hardMode})`);
}

async function handleLineClear(ws, data) {
    const code = playerRooms.get(ws);
    if (!code) return;
    
    const room = rooms.get(code);
    if (!room || room.state !== 'playing') return;
    
    const player = room.players.get(ws);
    if (!player || player.eliminated) return;
    
    const linesCleared = Number(data.lines) || 0;
    const score = Number(data.score) || 0;
    
    player.lines += linesCleared;
    player.score = score;
    
    // Capture tiles on the grid
    const captured = room.captureTiles(player.id, linesCleared);
    
    // Check for win
    const winner = room.checkWin();
    
    if (winner) {
        room.state = 'finished';
        room.winner = winner;
        const rankings = room.calculateRankings();
        
        // Add scores to leaderboard
        for (const [playerWs, p] of room.players) {
            if (p.score > 0) {
                await upsertScore(p.name, p.score, room.hardMode);
            }
        }
        await broadcastLeaderboard();
        
        broadcastToRoom(code, {
            type: 'game_over',
            winner: { name: winner.name, color: winner.color },
            rankings: rankings,
            captureGrid: room.captureGrid,
        });
        
        console.log(`Game over in room ${code}. Winner: ${winner.name}`);
    } else {
        // Broadcast grid update to all players
        broadcastToRoom(code, {
            type: 'grid_update',
            playerId: player.id,
            playerName: player.name,
            linesCleared: linesCleared,
            captured: captured,
            captureGrid: room.captureGrid,
            players: room.getPlayerList(),
        });
    }
}

async function handlePlayerEliminated(ws, data) {
    const code = playerRooms.get(ws);
    if (!code) return;
    
    const room = rooms.get(code);
    if (!room || room.state !== 'playing') return;
    
    const player = room.players.get(ws);
    if (!player || player.eliminated) return;
    
    player.eliminated = true;
    player.score = Number(data.score) || player.score;
    
    // Notify all players
    broadcastToRoom(code, {
        type: 'player_eliminated',
        playerId: player.id,
        playerName: player.name,
        players: room.getPlayerList(),
    });
    
    // Check if game should end (one or fewer players remaining)
    const alivePlayers = [...room.players.values()].filter(p => !p.eliminated);
    
    if (alivePlayers.length <= 1) {
        room.state = 'finished';
        room.winner = alivePlayers.length === 1 ? alivePlayers[0] : null;
        const rankings = room.calculateRankings();
        
        // Add scores to leaderboard
        for (const [playerWs, p] of room.players) {
            if (p.score > 0) {
                await upsertScore(p.name, p.score, room.hardMode);
            }
        }
        await broadcastLeaderboard();
        
        broadcastToRoom(code, {
            type: 'game_over',
            winner: room.winner ? { name: room.winner.name, color: room.winner.color } : null,
            rankings: rankings,
            captureGrid: room.captureGrid,
        });
        
        console.log(`Game over in room ${code}. Winner: ${room.winner?.name || 'None'}`);
    }
}

function handleUpdateScore(ws, data) {
    const code = playerRooms.get(ws);
    if (!code) return;
    
    const room = rooms.get(code);
    if (!room || room.state !== 'playing') return;
    
    const player = room.players.get(ws);
    if (!player) return;
    
    player.score = Number(data.score) || player.score;
    player.lines = Number(data.lines) || player.lines;
    
    // Broadcast score update to other players
    broadcastToRoom(code, {
        type: 'score_update',
        playerId: player.id,
        score: player.score,
        lines: player.lines,
    }, ws);
}

// ============================================
// BROADCAST FUNCTIONS
// ============================================

function broadcastToRoom(roomCode, message, excludeWs = null) {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    const msgStr = JSON.stringify(message);
    
    for (const [ws] of room.players) {
        if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
            ws.send(msgStr);
        }
    }
}

async function sendLeaderboard(ws) {
    const leaderboard = await getLeaderboard(false);
    const leaderboardHard = await getLeaderboard(true);
    
    const names = leaderboard.map((entry) => entry.name);
    const scores = leaderboard.map((entry) => entry.score);
    const namesHard = leaderboardHard.map((entry) => entry.name);
    const scoresHard = leaderboardHard.map((entry) => entry.score);

    ws.send(JSON.stringify({ names, scores, namesHard, scoresHard }));
}

async function broadcastLeaderboard() {
    const leaderboard = await getLeaderboard(false);
    const leaderboardHard = await getLeaderboard(true);
    
    const names = leaderboard.map((entry) => entry.name);
    const scores = leaderboard.map((entry) => entry.score);
    const namesHard = leaderboardHard.map((entry) => entry.name);
    const scoresHard = leaderboardHard.map((entry) => entry.score);

    const message = JSON.stringify({ names, scores, namesHard, scoresHard });

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// ============================================
// HTTP ROUTES
// ============================================

app.get('/', (req, res) => {
    res.send('Tetris Territory Wars server is running. Connect via WebSocket to play.');
});

app.get('/db-check', async (req, res) => {
    try {
        const connection = await mysql.createConnection(dbConfig);
        await connection.ping();
        await connection.end();
        res.send('Successfully connected to MySQL database!');
    } catch (err) {
        res.status(500).send('Database connection failed: ' + err.stack);
    }
});

// ============================================
// SERVER STARTUP
// ============================================

async function startServer() {
    let retries = 10;
    while (retries > 0) {
        try {
            await initDatabase();
            server.listen(port, () => {
                console.log(`HTTP/WebSocket server listening on port ${port}`);
            });
            return;
        } catch (err) {
            console.error(`Failed to initialize database (retries left: ${retries}):`, err.message);
            retries--;
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
    console.error('Could not connect to database after multiple attempts. Exiting.');
    process.exit(1);
}

startServer();

process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    wss.close(() => {
        console.log('WebSocket server closed');
        server.close(() => {
            console.log('HTTP server closed');
            process.exit(0);
        });
    });
});
