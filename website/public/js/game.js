// ============================================
// TETRIS v3.0.0 - Territory Wars Edition
// Complete rewrite with multiplayer support
// ============================================

document.addEventListener("DOMContentLoaded", function() {
    const app = new TetrisApp();
    app.init();
});

// ============================================
// MAIN APPLICATION
// ============================================

class TetrisApp {
    constructor() {
        this.gameMode = null; // 'single' | 'multiplayer'
        this.singlePlayerGame = null;
        this.multiplayerGame = null;
        this.ws = null;
        this.wsUrl = 'wss://tetris-server.mjdawson.net:441';
        this.roomCode = null;
        this.playerId = null;
        this.isHost = false;
        this.players = [];
        this.captureGrid = [];
        
        // UI Elements
        this.mainMenuModal = document.getElementById('mainMenuModal');
        this.singlePlayerBtn = document.getElementById('singlePlayerBtn');
        this.multiplayerBtn = document.getElementById('multiplayerBtn');
        this.leaderboardBtn = document.getElementById('leaderboardBtn');
        
        // Sidebars
        this.singleSidebar = document.getElementById('sidebar');
        this.multiplayerSidebar = document.getElementById('multiplayerSidebar');
    }
    
    init() {
        this._connectWebSocket();
        this._bindMainMenu();
        this._bindSinglePlayer();
        this._bindMultiplayer();
        this._bindLeaderboard();
        this.showMainMenu();
    }
    
    // ============================================
    // WEBSOCKET CONNECTION
    // ============================================
    
    _connectWebSocket() {
        try {
            this.ws = new WebSocket(this.wsUrl);
        } catch (e) {
            console.error('WebSocket connection failed:', e);
            return;
        }
        
        this.ws.addEventListener('open', () => {
            console.log('Connected to server');
            // Request leaderboard sync
            this.ws.send(JSON.stringify({ type: 'sync' }));
        });
        
        this.ws.addEventListener('message', (event) => {
            this._handleServerMessage(event.data);
        });
        
        this.ws.addEventListener('close', () => {
            console.log('Disconnected from server');
            // Reconnect after delay
            setTimeout(() => this._connectWebSocket(), 5000);
        });
        
        this.ws.addEventListener('error', (error) => {
            console.error('WebSocket error:', error);
        });
    }
    
    _handleServerMessage(data) {
        let message;
        try {
            message = JSON.parse(data);
        } catch (e) {
            return;
        }
        
        switch (message.type) {
            case 'session_started':
                if (this.singlePlayerGame) {
                    this.singlePlayerGame.sessionId = message.sessionId;
                }
                break;
                
            // Leaderboard updates
            case 'names':
            case 'scores':
                this._updateLeaderboards(message);
                break;
                
            // Multiplayer room messages
            case 'room_created':
                this._onRoomCreated(message);
                break;
            case 'room_joined':
                this._onRoomJoined(message);
                break;
            case 'player_joined':
                this._onPlayerJoined(message);
                break;
            case 'player_left':
                this._onPlayerLeft(message);
                break;
            case 'game_started':
                this._onGameStarted(message);
                break;
            case 'grid_update':
                this._onGridUpdate(message);
                break;
            case 'player_eliminated':
                this._onPlayerEliminated(message);
                break;
            case 'game_over':
                this._onGameOver(message);
                break;
            case 'score_update':
                this._onScoreUpdate(message);
                break;
            case 'error':
                this._showError(message.message);
                break;
                
            // Legacy leaderboard format
            default:
                if (message.names && message.scores) {
                    this._updateLeaderboards(message);
                }
        }
    }
    
    // ============================================
    // MAIN MENU
    // ============================================
    
    _bindMainMenu() {
        this.singlePlayerBtn.addEventListener('click', () => {
            this.showSinglePlayerSetup();
        });
        
        this.multiplayerBtn.addEventListener('click', () => {
            this.showMultiplayerMenu();
        });
        
        this.leaderboardBtn.addEventListener('click', () => {
            this.showFullLeaderboard('normal');
        });
    }
    
    showMainMenu() {
        this._hideAllModals();
        this.mainMenuModal.classList.remove('hidden');
        
        // Reset game state
        this.gameMode = null;
        if (this.singlePlayerGame) {
            this.singlePlayerGame.cleanup();
            this.singlePlayerGame = null;
        }
        if (this.multiplayerGame) {
            this.multiplayerGame.cleanup();
            this.multiplayerGame = null;
        }
        
        // Show single player sidebar
        this.singleSidebar.classList.remove('hidden');
        if (this.multiplayerSidebar) {
            this.multiplayerSidebar.classList.add('hidden');
        }
    }
    
    _hideAllModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.add('hidden');
        });
    }
    
    // ============================================
    // SINGLE PLAYER MODE
    // ============================================
    
    _bindSinglePlayer() {
        const backBtn = document.getElementById('backToMenuFromSingle');
        const startBtn = document.getElementById('startBtn');
        const nameInput = document.getElementById('playerNameInput');
        
        backBtn.addEventListener('click', () => {
            this.showMainMenu();
        });
        
        startBtn.addEventListener('click', () => {
            this._startSinglePlayer();
        });
        
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') startBtn.click();
        });
    }
    
    showSinglePlayerSetup() {
        this._hideAllModals();
        document.getElementById('nameModal').classList.remove('hidden');
        
        // Load saved preferences
        const prefs = this._loadPrefs();
        const nameInput = document.getElementById('playerNameInput');
        if (nameInput && prefs.name) {
            nameInput.value = prefs.name;
        }
        nameInput.focus();
    }
    
    _startSinglePlayer() {
        const nameInput = document.getElementById('playerNameInput');
        const ghostToggle = document.getElementById('ghostBlockToggle');
        const hardModeToggle = document.getElementById('hardModeToggle');
        
        let name = (nameInput.value || 'Anonymous').trim().replace(/\s+/g, '');
        if (!name) name = 'Anonymous';
        
        const ghostEnabled = ghostToggle.checked;
        const hardMode = hardModeToggle.checked;
        
        // Save preferences
        this._savePrefs({ name, ghostBlock: ghostEnabled });
        
        this.gameMode = 'single';
        this._hideAllModals();
        
        // Create and start single player game
        this.singlePlayerGame = new SinglePlayerGame(this, name, ghostEnabled, hardMode);
        this.singlePlayerGame.start();
    }
    
    // ============================================
    // MULTIPLAYER MODE
    // ============================================
    
    _bindMultiplayer() {
        // Multiplayer menu
        const backFromMulti = document.getElementById('backToMenuFromMulti');
        const createRoomBtn = document.getElementById('createRoomBtn');
        const joinRoomBtn = document.getElementById('joinRoomBtn');
        
        backFromMulti.addEventListener('click', () => {
            this.showMainMenu();
        });
        
        createRoomBtn.addEventListener('click', () => {
            this.showCreateRoom();
        });
        
        joinRoomBtn.addEventListener('click', () => {
            this.showJoinRoom();
        });
        
        // Create room
        const backFromCreate = document.getElementById('backToMultiFromCreate');
        const confirmCreateBtn = document.getElementById('confirmCreateRoomBtn');
        const hostNameInput = document.getElementById('hostNameInput');
        
        backFromCreate.addEventListener('click', () => {
            this.showMultiplayerMenu();
        });
        
        confirmCreateBtn.addEventListener('click', () => {
            this._createRoom();
        });
        
        hostNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') confirmCreateBtn.click();
        });
        
        // Join room
        const backFromJoin = document.getElementById('backToMultiFromJoin');
        const confirmJoinBtn = document.getElementById('confirmJoinRoomBtn');
        const joinNameInput = document.getElementById('joinNameInput');
        const roomCodeInput = document.getElementById('roomCodeInput');
        
        backFromJoin.addEventListener('click', () => {
            this.showMultiplayerMenu();
        });
        
        confirmJoinBtn.addEventListener('click', () => {
            this._joinRoom();
        });
        
        joinNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') roomCodeInput.focus();
        });
        
        roomCodeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') confirmJoinBtn.click();
        });
        
        roomCodeInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase();
        });
        
        // Lobby
        const leaveRoomBtn = document.getElementById('leaveRoomBtn');
        const startMultiBtn = document.getElementById('startMultiplayerBtn');
        const lobbyRoomCode = document.getElementById('lobbyRoomCode');
        
        leaveRoomBtn.addEventListener('click', () => {
            this._leaveRoom();
        });
        
        startMultiBtn.addEventListener('click', () => {
            this._startMultiplayerGame();
        });
        
        lobbyRoomCode.addEventListener('click', () => {
            this._copyRoomCode();
        });
        
        // Results
        const playAgainBtn = document.getElementById('playAgainBtn');
        const backToMenuBtn = document.getElementById('backToMenuBtn');
        
        playAgainBtn.addEventListener('click', () => {
            this._leaveRoom();
            this.showMultiplayerMenu();
        });
        
        backToMenuBtn.addEventListener('click', () => {
            this._leaveRoom();
            this.showMainMenu();
        });
    }
    
    showMultiplayerMenu() {
        this._hideAllModals();
        document.getElementById('multiplayerMenuModal').classList.remove('hidden');
    }
    
    showCreateRoom() {
        this._hideAllModals();
        document.getElementById('createRoomModal').classList.remove('hidden');
        
        const prefs = this._loadPrefs();
        const hostNameInput = document.getElementById('hostNameInput');
        if (hostNameInput && prefs.name) {
            hostNameInput.value = prefs.name;
        }
        hostNameInput.focus();
        
        // Clear error
        document.getElementById('createRoomError').classList.add('hidden');
    }
    
    showJoinRoom() {
        this._hideAllModals();
        document.getElementById('joinRoomModal').classList.remove('hidden');
        
        const prefs = this._loadPrefs();
        const joinNameInput = document.getElementById('joinNameInput');
        if (joinNameInput && prefs.name) {
            joinNameInput.value = prefs.name;
        }
        joinNameInput.focus();
        
        // Clear error
        document.getElementById('joinRoomError').classList.add('hidden');
    }
    
    _createRoom() {
        const nameInput = document.getElementById('hostNameInput');
        let name = (nameInput.value || '').trim().replace(/\s+/g, '');
        
        if (!name) {
            this._showError('Please enter your name', 'createRoomError');
            return;
        }
        
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this._showError('Not connected to server', 'createRoomError');
            return;
        }
        
        this.ws.send(JSON.stringify({
            type: 'create_room',
            name: name
        }));
    }
    
    _joinRoom() {
        const nameInput = document.getElementById('joinNameInput');
        const codeInput = document.getElementById('roomCodeInput');
        
        let name = (nameInput.value || '').trim().replace(/\s+/g, '');
        let code = (codeInput.value || '').trim().toUpperCase();
        
        if (!name) {
            this._showError('Please enter your name', 'joinRoomError');
            return;
        }
        
        if (!code) {
            this._showError('Please enter room code', 'joinRoomError');
            return;
        }
        
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this._showError('Not connected to server', 'joinRoomError');
            return;
        }
        
        this.ws.send(JSON.stringify({
            type: 'join_room',
            name: name,
            roomCode: code
        }));
    }
    
    _leaveRoom() {
        if (this.roomCode && this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'leave_room' }));
        }
        
        this.roomCode = null;
        this.playerId = null;
        this.isHost = false;
        this.players = [];
    }
    
    _startMultiplayerGame() {
        if (!this.isHost) return;
        
        const hardModeToggle = document.getElementById('lobbyHardModeToggle');
        const hardMode = hardModeToggle.checked;
        
        this.ws.send(JSON.stringify({
            type: 'start_multiplayer',
            hardMode: hardMode
        }));
    }
    
    _copyRoomCode() {
        if (navigator.clipboard && this.roomCode) {
            navigator.clipboard.writeText(this.roomCode);
        }
    }
    
    // ============================================
    // MULTIPLAYER SERVER HANDLERS
    // ============================================
    
    _onRoomCreated(message) {
        this.roomCode = message.roomCode;
        this.playerId = message.playerId;
        this.isHost = message.isHost;
        this.players = message.players;
        
        this._showLobby();
    }
    
    _onRoomJoined(message) {
        this.roomCode = message.roomCode;
        this.playerId = message.playerId;
        this.isHost = message.isHost;
        this.players = message.players;
        
        this._showLobby();
    }
    
    _onPlayerJoined(message) {
        this.players = message.players;
        this._updateLobbyPlayers();
    }
    
    _onPlayerLeft(message) {
        this.players = message.players;
        
        if (message.newHostId === this.playerId) {
            this.isHost = true;
        }
        
        this._updateLobbyPlayers();
    }
    
    _onGameStarted(message) {
        this.players = message.players;
        this.captureGrid = message.captureGrid;
        const hardMode = message.hardMode;
        
        // Hide lobby, start game
        this._hideAllModals();
        
        // Switch to multiplayer sidebar
        this.singleSidebar.classList.add('hidden');
        if (this.multiplayerSidebar) {
            this.multiplayerSidebar.classList.remove('hidden');
        }
        
        // Create multiplayer game
        const myPlayer = this.players.find(p => p.id === this.playerId);
        this.multiplayerGame = new MultiplayerGame(this, myPlayer.name, hardMode, myPlayer.color, myPlayer.id);
        this.multiplayerGame.start();
    }
    
    _onGridUpdate(message) {
        this.captureGrid = message.captureGrid;
        this.players = message.players;
        
        if (this.multiplayerGame) {
            this.multiplayerGame.updateCaptureGrid(this.captureGrid, this.players);
        }
    }
    
    _onPlayerEliminated(message) {
        this.players = message.players;
        
        if (this.multiplayerGame) {
            this.multiplayerGame.updatePlayers(this.players);
        }
    }
    
    _onScoreUpdate(message) {
        if (this.multiplayerGame) {
            const player = this.players.find(p => p.id === message.playerId);
            if (player) {
                player.score = message.score;
                player.lines = message.lines;
                this.multiplayerGame.updatePlayers(this.players);
            }
        }
    }
    
    _onGameOver(message) {
        this.captureGrid = message.captureGrid;
        const rankings = message.rankings;
        const winner = message.winner;
        
        // Stop game
        if (this.multiplayerGame) {
            this.multiplayerGame.cleanup();
        }
        
        // Show results
        this._showResults(winner, rankings);
    }
    
    _showLobby() {
        this._hideAllModals();
        const lobbyModal = document.getElementById('roomLobbyModal');
        lobbyModal.classList.remove('hidden');
        
        // Display room code
        document.getElementById('lobbyRoomCode').textContent = this.roomCode;
        
        // Update player list
        this._updateLobbyPlayers();
        
        // Show/hide host options
        const hostOptions = document.getElementById('hostOptions');
        const waitingForHost = document.getElementById('waitingForHost');
        
        if (this.isHost) {
            hostOptions.classList.remove('hidden');
            waitingForHost.classList.add('hidden');
        } else {
            hostOptions.classList.add('hidden');
            waitingForHost.classList.remove('hidden');
        }
    }
    
    _updateLobbyPlayers() {
        const container = document.getElementById('playerListContainer');
        const countSpan = document.getElementById('playerCount');
        
        countSpan.textContent = this.players.length;
        container.innerHTML = '';
        
        this.players.forEach(player => {
            const item = document.createElement('div');
            item.className = 'player-item';
            
            const info = document.createElement('div');
            info.className = 'player-info';
            
            const avatar = document.createElement('div');
            avatar.className = 'player-avatar';
            avatar.style.background = player.color;
            avatar.textContent = player.name.charAt(0).toUpperCase();
            
            const name = document.createElement('div');
            name.className = 'player-name';
            name.textContent = player.name;
            
            info.appendChild(avatar);
            info.appendChild(name);
            
            if (player.isHost) {
                const badge = document.createElement('span');
                badge.className = 'player-badge';
                badge.textContent = 'HOST';
                info.appendChild(badge);
            }
            
            item.appendChild(info);
            container.appendChild(item);
        });
        
        // Enable/disable start button
        if (this.isHost) {
            const startBtn = document.getElementById('startMultiplayerBtn');
            if (this.players.length >= 2) {
                startBtn.disabled = false;
                startBtn.innerHTML = 'Start Game';
            } else {
                startBtn.disabled = true;
                startBtn.innerHTML = '<span class="waiting-dots">Waiting for players</span>';
            }
        }
    }
    
    _showResults(winner, rankings) {
        this._hideAllModals();
        const resultsModal = document.getElementById('resultsModal');
        resultsModal.classList.remove('hidden');
        
        // Winner announcement
        const announcement = document.getElementById('winnerAnnouncement');
        if (winner) {
            announcement.textContent = `${winner.name} wins!`;
            announcement.style.color = winner.color;
        } else {
            announcement.textContent = 'Game Over!';
        }
        
        // Podium (top 3) - Display order: 2nd, 1st, 3rd
        const podiumContainer = document.getElementById('podiumContainer');
        podiumContainer.innerHTML = '';
        
        const top3 = rankings.slice(0, 3);
        
        // Create podium in visual order: 2nd (left), 1st (center), 3rd (right)
        const displayOrder = [1, 0, 2]; // indices into top3 array
        const podiumClasses = ['second', 'first', 'third'];
        const podiumIcons = ['2️⃣', '1️⃣', '3️⃣'];
        
        displayOrder.forEach((rankIdx, displayIdx) => {
            if (rankIdx >= top3.length) return; // Skip if not enough players
            
            const player = top3[rankIdx];
            const place = document.createElement('div');
            place.className = `podium-place ${podiumClasses[displayIdx]}`;
            
            const avatar = document.createElement('div');
            avatar.className = 'podium-avatar';
            avatar.style.borderColor = player.color;
            avatar.textContent = player.name.charAt(0).toUpperCase();
            
            const name = document.createElement('div');
            name.className = 'podium-name';
            name.textContent = player.name;
            
            const score = document.createElement('div');
            score.className = 'podium-score';
            score.textContent = `${player.score} pts`;
            
            const stand = document.createElement('div');
            stand.className = 'podium-stand';
            stand.textContent = podiumIcons[displayIdx];
            
            place.appendChild(avatar);
            place.appendChild(name);
            place.appendChild(score);
            place.appendChild(stand);
            
            podiumContainer.appendChild(place);
        });
        
        // Full rankings
        const rankingsList = document.getElementById('rankingsList');
        rankingsList.innerHTML = '';
        
        rankings.forEach((player, idx) => {
            const item = document.createElement('div');
            item.className = 'ranking-item';
            
            const position = document.createElement('div');
            position.className = 'ranking-position';
            position.textContent = `#${idx + 1}`;
            
            const playerName = document.createElement('div');
            playerName.className = 'ranking-name';
            playerName.textContent = player.name;
            playerName.style.color = player.color;
            
            const playerScore = document.createElement('div');
            playerScore.className = 'ranking-score';
            playerScore.textContent = player.score;
            
            item.appendChild(position);
            item.appendChild(playerName);
            item.appendChild(playerScore);
            
            rankingsList.appendChild(item);
        });
    }
    
    // ============================================
    // LEADERBOARD
    // ============================================
    
    _bindLeaderboard() {
        const closeBtn = document.getElementById('closeLeaderboardBtn');
        const fullModal = document.getElementById('fullLeaderboardModal');
        const sidebarLeaderboards = document.querySelectorAll('.sidebar-leaderboard');
        const tabs = document.querySelectorAll('.leaderboard-tab');
        
        closeBtn.addEventListener('click', () => {
            fullModal.classList.add('hidden');
        });
        
        fullModal.addEventListener('click', (e) => {
            if (e.target === fullModal) {
                fullModal.classList.add('hidden');
            }
        });
        
        sidebarLeaderboards.forEach(leaderboard => {
            leaderboard.addEventListener('click', () => {
                const mode = leaderboard.dataset.mode || 'normal';
                this.showFullLeaderboard(mode);
            });
        });
        
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const mode = tab.dataset.mode;
                this._switchLeaderboardTab(mode);
            });
        });
    }
    
    showFullLeaderboard(mode = 'normal') {
        const modal = document.getElementById('fullLeaderboardModal');
        this._switchLeaderboardTab(mode);
        modal.classList.remove('hidden');
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
    
    _updateLeaderboards(message) {
        // Update sidebar leaderboards (top 10)
        this._renderSidebarLeaderboard(message.names || [], message.scores || [], false);
        this._renderSidebarLeaderboard(message.namesHard || [], message.scoresHard || [], true);
        
        // Update full leaderboards
        this._renderFullLeaderboard(message.names || [], message.scores || [], false);
        this._renderFullLeaderboard(message.namesHard || [], message.scoresHard || [], true);
    }
    
    _renderSidebarLeaderboard(names, scores, isHard) {
        const tableId = isHard ? 'leaderboardTableHard' : 'leaderboardTable';
        const tbody = document.querySelector(`#${tableId} tbody`);
        if (!tbody) return;
        
        tbody.innerHTML = '';
        
        const top10Names = names.slice(0, 10);
        const top10Scores = scores.slice(0, 10);
        
        if (top10Names.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 3;
            td.style.textAlign = 'center';
            td.textContent = 'No scores yet';
            tr.appendChild(td);
            tbody.appendChild(tr);
            return;
        }
        
        top10Names.forEach((name, idx) => {
            const tr = document.createElement('tr');
            
            const rankTd = document.createElement('td');
            rankTd.textContent = idx + 1;
            
            const nameTd = document.createElement('td');
            nameTd.textContent = name;
            
            const scoreTd = document.createElement('td');
            scoreTd.textContent = top10Scores[idx];
            
            tr.appendChild(rankTd);
            tr.appendChild(nameTd);
            tr.appendChild(scoreTd);
            tbody.appendChild(tr);
        });
    }
    
    _renderFullLeaderboard(names, scores, isHard) {
        const tableId = isHard ? 'fullLeaderboardTableHard' : 'fullLeaderboardTable';
        const tbody = document.querySelector(`#${tableId} tbody`);
        if (!tbody) return;
        
        tbody.innerHTML = '';
        
        if (names.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 3;
            td.style.textAlign = 'center';
            td.style.padding = '20px';
            td.style.color = '#6b7280';
            td.textContent = 'No scores yet';
            tr.appendChild(td);
            tbody.appendChild(tr);
            return;
        }
        
        names.forEach((name, idx) => {
            const tr = document.createElement('tr');
            
            const rankTd = document.createElement('td');
            rankTd.textContent = idx + 1;
            
            const nameTd = document.createElement('td');
            nameTd.textContent = name;
            
            const scoreTd = document.createElement('td');
            scoreTd.textContent = scores[idx];
            
            tr.appendChild(rankTd);
            tr.appendChild(nameTd);
            tr.appendChild(scoreTd);
            tbody.appendChild(tr);
        });
    }
    
    // ============================================
    // UTILITIES
    // ============================================
    
    _loadPrefs() {
        try {
            const raw = localStorage.getItem('tetris_prefs_v1');
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }
    
    _savePrefs(prefs) {
        try {
            localStorage.setItem('tetris_prefs_v1', JSON.stringify(prefs));
        } catch (e) {}
    }
    
    _showError(message, elementId = null) {
        if (elementId) {
            const errorEl = document.getElementById(elementId);
            if (errorEl) {
                errorEl.textContent = message;
                errorEl.classList.remove('hidden');
            }
        }
        console.error(message);
    }
}

// ============================================
// SINGLE PLAYER GAME
// ============================================

class SinglePlayerGame {
    constructor(app, playerName, ghostEnabled, hardMode) {
        this.app = app;
        this.canvas = document.getElementById('gameCanvas');
        this.context = this.canvas.getContext('2d');
        this.playerName = playerName;
        this.ghostBlockEnabled = ghostEnabled;
        this.hardMode = hardMode;
        
        this.boardWidth = 10;
        this.boardHeight = 22;
        this.cellSize = 28;
        this.topOffset = 14;
        
        this.board = this.createBoard();
        this.currentPiece = null;
        this.nextPiece = this.randomPiece();
        this.holdPiece = null;
        this.canHold = true;
        
        this.score = 0;
        this.level = hardMode ? 10 : 1;
        this.linesCleared = 0;
        this.gameOver = false;
        
        this.dropInterval = this.getDropInterval(this.level);
        this.lastDropTime = 0;
        this.startTime = null;
        this.elapsedTime = 0;
        
        this.lockDelay = 500;
        this.lockStartTime = null;
        this.lockResetCount = 0;
        this.maxLockResets = 15;
        
        this.sessionId = null;
        this.animationFrameId = null;
        
        this._onKey = this.handleKey.bind(this);
        
        this._fitCanvas();
        window.addEventListener('resize', () => this._fitCanvas());
    }
    
    start() {
        // Request session from server
        if (this.app.ws && this.app.ws.readyState === WebSocket.OPEN) {
            this.app.ws.send(JSON.stringify({ type: 'start_game' }));
        }
        
        document.addEventListener('keydown', this._onKey);
        this.reset();
        this.animationFrameId = requestAnimationFrame((time) => this.update(time));
    }
    
    cleanup() {
        document.removeEventListener('keydown', this._onKey);
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
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
        const speeds = [
            800, 717, 633, 550, 467, 383, 300, 217, 133, 100,
            83, 83, 83, 67, 67, 67, 50, 50, 50, 33
        ];
        if (level <= speeds.length) return speeds[level - 1];
        return level >= 29 ? 17 : 33;
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
    }
    
    update(time) {
        if (this.gameOver) {
            this.drawGameOver();
            return;
        }
        
        if (!this.lastDropTime) this.lastDropTime = time;
        if (this.startTime != null) {
            this.elapsedTime = Math.max(0, time - this.startTime);
        }
        
        const deltaTime = time - this.lastDropTime;
        
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
        this.animationFrameId = requestAnimationFrame((t) => this.update(t));
    }
    
    spawnNextPiece() {
        this.currentPiece = this.nextPiece;
        this.nextPiece = this.randomPiece();
        this.canHold = true;
        this.currentPiece.setPosition(Math.floor(this.boardWidth / 2) - 1, 0);
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
            this.lockStartTime = null;
            this.lockResetCount = 0;
        } else {
            if (this.lockStartTime === null) {
                this.lockStartTime = performance.now();
                this.lockResetCount = 0;
            }
        }
    }
    
    moveLeft() {
        if (this.validMove(this.currentPiece, -1, 0)) {
            this.currentPiece.x--;
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
        const orig = {
            rotation: piece.rotation,
            matrix: piece.matrix.map(row => row.slice()),
            x: piece.x,
            y: piece.y
        };
        
        piece.rotate();
        
        const isIPiece = piece.type === 'I';
        const kicks = isIPiece 
            ? [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1], [-1, -1], [1, -1]]
            : [[0, 0], [-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1], [0, 1]];
        
        for (const [dx, dy] of kicks) {
            if (this.validMove(piece, dx, dy)) {
                piece.x += dx;
                piece.y += dy;
                if (this.isGrounded()) {
                    this.resetLockTimer();
                } else {
                    this.lockStartTime = null;
                    this.lockResetCount = 0;
                }
                return;
            }
        }
        
        piece.rotation = orig.rotation;
        piece.matrix = orig.matrix;
        piece.x = orig.x;
        piece.y = orig.y;
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
        
        this.currentPiece.rotation = 0;
        this.currentPiece.setPosition(Math.floor(this.boardWidth / 2) - 1, 0);
        this.holdPiece.rotation = 0;
        
        this.lockStartTime = null;
        this.lockResetCount = 0;
        this.canHold = false;
        this.updateSidebar();
    }
    
    isGrounded() {
        return !this.validMove(this.currentPiece, 0, 1);
    }
    
    resetLockTimer() {
        if (this.lockStartTime !== null && this.lockResetCount < this.maxLockResets) {
            this.lockStartTime = performance.now();
            this.lockResetCount++;
        }
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
            const points = 100 * linesCleared * linesCleared;
            this.score += points;
            
            this.showScorePopup(points);
            
            if (this.linesCleared >= this.level * 10) {
                this.level++;
                this.dropInterval = this.getDropInterval(this.level);
            }
            
            this._sendScoreToServer();
        }
    }
    
    showScorePopup(text) {
        const container = document.getElementById('scorePopups');
        if (!container) return;
        
        const popup = document.createElement('div');
        popup.className = 'score-popup';
        // Support multi-line text
        if (typeof text === 'string' && text.includes('\n')) {
            popup.innerHTML = text.split('\n').map(line => `<div>${line}</div>`).join('');
        } else {
            popup.textContent = typeof text === 'number' ? `+${text}` : text;
        }
        popup.style.left = '50%';
        popup.style.top = '40%';
        popup.style.transform = 'translate(-50%, -50%)';
        
        container.appendChild(popup);
        
        setTimeout(() => {
            if (popup.parentNode) popup.parentNode.removeChild(popup);
        }, 1500);
    }
    
    handleKey(event) {
        if (this.gameOver) {
            if (event.key === ' ') {
                this.reset();
                this.startTime = performance.now();
                this.animationFrameId = requestAnimationFrame((t) => this.update(t));
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
                event.preventDefault();
                while (this.validMove(this.currentPiece, 0, 1)) {
                    this.currentPiece.y++;
                }
                this.lockPiece();
                this.clearLines();
                this.spawnNextPiece();
                this.lockStartTime = null;
                break;
        }
    }
    
    draw() {
        this.context.clearRect(0, 0, this.boardWidth * this.cellSize, this.boardHeight * this.cellSize + this.topOffset);
        this.context.save();
        this.context.translate(0, this.topOffset);
        this.drawBoard();
        
        if (this.currentPiece) {
            if (this.ghostBlockEnabled) {
                this.drawGhostPiece();
            }
            this.drawPiece(this.currentPiece);
        }
        
        this.updateSidebar();
        this.context.restore();
    }
    
    drawGhostPiece() {
        const ghost = new Piece(this.currentPiece.type);
        ghost.matrix = this.currentPiece.matrix;
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
        this.context.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        for (let y = 0; y < this.boardHeight; y++) {
            for (let x = 0; x < this.boardWidth; x++) {
                this.context.strokeRect(x * this.cellSize, y * this.cellSize, this.cellSize, this.cellSize);
                if (this.board[y][x]) {
                    this.context.fillStyle = this.getColor(this.board[y][x]);
                    this.context.fillRect(x * this.cellSize, y * this.cellSize, this.cellSize, this.cellSize);
                    this.context.strokeStyle = 'rgba(0, 0, 0, 0.3)';
                    this.context.strokeRect(x * this.cellSize, y * this.cellSize, this.cellSize, this.cellSize);
                    this.context.strokeStyle = 'rgba(255, 255, 255, 0.1)';
                }
            }
        }
    }
    
    drawPiece(piece) {
        this.context.fillStyle = this.getColor(piece.type);
        for (let y = 0; y < piece.matrix.length; y++) {
            for (let x = 0; x < piece.matrix[y].length; x++) {
                if (piece.matrix[y][x]) {
                    const drawX = (piece.x + x) * this.cellSize;
                    const drawY = (piece.y + y) * this.cellSize;
                    this.context.fillRect(drawX, drawY, this.cellSize, this.cellSize);
                    this.context.strokeStyle = 'rgba(0, 0, 0, 0.3)';
                    this.context.strokeRect(drawX, drawY, this.cellSize, this.cellSize);
                }
            }
        }
    }
    
    drawGameOver() {
        this.context.fillStyle = 'rgba(0, 0, 0, 0.85)';
        const fullWidth = this.boardWidth * this.cellSize;
        const fullHeight = this.boardHeight * this.cellSize + this.topOffset;
        this.context.fillRect(0, 0, fullWidth, fullHeight);
        
        this.context.fillStyle = '#fff';
        this.context.font = 'bold 42px -apple-system, sans-serif';
        const text = 'Game Over';
        const centerX = fullWidth / 2;
        const centerY = fullHeight / 2;
        this.context.fillText(text, centerX - (this.context.measureText(text).width / 2), centerY - 20);
        
        this.context.font = '16px -apple-system, sans-serif';
        this.context.fillStyle = '#98989d';
        const hint = 'Press Space to Restart';
        this.context.fillText(hint, centerX - (this.context.measureText(hint).width / 2), centerY + 20);
    }
    
    updateSidebar() {
        document.getElementById('statPlayer').textContent = this.playerName || '—';
        document.getElementById('statScore').textContent = this.score;
        document.getElementById('statLevel').textContent = this.level;
        document.getElementById('statLines').textContent = this.linesCleared;
        document.getElementById('statTime').textContent = this._formatTime(this.elapsedTime);
        
        this.renderPiecePreview('nextPiecePreview', this.nextPiece);
        this.renderPiecePreview('holdPiecePreview', this.holdPiece);
    }
    
    renderPiecePreview(elementId, piece) {
        const preview = document.getElementById(elementId);
        if (!preview) return;
        
        preview.innerHTML = '';
        if (piece) {
            const grid = document.createElement('div');
            grid.className = 'next-piece-grid';
            const color = this.getColor(piece.type);
            const matrix = piece.matrix;
            for (let y = 0; y < 4; y++) {
                for (let x = 0; x < 4; x++) {
                    const cell = document.createElement('div');
                    cell.className = 'next-piece-cell';
                    const filled = matrix[y] && matrix[y][x];
                    if (filled) {
                        cell.style.background = color;
                        cell.style.boxShadow = `0 0 8px ${color}55`;
                    }
                    grid.appendChild(cell);
                }
            }
            preview.appendChild(grid);
        }
    }
    
    _formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    
    _fitCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const gameArea = document.getElementById('gameArea');
        if (!gameArea) return;
        
        const availableHeight = gameArea.clientHeight - 40;
        const availableWidth = gameArea.clientWidth - 40;
        
        const maxCellHeight = (availableHeight - this.topOffset) / this.boardHeight;
        const maxCellWidth = availableWidth / this.boardWidth;
        
        this.cellSize = Math.min(28, Math.floor(Math.min(maxCellHeight, maxCellWidth)));
        this.cellSize = Math.max(10, this.cellSize);
        
        const totalWidth = this.boardWidth * this.cellSize;
        const totalHeight = this.boardHeight * this.cellSize + this.topOffset;
        
        this.canvas.width = Math.floor(totalWidth * dpr);
        this.canvas.height = Math.floor(totalHeight * dpr);
        this.canvas.style.width = totalWidth + 'px';
        this.canvas.style.height = totalHeight + 'px';
        this.canvas.style.display = 'block';
        
        this.context.setTransform(1, 0, 0, 1, 0, 0);
        this.context.scale(dpr, dpr);
        
        if (this.board) {
            this.draw();
        }
    }
    
    _sendScoreToServer() {
        if (!this.app.ws || this.app.ws.readyState !== WebSocket.OPEN) return;
        if (!this.sessionId) return;
        
        this.app.ws.send(JSON.stringify({
            type: 'submit_score',
            sessionId: this.sessionId,
            name: this.playerName,
            score: this.score,
            lines: this.linesCleared,
            hardMode: this.hardMode
        }));
    }
    
    handleGameOver() {
        this._sendScoreToServer();
    }
    
    getColor(type) {
        const colors = {
            'I': '#22d3ee',
            'J': '#3b82f6',
            'L': '#f97316',
            'O': '#eab308',
            'S': '#22c55e',
            'T': '#a855f7',
            'Z': '#ef4444'
        };
        return colors[type] || '#000';
    }
}

// ============================================
// MULTIPLAYER GAME
// ============================================

class MultiplayerGame extends SinglePlayerGame {
    constructor(app, playerName, hardMode, playerColor, playerId) {
        super(app, playerName, true, hardMode);
        this.myTilesOwned = 0;
        this.playerColor = playerColor;
        this.myPlayerId = playerId;
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
            const points = 100 * linesCleared * linesCleared;
            this.score += points;
            
            // Show popup with capture info
            const clearType = linesCleared === 4 ? 'TETRIS!' : linesCleared === 3 ? 'TRIPLE!' : linesCleared === 2 ? 'DOUBLE!' : '';
            const popupText = clearType ? `${clearType}\n+${points}\n${linesCleared} tiles captured!` : `+${points}\n${linesCleared} tile captured`;
            this.showScorePopup(popupText);
            
            if (this.linesCleared >= this.level * 10) {
                this.level++;
                this.dropInterval = this.getDropInterval(this.level);
            }
            
            // Send line clear to server
            if (this.app.ws && this.app.ws.readyState === WebSocket.OPEN) {
                this.app.ws.send(JSON.stringify({
                    type: 'line_clear',
                    lines: linesCleared,
                    score: this.score
                }));
            }
        }
    }
    
    handleGameOver() {
        // Send elimination to server
        if (this.app.ws && this.app.ws.readyState === WebSocket.OPEN) {
            this.app.ws.send(JSON.stringify({
                type: 'player_eliminated',
                score: this.score
            }));
        }
    }
    
    updateSidebar() {
        document.getElementById('mpStatPlayer').textContent = this.playerName || '—';
        document.getElementById('mpStatScore').textContent = this.score;
        document.getElementById('mpStatLevel').textContent = this.level;
        document.getElementById('mpStatLines').textContent = this.linesCleared;
        document.getElementById('mpStatTiles').textContent = this.myTilesOwned;
        
        this.renderPiecePreview('mpNextPiecePreview', this.nextPiece);
        this.renderPiecePreview('mpHoldPiecePreview', this.holdPiece);
    }
    
    updateCaptureGrid(grid, players) {
        // Render capture grid
        const gridEl = document.getElementById('captureGrid');
        if (!gridEl) return;
        
        // Create cells if not exists
        if (gridEl.children.length === 0) {
            for (let i = 0; i < 100; i++) {
                const cell = document.createElement('div');
                cell.className = 'capture-cell';
                gridEl.appendChild(cell);
            }
        }
        
        // Update cells with better visual feedback
        for (let y = 0; y < 10; y++) {
            for (let x = 0; x < 10; x++) {
                const idx = y * 10 + x;
                const cell = gridEl.children[idx];
                const owner = grid[y][x];
                
                if (owner > 0) {
                    const player = players.find(p => p.id === owner);
                    if (player) {
                        cell.style.background = player.color;
                        cell.classList.add('captured');
                        
                        // Add glow effect for own tiles
                        if (player.id === this.app.playerId) {
                            cell.style.boxShadow = `0 0 8px ${player.color}, inset 0 0 4px ${player.color}`;
                            this.myTilesOwned = player.tilesOwned;
                        } else {
                            cell.style.boxShadow = `inset 0 0 2px rgba(0,0,0,0.3)`;
                        }
                    }
                } else {
                    cell.style.background = '';
                    cell.style.boxShadow = '';
                    cell.classList.remove('captured');
                }
            }
        }
        
        // Check if player lost all tiles
        const myPlayer = players.find(p => p.id === this.app.playerId);
        if (myPlayer && myPlayer.eliminated && !this.gameOver) {
            // Player was eliminated - stop their game
            this.gameOver = true;
            this.showScorePopup('ELIMINATED!\nAll tiles lost!');
            
            // Optionally draw a game over overlay
            setTimeout(() => {
                this.context.save();
                this.context.fillStyle = 'rgba(0, 0, 0, 0.75)';
                const fullWidth = this.boardWidth * this.cellSize;
                const fullHeight = this.boardHeight * this.cellSize + this.topOffset;
                this.context.fillRect(0, 0, fullWidth, fullHeight);
                
                this.context.fillStyle = '#ff453a';
                this.context.font = 'bold 36px -apple-system, sans-serif';
                const text = 'ELIMINATED';
                const centerX = fullWidth / 2;
                const centerY = fullHeight / 2;
                this.context.fillText(text, centerX - (this.context.measureText(text).width / 2), centerY - 10);
                
                this.context.font = '14px -apple-system, sans-serif';
                this.context.fillStyle = '#98989d';
                const hint = 'All tiles captured by opponents';
                this.context.fillText(hint, centerX - (this.context.measureText(hint).width / 2), centerY + 20);
                this.context.restore();
            }, 100);
        }
        
        this.updatePlayers(players);
    }
    
    updatePlayers(players) {
        const container = document.getElementById('opponentsContainer');
        if (!container) return;
        
        container.innerHTML = '';
        
        const opponents = players.filter(p => p.id !== this.app.playerId);
        
        opponents.forEach(opponent => {
            const card = document.createElement('div');
            card.className = 'sidebar-card opponent-preview';
            
            const header = document.createElement('div');
            header.className = 'opponent-header';
            
            const name = document.createElement('div');
            name.className = 'opponent-name';
            
            const dot = document.createElement('span');
            dot.className = `status-dot ${opponent.eliminated ? 'eliminated' : ''}`;
            
            const nameText = document.createTextNode(opponent.name);
            
            name.appendChild(dot);
            name.appendChild(nameText);
            
            const score = document.createElement('div');
            score.className = 'opponent-score';
            score.textContent = `${opponent.score} pts`;
            
            header.appendChild(name);
            header.appendChild(score);
            
            const stats = document.createElement('div');
            stats.style.fontSize = '11px';
            stats.style.color = '#636366';
            stats.style.marginTop = '4px';
            stats.textContent = `${opponent.tilesOwned} tiles captured`;
            
            card.appendChild(header);
            card.appendChild(stats);
            
            container.appendChild(card);
        });
    }
    
    getColor(type) {
        // Use player's capture grid color for all Tetris pieces
        return this.playerColor || '#0a84ff';
    }
}

// ============================================
// PIECE CLASS
// ============================================

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
                [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
                [[0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0]]
            ],
            'J': [
                [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
                [[0, 1, 1], [0, 1, 0], [0, 1, 0]],
                [[0, 0, 0], [1, 1, 1], [0, 0, 1]],
                [[0, 1, 0], [0, 1, 0], [1, 1, 0]]
            ],
            'L': [
                [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
                [[0, 1, 0], [0, 1, 0], [0, 1, 1]],
                [[0, 0, 0], [1, 1, 1], [1, 0, 0]],
                [[1, 1, 0], [0, 1, 0], [0, 1, 0]]
            ],
            'O': [
                [[1, 1], [1, 1]]
            ],
            'S': [
                [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
                [[0, 1, 0], [0, 1, 1], [0, 0, 1]]
            ],
            'T': [
                [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
                [[0, 1, 0], [0, 1, 1], [0, 1, 0]],
                [[0, 0, 0], [1, 1, 1], [0, 1, 0]],
                [[0, 1, 0], [1, 1, 0], [0, 1, 0]]
            ],
            'Z': [
                [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
                [[0, 0, 1], [0, 1, 1], [0, 1, 0]]
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
