const express = require('express');
const mysql = require('mysql2/promise');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const port = process.env.NODE_PORT || 3000;

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

  // Create scores table if it doesn't exist
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

  await dbConnection.end();
}

// Helper: get leaderboard from DB
async function getLeaderboard() {
  const connection = await mysql.createConnection(dbConfig);
  const [rows] = await connection.query(
    'SELECT name, score FROM scores ORDER BY score DESC, created_at ASC'
  );
  await connection.end();
  return rows;
}

// Helper: upsert a score
async function upsertScore(name, score) {
  const nameKey = name.toLowerCase();
  const connection = await mysql.createConnection(dbConfig);

  await connection.query(
    `INSERT INTO scores (name, name_key, score)
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

      if (!data.name || data.score === undefined) {
        ws.send(JSON.stringify({
          error: 'Invalid message format. Expected: {name: string, score: number}'
        }));
        return;
      }

      const name = data.name;
      const score = Number(data.score);

      if (!Number.isFinite(score) || score <= 0) {
        ws.send(JSON.stringify({
          error: 'Score must be a positive number (greater than zero)'
        }));
        return;
      }

      await upsertScore(name, score);
      console.log(`Score recorded: ${name} - ${score}`);

      ws.send(JSON.stringify({
        success: true,
        message: `Score for ${name} recorded: ${score}`
      }));

      await broadcastLeaderboard();
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
  const leaderboard = await getLeaderboard();
  const names = leaderboard.map((entry) => entry.name);
  const scores = leaderboard.map((entry) => entry.score);

  ws.send(JSON.stringify({ names, scores }));
}

// Broadcast leaderboard to all connected clients
async function broadcastLeaderboard() {
  const leaderboard = await getLeaderboard();
  const names = leaderboard.map((entry) => entry.name);
  const scores = leaderboard.map((entry) => entry.score);

  const message = JSON.stringify({ names, scores });

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
