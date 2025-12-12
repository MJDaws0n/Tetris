const express = require('express');
const mysql = require('mysql2/promise');
const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');

const app = express();
const port = 3000;

// In-memory session store for anti-cheat validation
// Map<sessionId, { startTime: number }>
const sessions = new Map();

// Cleanup old sessions every hour
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.startTime > 24 * 60 * 60 * 1000) { // 24 hours
      sessions.delete(id);
    }
  }
}, 60 * 60 * 1000);

// Database connection configuration
const dbConfig = {
  host: process.env.DB_HOST || 'mysql',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'secret',
  database: process.env.DB_NAME || process.env.MYSQL_DATABASE || 'testdb'
};

// Create HTTP server so Express and WebSocket can share the same port
const server = http.createServer(app);

// Initialize WebSocket server on the same HTTP server
const wss = new WebSocket.Server({ server });

// Ensure database, table, and schema are ready
async function initDatabase() {
  const connection = await mysql.createConnection({
    host: dbConfig.host,
    user: dbConfig.user,
    password: dbConfig.password
  });

  // Create database if it doesn't exist
  await connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
  );
  await connection.end();

  const dbConnection = await mysql.createConnection(dbConfig);

  // Create scores table if it doesn't exist (normal mode)
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

  // Create scores_hard table for hard mode leaderboard
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

// Helper: get leaderboard from DB
async function getLeaderboard(hardMode = false) {
  const tableName = hardMode ? 'scores_hard' : 'scores';
  const connection = await mysql.createConnection(dbConfig);
  const [rows] = await connection.query(
    `SELECT name, score FROM ${tableName} ORDER BY score DESC, created_at ASC`
  );
  await connection.end();
  return rows;
}

// Helper: upsert a score
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

// WebSocket connection handling (based on old.js logic)
wss.on('connection', (ws) => {
  console.log('New client connected');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      // Handle session start
      if (data.type === 'start_game') {
        const sessionId = crypto.randomUUID();
        sessions.set(sessionId, {
          startTime: Date.now()
        });
        ws.send(JSON.stringify({ type: 'session_started', sessionId }));
        return;
      }

      // Handle leaderboard sync request
      if (data.type === 'sync') {
        await sendLeaderboard(ws);
        return;
      }

      // Handle score submission
      // Support both old format (for backward compat if needed, though we are tightening security)
      // and new format with sessionId.
      // For this request, we will ENFORCE sessionId for security.
      
      if (data.type === 'submit_score' || (data.name && data.score !== undefined)) {
        
        // 1. Validate Payload Structure
        if (!data.name || data.score === undefined) {
           ws.send(JSON.stringify({ error: 'Invalid message format' }));
           return;
        }

        // 2. Validate Session (Anti-Cheat)
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
        const lines = Number(data.lines || 0); // Default to 0 if missing, but we should send it

        if (!name) {
          ws.send(JSON.stringify({ error: 'Name cannot be empty' }));
          return;
        }

        if (!Number.isFinite(score) || score <= 0) {
           // It's possible to have 0 score, but usually we only submit positive scores.
           // If score is 0, we can just ignore it or accept it.
           if (score === 0) return; 
           ws.send(JSON.stringify({ error: 'Invalid score' }));
           return;
        }

        // 3. Feasibility Checks
        const now = Date.now();
        const elapsedSeconds = (now - session.startTime) / 1000;

        // Check A: Time Travel (Score received before game could reasonably start)
        if (elapsedSeconds < 0.1) {
           ws.send(JSON.stringify({ error: 'Too fast' }));
           return;
        }

        // Check B: Line Clear Rate
        // World record pace is ~3-4 lines/sec. We allow 10 lines/sec as a safe upper bound.
        // We add a small buffer (20 lines) for initial burst or lag.
        const maxPossibleLines = 20 + (elapsedSeconds * 10);
        if (lines > maxPossibleLines) {
           console.warn(`Rejected score: Impossible line rate. Lines: ${lines}, Elapsed: ${elapsedSeconds}`);
           ws.send(JSON.stringify({ error: 'Score rejected: Impossible gameplay detected' }));
           return;
        }

        // Check C: Score vs Lines
        // Formula: score += 100 * lines * lines
        // Max points per line is 400 (for a 4-line clear).
        // So score <= lines * 400.
        // We allow a small margin for potential future scoring changes or lag, but 400 is the hard math limit.
        // If lines is 0, score MUST be 0.
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

        // If we get here, the score is likely valid
        const hardMode = data.hardMode === true;
        await upsertScore(name, score, hardMode);
        console.log(`Score recorded: ${name} - ${score} (Lines: ${lines}, Time: ${elapsedSeconds.toFixed(1)}s, Hard: ${hardMode})`);

        ws.send(JSON.stringify({
          success: true,
          message: `Score for ${name} recorded: ${score}`
        }));

        await broadcastLeaderboard();
        return;
      }
      
      // Unknown message type
      ws.send(JSON.stringify({ error: 'Unknown message type' }));

    } catch (error) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({
        error: 'Invalid JSON format or database error'
      }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  // Send current leaderboard to newly connected client
  sendLeaderboard(ws).catch((err) => {
    console.error('Error sending initial leaderboard:', err);
  });
});

// Send leaderboard to a specific client
async function sendLeaderboard(ws) {
  const leaderboard = await getLeaderboard(false);
  const leaderboardHard = await getLeaderboard(true);
  
  const names = leaderboard.map((entry) => entry.name);
  const scores = leaderboard.map((entry) => entry.score);
  const namesHard = leaderboardHard.map((entry) => entry.name);
  const scoresHard = leaderboardHard.map((entry) => entry.score);

  ws.send(JSON.stringify({ names, scores, namesHard, scoresHard }));
}

// Broadcast leaderboard to all connected clients
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

// Basic HTTP route to verify server is running
app.get('/', (req, res) => {
  res.send('Score server is running. Connect via WebSocket to submit scores.');
});

// Health check route for DB
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

// Initialize database, then start server
// Retry logic for database connection
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
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before retrying
    }
  }
  console.error('Could not connect to database after multiple attempts. Exiting.');
  process.exit(1);
}

startServer();

// Graceful shutdown
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
