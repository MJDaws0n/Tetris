document.addEventListener("DOMContentLoaded", function() {
    const game = new Game('gameCanvas');
    game.start();
});

class Game {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.context = this.canvas.getContext('2d');
        // Slightly taller board and tuned cell size for nicer proportions on the dark layout
        this.boardWidth = 10;
        this.boardHeight = 22;
        this.cellSize = 28;
        // UI area is handled in the sidebar; canvas only renders the playfield
        // extra space at the top so pieces aren't cut off
        this.topOffset = 14;
        
        // Bind resize handler
        window.addEventListener('resize', () => this._fitCanvas());
        
        // make canvas match the logical board size and scale for HiDPI screens
        this._fitCanvas();
        this.board = this.createBoard();
        this.currentPiece = null;
        this.nextPiece = this.randomPiece();
        this.holdPiece = null;
        this.canHold = true;
        this.score = 0;
        this.level = 1;
        this.linesCleared = 0;
        this.gameOver = false;
        this.dropInterval = 1000; // Initial drop interval in ms
        this.lastDropTime = 0;
        this.startTime = null;
        this.elapsedTime = 0;
        this.playerName = null;
        this.leaderboardKey = 'tetris_leaderboard_v1';
        this.prefsKey = 'tetris_prefs_v1';
        this.hardModeKey = 'tetris_hard_mode';
        this.ghostBlockEnabled = true;
        this.hardMode = false;
        this.lockDelay = 500; // ms
        this.lockStartTime = null;
        this.lockResetCount = 0; // Track number of lock delay resets
        this.maxLockResets = 15; // Cap on lock delay resets to prevent infinite floating
        this.sessionId = null;
        this.allScores = []; // Store full leaderboard (normal mode)
        this.allScoresHard = []; // Store full leaderboard (hard mode)

        // shared online leaderboard via websocket
        this.ws = null;
        this.wsUrl = 'wss://tetris-server.mjdawson.net:441';

        // bind UI elements (modal, leaderboard)
        this._bindUI();

        this._onKey = this.handleKey.bind(this);
        document.addEventListener('keydown', this._onKey);

        // connect to remote leaderboard
        this._connectWebSocket();
    }

    _fitCanvas() {
        const dpr = window.devicePixelRatio || 1;
        
        // Calculate available height in the game area container
        const gameArea = document.getElementById('gameArea');
        if (!gameArea) return;

        // Get available height (viewport height minus header/padding)
        // We want some padding on top/bottom
        const availableHeight = gameArea.clientHeight - 40; 
        const availableWidth = gameArea.clientWidth - 40;

        // Base dimensions
        const boardRows = this.boardHeight;
        const boardCols = this.boardWidth;
        
        // Calculate max cell size that fits in height
        // We need (boardRows * cellSize) + topOffset <= availableHeight
        const maxCellHeight = (availableHeight - this.topOffset) / boardRows;
        
        // Calculate max cell size that fits in width
        const maxCellWidth = availableWidth / boardCols;
        
        // Use the smaller of the two to ensure it fits
        // But don't go larger than our "ideal" size of 28
        this.cellSize = Math.min(28, Math.floor(Math.min(maxCellHeight, maxCellWidth)));
        
        // Ensure minimum playable size
        this.cellSize = Math.max(10, this.cellSize);

        const totalWidth = this.boardWidth * this.cellSize;
        const totalHeight = this.boardHeight * this.cellSize + (this.topOffset || 0);
        
        this.canvas.width = Math.floor(totalWidth * dpr);
        this.canvas.height = Math.floor(totalHeight * dpr);
        this.canvas.style.width = totalWidth + 'px';
        this.canvas.style.height = totalHeight + 'px';
        this.canvas.style.display = 'block';
        
        this.context.setTransform(1, 0, 0, 1, 0, 0);
        this.context.scale(dpr, dpr);
        
        // Redraw if game is running
        if (this.board) {
            this.draw();
        }
    }

    createBoard() {
        return Array.from({ length: this.boardHeight }, () => Array(this.boardWidth).fill(0));
    }

    randomPiece() {
        const pieces = 'IJLOSTZ';
        const type = pieces[Math.floor(Math.random() * pieces.length)];
        return new Piece(type);
    }

    getDropInterval(level) {
        // Approximate NES Tetris speeds in milliseconds
        // Level 1 starts at 800ms (48 frames)
        const speeds = [
            800, 717, 633, 550, 467, 383, 300, 217, 133, 100, // Levels 1-10
            83, 83, 83, 67, 67, 67, 50, 50, 50, 33            // Levels 11-20
        ];
        
        if (level <= speeds.length) {
            return speeds[level - 1];
        }
        // Cap at very fast speed for high levels
        return level >= 29 ? 17 : 33;
    }

    start() {
        // prompt for player name before starting
        this.showNameModal();
    }

    reset() {
        this.board = this.createBoard();
        this.currentPiece = this.nextPiece;
        this.nextPiece = this.randomPiece();
        this.holdPiece = null;
        this.canHold = true;
        this.currentPiece.setPosition(Math.floor(this.boardWidth / 2) - 1, 0);
        this.score = 0;
        this.level = this.hardMode ? 10 : 1;
        this.linesCleared = 0;
        this.gameOver = false;
        this.dropInterval = this.getDropInterval(this.level);
        this.lastDropTime = 0;
        this.lockStartTime = null;
        this.lockResetCount = 0;
        this.startTime = performance.now();
        this.elapsedTime = 0;
        this.updateSidebar();

        // Start new session for anti-cheat
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'start_game' }));
        }
    }

    update(time) {
        if (this.gameOver) {
            this.drawGameOver();
            return;
        }

        if (!this.lastDropTime) {
            this.lastDropTime = time;
        }

        if (this.startTime != null) {
            this.elapsedTime = Math.max(0, time - this.startTime);
        }

        const deltaTime = time - this.lastDropTime;

        // Handle lock delay
        if (this.lockStartTime !== null) {
            if (time - this.lockStartTime > this.lockDelay) {
                this.lockPiece();
                this.clearLines();
                this.spawnNextPiece();
                this.lockStartTime = null;
            }
        } else if (deltaTime > this.dropInterval) {
            this.lastDropTime = time;
            this.moveDown();
        }

        this.draw();
        requestAnimationFrame((time) => this.update(time));
    }

    spawnNextPiece() {
        this.currentPiece = this.nextPiece;
        this.nextPiece = this.randomPiece();
        this.canHold = true;
        this.currentPiece.setPosition(Math.floor(this.boardWidth / 2) - 1, 0);
        // Reset lock state for new piece
        this.lockStartTime = null;
        this.lockResetCount = 0;
        if (!this.validMove(this.currentPiece, 0, 0)) {
            this.gameOver = true;
            this.handleGameOver();
        }
    }

    moveDown() {
        if (this.validMove(this.currentPiece, 0, 1)) {
            this.currentPiece.y++;
            // If we moved down successfully, cancel lock delay and reset counter
            this.lockStartTime = null;
            this.lockResetCount = 0;
        } else {
            // Collision below - start lock timer if not started
            if (this.lockStartTime === null) {
                this.lockStartTime = performance.now();
                this.lockResetCount = 0;
            }
        }
    }

    resetLockTimer() {
        if (this.lockStartTime !== null && this.lockResetCount < this.maxLockResets) {
            // Reset timer to give player more time, but only up to the cap
            this.lockStartTime = performance.now();
            this.lockResetCount++;
        }
    }

    // Check if piece is grounded (cannot move down)
    isGrounded() {
        return !this.validMove(this.currentPiece, 0, 1);
    }

    // Update lock state - call after any movement to check if piece should still be locking
    updateLockState() {
        if (this.isGrounded()) {
            // Piece is on ground/block, start or continue lock delay
            if (this.lockStartTime === null) {
                this.lockStartTime = performance.now();
                this.lockResetCount = 0;
            }
        } else {
            // Piece can still fall, cancel lock delay
            this.lockStartTime = null;
            this.lockResetCount = 0;
        }
    }

    moveLeft() {
        if (this.validMove(this.currentPiece, -1, 0)) {
            this.currentPiece.x--;
            // After moving, check if we're still grounded
            // If not grounded anymore, cancel lock delay (piece can fall)
            // If still grounded, reset the lock timer (if under cap)
            if (this.isGrounded()) {
                this.resetLockTimer();
            } else {
                this.lockStartTime = null;
                this.lockResetCount = 0;
            }
        }
    }

    moveRight() {
        if (this.validMove(this.currentPiece, 1, 0)) {
            this.currentPiece.x++;
            // After moving, check if we're still grounded
            if (this.isGrounded()) {
                this.resetLockTimer();
            } else {
                this.lockStartTime = null;
                this.lockResetCount = 0;
            }
        }
    }

    rotate() {
        const piece = this.currentPiece;
        const originalRotation = piece.rotation;
        const originalMatrix = piece.matrix.map(row => row.slice());
        const originalX = piece.x;
        const originalY = piece.y;

        piece.rotate();
        
        // Wall kick offsets to try (based on SRS-lite)
        // For I-piece, we need larger offsets
        const isIPiece = piece.type === 'I';
        const kickOffsets = isIPiece 
            ? [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1], [-1, -1], [1, -1]]
            : [[0, 0], [-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1], [0, 1]];
        
        for (const [dx, dy] of kickOffsets) {
            if (this.validMove(piece, dx, dy)) {
                piece.x += dx;
                piece.y += dy;
                // After rotation, update lock state based on new position
                if (this.isGrounded()) {
                    this.resetLockTimer();
                } else {
                    this.lockStartTime = null;
                    this.lockResetCount = 0;
                }
                return;
            }
        }
        
        // Revert rotation and position if no valid position found
        piece.rotation = originalRotation;
        piece.matrix = originalMatrix;
        piece.x = originalX;
        piece.y = originalY;
    }

    hold() {
        if (!this.canHold) return;

        if (this.holdPiece === null) {
            this.holdPiece = this.currentPiece;
            this.currentPiece = this.nextPiece;
            this.nextPiece = this.randomPiece();
        } else {
            const temp = this.currentPiece;
            this.currentPiece = this.holdPiece;
            this.holdPiece = temp;
        }

        // Reset position and rotation of the piece coming into play
        this.currentPiece.rotation = 0;
        this.currentPiece.setPosition(Math.floor(this.boardWidth / 2) - 1, 0);
        
        // Reset rotation of held piece for display purposes
        this.holdPiece.rotation = 0;

        // Reset lock state - new piece should fall freely from the top
        this.lockStartTime = null;
        this.lockResetCount = 0;

        this.canHold = false;
        this.updateSidebar();
    }

    validMove(piece, offsetX, offsetY) {
        for (let y = 0; y < piece.matrix.length; y++) {
            for (let x = 0; x < piece.matrix[y].length; x++) {
                if (piece.matrix[y][x]) {
                    const newX = piece.x + x + offsetX;
                    const newY = piece.y + y + offsetY;
                    if (newX < 0 || newX >= this.boardWidth || newY >= this.boardHeight) {
                        return false;
                    }
                    if (newY >= 0 && this.board[newY][newX]) {
                        return false;
                    }
                }
            }
        }
        return true;
    }

    lockPiece() {
        for (let y = 0; y < this.currentPiece.matrix.length; y++) {
            for (let x = 0; x < this.currentPiece.matrix[y].length; x++) {
                if (this.currentPiece.matrix[y][x]) {
                    const boardX = this.currentPiece.x + x;
                    const boardY = this.currentPiece.y + y;
                    if (boardY >= 0) {
                        this.board[boardY][boardX] = this.currentPiece.type;
                    }
                }
            }
        }
    }

    clearLines() {
        let linesCleared = 0;
        for (let y = this.boardHeight - 1; y >= 0; y--) {
            if (this.board[y].every(cell => cell !== 0)) {
                this.board.splice(y, 1);
                this.board.unshift(Array(this.boardWidth).fill(0));
                linesCleared++;
                y++;
            }
        }
        if (linesCleared > 0) {
            this.linesCleared += linesCleared;
            // New scoring: 100 * lines * lines
            const points = 100 * linesCleared * linesCleared;
            this.score += points;
            
            this.showScorePopup(points);

            if (this.linesCleared >= this.level * 10) {
                this.level++;
                this.dropInterval = this.getDropInterval(this.level);
            }
            // Send updated score to server immediately
            this._sendScoreToServer(this.playerName, this.score);
        }
    }

    showScorePopup(points) {
        const container = document.getElementById('scorePopups');
        if (!container) return;

        const popup = document.createElement('div');
        popup.className = 'score-popup';
        popup.textContent = `+${points}`;
        
        // Position roughly in the center of the game area
        // (A more advanced version would map board coordinates to screen pixels)
        popup.style.left = '50%';
        popup.style.top = '40%';
        popup.style.transform = 'translate(-50%, -50%)';

        container.appendChild(popup);

        // Remove after animation
        setTimeout(() => {
            if (popup.parentNode) popup.parentNode.removeChild(popup);
        }, 1000);
    }

    handleKey(event) {
        if (this.gameOver) {
            if (event.key === ' ') {
                this.playerName = null;
                this.showNameModal();
            }
            return;
        }
        switch (event.key) {
            case 'ArrowLeft':
            case 'a':
            case 'A':
                this.moveLeft();
                break;
            case 'ArrowRight':
            case 'd':
            case 'D':
                this.moveRight();
                break;
            case 'ArrowDown':
            case 's':
            case 'S':
                this.moveDown();
                break;
            case 'ArrowUp':
            case 'w':
            case 'W':
                this.rotate();
                break;
            case 'c':
            case 'C':
                this.hold();
                break;
            case ' ':
                // Hard drop
                while (this.validMove(this.currentPiece, 0, 1)) {
                    this.currentPiece.y++;
                }
                // Lock immediately on hard drop
                this.lockPiece();
                this.clearLines();
                this.spawnNextPiece();
                this.lockStartTime = null;
                break;
        }
    }

    draw() {
        this.context.clearRect(0, 0, this.boardWidth * this.cellSize, this.boardHeight * this.cellSize + (this.topOffset || 0));
        this.context.save();
        this.context.translate(0, this.topOffset || 0);
        this.drawBoard();
        
        if (this.currentPiece) {
            // Draw ghost piece
            if (this.ghostBlockEnabled) {
                this.drawGhostPiece();
            }
            this.drawPiece(this.currentPiece);
        }
        
        // score and next piece are displayed in the sidebar (DOM)
        this.updateSidebar();
        this.context.restore();
    }

    drawGhostPiece() {
        const ghost = new Piece(this.currentPiece.type);
        ghost.matrix = this.currentPiece.matrix; // Copy rotation state
        ghost.x = this.currentPiece.x;
        ghost.y = this.currentPiece.y;

        while (this.validMove(ghost, 0, 1)) {
            ghost.y++;
        }

        this.context.globalAlpha = 0.2;
        this.drawPiece(ghost);
        this.context.globalAlpha = 1.0;
    }

    drawBoard() {
        this.context.strokeStyle = '#ccc';
        for (let y = 0; y < this.boardHeight; y++) {
            for (let x = 0; x < this.boardWidth; x++) {
                this.context.strokeRect(x * this.cellSize, y * this.cellSize, this.cellSize, this.cellSize);
                if (this.board[y][x]) {
                    this.context.fillStyle = this.getColor(this.board[y][x]);
                    this.context.fillRect(x * this.cellSize, y * this.cellSize, this.cellSize, this.cellSize);
                }
            }
        }
    }

    drawPiece(piece) {
        for (let y = 0; y < piece.matrix.length; y++) {
            for (let x = 0; x < piece.matrix[y].length; x++) {
                if (piece.matrix[y][x]) {
                    const drawX = (piece.x + x) * this.cellSize;
                    const drawY = (piece.y + y) * this.cellSize;
                    this.context.fillStyle = this.getColor(piece.type);
                    this.context.fillRect(drawX, drawY, this.cellSize, this.cellSize);
                    this.context.strokeRect(drawX, drawY, this.cellSize, this.cellSize);
                }
            }
        }
    }

    updateSidebar() {
        const table = document.getElementById('leaderboardTable');
        if (!table) return;

        // Update current run stats card
        const playerEl = document.getElementById('statPlayer');
        const scoreEl = document.getElementById('statScore');
        const levelEl = document.getElementById('statLevel');
        const linesEl = document.getElementById('statLines');
        const timeEl = document.getElementById('statTime');
        if (playerEl) playerEl.textContent = this.playerName || '—';
        if (scoreEl) scoreEl.textContent = this.score;
        if (levelEl) levelEl.textContent = this.level;
        if (linesEl) linesEl.textContent = this.linesCleared;
        if (timeEl) timeEl.textContent = this._formatTime(this.elapsedTime);

        // Render next piece preview
        this.renderPiecePreview('nextPiecePreview', this.nextPiece);
        
        // Render hold piece preview
        this.renderPiecePreview('holdPiecePreview', this.holdPiece);
    }

    renderPiecePreview(elementId, piece) {
        const preview = document.getElementById(elementId);
        if (preview) {
            preview.innerHTML = '';
            if (piece) {
                const grid = document.createElement('div');
                grid.className = 'next-piece-grid';
                const color = this.getColor(piece.type);
                // normalize to max 4x4 grid
                const matrix = piece.matrix;
                for (let y = 0; y < 4; y++) {
                    for (let x = 0; x < 4; x++) {
                        const cell = document.createElement('div');
                        cell.className = 'next-piece-cell';
                        const filled = matrix[y] && matrix[y][x];
                        if (filled) {
                            cell.style.background = color;
                            cell.style.boxShadow = '0 0 8px ' + color + '55';
                        }
                        grid.appendChild(cell);
                    }
                }
                preview.appendChild(grid);
            }
        }
    }

    _formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const mm = minutes.toString().padStart(2, '0');
        const ss = seconds.toString().padStart(2, '0');
        return `${mm}:${ss}`;
    }

    drawGameOver() {
        this.context.fillStyle = 'rgba(0, 0, 0, 0.75)';
        const fullWidth = this.boardWidth * this.cellSize;
        const fullHeight = this.boardHeight * this.cellSize + (this.topOffset || 0);
        this.context.fillRect(0, 0, fullWidth, fullHeight);
        this.context.fillStyle = '#fff';
        this.context.font = '48px Arial';
        const text = 'Game Over';
        const centerX = fullWidth / 2;
        const centerY = fullHeight / 2;
        this.context.fillText(text, centerX - (this.context.measureText(text).width / 2), centerY - 12);
        this.context.font = `${Math.max(12, Math.floor(this.cellSize * 0.6))}px Arial`;
        const hint = 'Press Space to Restart';
        this.context.fillText(hint, centerX - (this.context.measureText(hint).width / 2), centerY + 28);
    }

    /* Leaderboard + UI helpers */
    _bindUI() {
        const modal = document.getElementById('nameModal');
        const input = document.getElementById('playerNameInput');
        const startBtn = document.getElementById('startBtn');
        const ghostToggle = document.getElementById('ghostBlockToggle');
        const hardModeToggle = document.getElementById('hardModeToggle');
        
        // Full leaderboard modal bindings
        const fullLeaderboardModal = document.getElementById('fullLeaderboardModal');
        const closeLeaderboardBtn = document.getElementById('closeLeaderboardBtn');
        const sidebarLeaderboards = document.querySelectorAll('.sidebar-leaderboard');

        // Handle clicks on both sidebar leaderboards
        sidebarLeaderboards.forEach(leaderboard => {
            leaderboard.addEventListener('click', () => {
                const mode = leaderboard.dataset.mode || 'normal';
                this.showFullLeaderboard(mode);
            });
        });

        if (closeLeaderboardBtn && fullLeaderboardModal) {
            closeLeaderboardBtn.addEventListener('click', () => {
                fullLeaderboardModal.classList.add('hidden');
            });
        }

        // Close on click outside
        if (fullLeaderboardModal) {
            fullLeaderboardModal.addEventListener('click', (e) => {
                if (e.target === fullLeaderboardModal) {
                    fullLeaderboardModal.classList.add('hidden');
                }
            });
        }

        // Leaderboard tab switching
        const leaderboardTabs = document.querySelectorAll('.leaderboard-tab');
        leaderboardTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const mode = tab.dataset.mode;
                this._switchLeaderboardTab(mode);
            });
        });

        // Load saved preferences
        const savedPrefs = this.loadPrefs();
        if (input && savedPrefs.name) input.value = savedPrefs.name;
        if (ghostToggle && savedPrefs.ghostBlock !== undefined) {
            ghostToggle.checked = savedPrefs.ghostBlock;
        }
        
        // Load hard mode from session storage
        const savedHardMode = sessionStorage.getItem(this.hardModeKey);
        if (hardModeToggle && savedHardMode !== null) {
            hardModeToggle.checked = savedHardMode === 'true';
        }

        if (startBtn && input && modal) {
            startBtn.addEventListener('click', () => {
                // Remove spaces from name
                let name = (input.value || 'Anonymous').trim().replace(/\s+/g, '');
                if (!name) name = 'Anonymous';
                
                this.playerName = name;
                
                if (ghostToggle) {
                    this.ghostBlockEnabled = ghostToggle.checked;
                }
                
                if (hardModeToggle) {
                    this.hardMode = hardModeToggle.checked;
                    // Save to session storage
                    sessionStorage.setItem(this.hardModeKey, this.hardMode.toString());
                }

                // Save preferences
                this.savePrefs({
                    name: this.playerName,
                    ghostBlock: this.ghostBlockEnabled
                });

                modal.classList.add('hidden');
                this.reset();
                this.renderLeaderboard();
                requestAnimationFrame((time) => this.update(time));
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') startBtn.click();
            });
        }
        // render existing leaderboard immediately
        this.renderLeaderboard();
    }

    _switchLeaderboardTab(mode) {
        const tabs = document.querySelectorAll('.leaderboard-tab');
        const normalTable = document.getElementById('fullLeaderboardTable');
        const hardTable = document.getElementById('fullLeaderboardTableHard');

        tabs.forEach(tab => {
            if (tab.dataset.mode === mode) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });

        if (mode === 'hard') {
            normalTable.classList.add('hidden');
            hardTable.classList.remove('hidden');
        } else {
            normalTable.classList.remove('hidden');
            hardTable.classList.add('hidden');
        }
    }

    loadPrefs() {
        try {
            const raw = localStorage.getItem(this.prefsKey);
            return raw ? JSON.parse(raw) : {};
        } catch (e) { return {}; }
    }

    savePrefs(prefs) {
        try { localStorage.setItem(this.prefsKey, JSON.stringify(prefs)); } catch (e) {}
    }

    showNameModal() {
        const modal = document.getElementById('nameModal');
        const input = document.getElementById('playerNameInput');
        if (!modal) { this.reset(); requestAnimationFrame((time) => this.update(time)); return; }
        
        // Pre-fill name from saved prefs if available
        const savedPrefs = this.loadPrefs();
        if (input && savedPrefs.name) {
            input.value = savedPrefs.name;
        } else if (input) {
            input.value = '';
        }

        modal.classList.remove('hidden');
        if (input) { input.focus(); }
    }

    loadLeaderboard(hardMode = false) {
        try {
            const key = hardMode ? this.leaderboardKey + '_hard' : this.leaderboardKey;
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : [];
        } catch (e) { return []; }
    }

    saveLeaderboard(list, hardMode = false) {
        try { 
            const key = hardMode ? this.leaderboardKey + '_hard' : this.leaderboardKey;
            localStorage.setItem(key, JSON.stringify(list)); 
        } catch (e) {}
    }

    addScore(name, score) {
        const list = this.loadLeaderboard(this.hardMode);
        const normalized = (name || 'Anonymous').trim();
        const key = normalized.toLowerCase();
        let found = false;
        for (let i = 0; i < list.length; i++) {
            if ((list[i].name || '').toLowerCase() === key) {
                found = true;
                // replace only if new score is higher
                if ((score || 0) > (list[i].score || 0)) {
                    list[i].score = score || 0;
                    list[i].date = Date.now();
                    // update stored name casing to the most recent submission
                    list[i].name = normalized;
                }
                break;
            }
        }
        if (!found) {
            list.push({ name: normalized, score: score || 0, date: Date.now() });
        }
        list.sort((a, b) => b.score - a.score);
        // keep top 10
        const top = list.slice(0, 10);
        this.saveLeaderboard(top, this.hardMode);
        this.renderLeaderboard();

        // also send to remote leaderboard if connected
        this._sendScoreToServer(normalized, score || 0);
    }

    renderLeaderboard() {
        // Render normal mode leaderboard
        const tbody = document.querySelector('#leaderboardTable tbody');
        if (tbody) {
            const list = this.loadLeaderboard(false);
            tbody.innerHTML = '';
            if (list.length === 0) {
                const tr = document.createElement('tr');
                const td = document.createElement('td'); td.colSpan = 3; td.style.textAlign = 'center'; td.textContent = 'No scores yet';
                tr.appendChild(td);
                tbody.appendChild(tr);
            } else {
                list.forEach((entry, index) => {
                    const tr = document.createElement('tr');
                    const rankTd = document.createElement('td'); rankTd.textContent = index + 1;
                    const nameTd = document.createElement('td'); nameTd.textContent = entry.name;
                    const scoreTd = document.createElement('td'); scoreTd.textContent = entry.score;
                    tr.appendChild(rankTd); tr.appendChild(nameTd); tr.appendChild(scoreTd);
                    tbody.appendChild(tr);
                });
            }
        }

        // Render hard mode leaderboard
        const tbodyHard = document.querySelector('#leaderboardTableHard tbody');
        if (tbodyHard) {
            const listHard = this.loadLeaderboard(true);
            tbodyHard.innerHTML = '';
            if (listHard.length === 0) {
                const tr = document.createElement('tr');
                const td = document.createElement('td'); td.colSpan = 3; td.style.textAlign = 'center'; td.textContent = 'No scores yet';
                tr.appendChild(td);
                tbodyHard.appendChild(tr);
            } else {
                listHard.forEach((entry, index) => {
                    const tr = document.createElement('tr');
                    const rankTd = document.createElement('td'); rankTd.textContent = index + 1;
                    const nameTd = document.createElement('td'); nameTd.textContent = entry.name;
                    const scoreTd = document.createElement('td'); scoreTd.textContent = entry.score;
                    tr.appendChild(rankTd); tr.appendChild(nameTd); tr.appendChild(scoreTd);
                    tbodyHard.appendChild(tr);
                });
            }
        }
    }

    showFullLeaderboard(mode = 'normal') {
        const modal = document.getElementById('fullLeaderboardModal');
        const tbody = document.querySelector('#fullLeaderboardTable tbody');
        const tbodyHard = document.querySelector('#fullLeaderboardTableHard tbody');
        if (!modal || !tbody || !tbodyHard) return;

        // Switch to the correct tab
        this._switchLeaderboardTab(mode);

        // Render normal mode full leaderboard
        const list = this.allScores
            .filter(entry => entry.score > 0)
            .sort((a, b) => b.score - a.score);

        tbody.innerHTML = '';
        
        if (list.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td'); 
            td.colSpan = 3; 
            td.style.textAlign = 'center'; 
            td.textContent = 'No scores yet';
            td.style.padding = '20px';
            td.style.color = '#6b7280';
            tr.appendChild(td);
            tbody.appendChild(tr);
        } else {
            list.forEach((entry, index) => {
                const tr = document.createElement('tr');
                const rankTd = document.createElement('td'); rankTd.textContent = index + 1;
                const nameTd = document.createElement('td'); nameTd.textContent = entry.name;
                const scoreTd = document.createElement('td'); scoreTd.textContent = entry.score;
                tr.appendChild(rankTd); tr.appendChild(nameTd); tr.appendChild(scoreTd);
                tbody.appendChild(tr);
            });
        }

        // Render hard mode full leaderboard
        const listHard = this.allScoresHard
            .filter(entry => entry.score > 0)
            .sort((a, b) => b.score - a.score);

        tbodyHard.innerHTML = '';
        
        if (listHard.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td'); 
            td.colSpan = 3; 
            td.style.textAlign = 'center'; 
            td.textContent = 'No scores yet';
            td.style.padding = '20px';
            td.style.color = '#6b7280';
            tr.appendChild(td);
            tbodyHard.appendChild(tr);
        } else {
            listHard.forEach((entry, index) => {
                const tr = document.createElement('tr');
                const rankTd = document.createElement('td'); rankTd.textContent = index + 1;
                const nameTd = document.createElement('td'); nameTd.textContent = entry.name;
                const scoreTd = document.createElement('td'); scoreTd.textContent = entry.score;
                tr.appendChild(rankTd); tr.appendChild(nameTd); tr.appendChild(scoreTd);
                tbodyHard.appendChild(tr);
            });
        }

        modal.classList.remove('hidden');
    }

    handleGameOver() {
        // save score under current player name
        this.addScore(this.playerName || 'Anonymous', this.score);
    }

    /* WebSocket leaderboard sync */
    _connectWebSocket() {
        try {
            this.ws = new WebSocket(this.wsUrl);
        } catch (e) {
            this.ws = null;
            return;
        }

        this.ws.addEventListener('open', () => {
            // ask server for current scores on connect
            try {
                this.ws.send(JSON.stringify({ type: 'sync' }));
            } catch (e) {}
        });

        this.ws.addEventListener('message', (event) => {
            if (!event.data) return;
            let payload;
            try {
                payload = JSON.parse(event.data);
            } catch (e) {
                return;
            }

            if (payload.type === 'session_started') {
                this.sessionId = payload.sessionId;
                return;
            }

            // expected shape: { names: [...], scores: [...], namesHard: [...], scoresHard: [...] }
            if (!payload || !Array.isArray(payload.names) || !Array.isArray(payload.scores)) return;

            // Parse normal mode scores
            const combined = [];
            const len = Math.min(payload.names.length, payload.scores.length);
            for (let i = 0; i < len; i++) {
                const name = (payload.names[i] || 'Anonymous').toString();
                const score = Number(payload.scores[i]) || 0;
                combined.push({ name, score, date: Date.now() });
            }

            // Parse hard mode scores
            const combinedHard = [];
            if (Array.isArray(payload.namesHard) && Array.isArray(payload.scoresHard)) {
                const lenHard = Math.min(payload.namesHard.length, payload.scoresHard.length);
                for (let i = 0; i < lenHard; i++) {
                    const name = (payload.namesHard[i] || 'Anonymous').toString();
                    const score = Number(payload.scoresHard[i]) || 0;
                    combinedHard.push({ name, score, date: Date.now() });
                }
            }

            // Update full leaderboard caches
            this.allScores = combined;
            this.allScoresHard = combinedHard;
            
            // If modal is open, refresh it live
            const modal = document.getElementById('fullLeaderboardModal');
            if (modal && !modal.classList.contains('hidden')) {
                // Get current active tab
                const activeTab = document.querySelector('.leaderboard-tab.active');
                const currentMode = activeTab ? activeTab.dataset.mode : 'normal';
                this.showFullLeaderboard(currentMode);
            }

            // merge remote list into local leaderboard (normal mode)
            const local = this.loadLeaderboard(false);
            const byKey = new Map();

            const upsert = (entry) => {
                const normName = (entry.name || 'Anonymous').trim();
                const key = normName.toLowerCase();
                const existing = byKey.get(key);
                if (!existing || (entry.score || 0) > (existing.score || 0)) {
                    byKey.set(key, { name: normName, score: entry.score || 0, date: entry.date || Date.now() });
                }
            };

            local.forEach(upsert);
            combined.forEach(upsert);

            const merged = Array.from(byKey.values());
            merged.sort((a, b) => b.score - a.score);
            const top = merged.slice(0, 10);
            this.saveLeaderboard(top, false);

            // merge remote list into local leaderboard (hard mode)
            const localHard = this.loadLeaderboard(true);
            const byKeyHard = new Map();

            const upsertHard = (entry) => {
                const normName = (entry.name || 'Anonymous').trim();
                const key = normName.toLowerCase();
                const existing = byKeyHard.get(key);
                if (!existing || (entry.score || 0) > (existing.score || 0)) {
                    byKeyHard.set(key, { name: normName, score: entry.score || 0, date: entry.date || Date.now() });
                }
            };

            localHard.forEach(upsertHard);
            combinedHard.forEach(upsertHard);

            const mergedHard = Array.from(byKeyHard.values());
            mergedHard.sort((a, b) => b.score - a.score);
            const topHard = mergedHard.slice(0, 10);
            this.saveLeaderboard(topHard, true);

            this.renderLeaderboard();
        });

        this.ws.addEventListener('close', () => {
            // try to reconnect after a delay
            this.ws = null;
            setTimeout(() => this._connectWebSocket(), 5000);
        });

        this.ws.addEventListener('error', () => {
            try { this.ws.close(); } catch (e) {}
        });
    }

    _sendScoreToServer(name, score) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const payload = { 
            type: 'submit_score',
            sessionId: this.sessionId,
            name: name || 'Anonymous', 
            score: score || 0,
            lines: this.linesCleared,
            hardMode: this.hardMode
        };
        try {
            this.ws.send(JSON.stringify(payload));
        } catch (e) {}
    }

    getColor(type) {
        const colors = {
            'I': '#22d3ee', // cyan
            'J': '#3b82f6', // blue
            'L': '#f97316', // orange
            'O': '#eab308', // yellow
            'S': '#22c55e', // green
            'T': '#a855f7', // purple
            'Z': '#ef4444'  // red
        };
        return colors[type] || '#000';
    }
}

class Piece {
    constructor(type) {
        this.type = type;
        this._rotation = 0;
        this.defineMatrices();
        this.rotation = 0;
        this.x = 0;
        this.y = 0;
    }

    defineMatrices() {
        this.matrices = {
            'I': [
                [[0, 0, 0, 0],
                 [1, 1, 1, 1],
                 [0, 0, 0, 0],
                 [0, 0, 0, 0]],
                [[0, 0, 1, 0],
                 [0, 0, 1, 0],
                 [0, 0, 1, 0],
                 [0, 0, 1, 0]]
            ],
            'J': [
                [[1, 0, 0],
                 [1, 1, 1],
                 [0, 0, 0]],
                [[0, 1, 1],
                 [0, 1, 0],
                 [0, 1, 0]],
                [[0, 0, 0],
                 [1, 1, 1],
                 [0, 0, 1]],
                [[0, 1, 0],
                 [0, 1, 0],
                 [1, 1, 0]]
            ],
            'L': [
                [[0, 0, 1],
                 [1, 1, 1],
                 [0, 0, 0]],
                [[0, 1, 0],
                 [0, 1, 0],
                 [0, 1, 1]],
                [[0, 0, 0],
                 [1, 1, 1],
                 [1, 0, 0]],
                [[1, 1, 0],
                 [0, 1, 0],
                 [0, 1, 0]]
            ],
            'O': [
                [[1, 1],
                 [1, 1]]
            ],
            'S': [
                [[0, 1, 1],
                 [1, 1, 0],
                 [0, 0, 0]],
                [[0, 1, 0],
                 [0, 1, 1],
                 [0, 0, 1]]
            ],
            'T': [
                [[0, 1, 0],
                 [1, 1, 1],
                 [0, 0, 0]],
                [[0, 1, 0],
                 [0, 1, 1],
                 [0, 1, 0]],
                [[0, 0, 0],
                 [1, 1, 1],
                 [0, 1, 0]],
                [[0, 1, 0],
                 [1, 1, 0],
                 [0, 1, 0]]
            ],
            'Z': [
                [[1, 1, 0],
                 [0, 1, 1],
                 [0, 0, 0]],
                [[0, 0, 1],
                 [0, 1, 1],
                 [0, 1, 0]]
            ]
        };

        if (!this.matrices[this.type]) {
            this.matrices[this.type] = [[[1]]];
        }
    }

    get rotation() {
        return this._rotation;
    }

    set rotation(value) {
        const states = this.matrices[this.type].length;
        this._rotation = ((value % states) + states) % states;
        this.matrix = this.matrices[this.type][this._rotation];
    }

    rotate() {
        this.rotation = this._rotation + 1;
    }

    setPosition(x, y) {
        this.x = x;
        this.y = y;
    }
}