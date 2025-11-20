document.addEventListener("DOMContentLoaded", function() {
    const game = new Game('gameCanvas');
    game.start();
});

class Game {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.context = this.canvas.getContext('2d');
        this.boardWidth = 10;
        this.boardHeight = 20;
        this.cellSize = 30;
        // UI area to the right of the playfield (pixels)
        this.uiWidth = 150;
        // extra space at the top so the playfield isn't cut off
        this.topOffset = 10;
        // make canvas match the logical board size and scale for HiDPI screens
        this._fitCanvas();
        this.board = this.createBoard();
        this.currentPiece = null;
        this.nextPiece = this.randomPiece();
        this.score = 0;
        this.level = 1;
        this.linesCleared = 0;
        this.gameOver = false;
        this.dropInterval = 1000; // Initial drop interval in ms
        this.lastDropTime = 0;

        this._onKey = this.handleKey.bind(this);
        document.addEventListener('keydown', this._onKey);
    }

    _fitCanvas() {
        const totalWidth = this.boardWidth * this.cellSize + this.uiWidth;
        const totalHeight = this.boardHeight * this.cellSize + (this.topOffset || 0);
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.floor(totalWidth * dpr);
        this.canvas.height = Math.floor(totalHeight * dpr);
        this.canvas.style.width = totalWidth + 'px';
        this.canvas.style.height = totalHeight + 'px';
        this.canvas.style.display = 'block';
        this.context.setTransform(1, 0, 0, 1, 0, 0);
        this.context.scale(dpr, dpr);
    }

    createBoard() {
        return Array.from({ length: this.boardHeight }, () => Array(this.boardWidth).fill(0));
    }

    randomPiece() {
        const pieces = 'IJLOSTZ';
        const type = pieces[Math.floor(Math.random() * pieces.length)];
        return new Piece(type);
    }

    start() {
        this.reset();
        requestAnimationFrame((time) => this.update(time));
    }

    reset() {
        this.board = this.createBoard();
        this.currentPiece = this.nextPiece;
        this.nextPiece = this.randomPiece();
        this.currentPiece.setPosition(Math.floor(this.boardWidth / 2) - 1, 0);
        this.score = 0;
        this.level = 1;
        this.linesCleared = 0;
        this.gameOver = false;
        this.dropInterval = 1000;
        this.lastDropTime = 0;
    }

    update(time) {
        if (this.gameOver) {
            this.drawGameOver();
            return;
        }

        if (!this.lastDropTime) {
            this.lastDropTime = time;
        }

        const deltaTime = time - this.lastDropTime;

        if (deltaTime > this.dropInterval) {
            this.lastDropTime = time;
            this.moveDown();
        }

        this.draw();
        requestAnimationFrame((time) => this.update(time));
    }

    moveDown() {
        if (this.validMove(this.currentPiece, 0, 1)) {
            this.currentPiece.y++;
        } else {
            this.lockPiece();
            this.clearLines();
            this.currentPiece = this.nextPiece;
            this.nextPiece = this.randomPiece();
            this.currentPiece.setPosition(Math.floor(this.boardWidth / 2) - 1, 0);
            if (!this.validMove(this.currentPiece, 0, 0)) {
                this.gameOver = true;
            }
        }
    }

    moveLeft() {
        if (this.validMove(this.currentPiece, -1, 0)) {
            this.currentPiece.x--;
        }
    }

    moveRight() {
        if (this.validMove(this.currentPiece, 1, 0)) {
            this.currentPiece.x++;
        }
    }

    rotate() {
        const originalRotation = this.currentPiece.rotation;
        this.currentPiece.rotate();
        if (!this.validMove(this.currentPiece, 0, 0)) {
            this.currentPiece.rotation = originalRotation;
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
            this.score += linesCleared * 100;
            if (this.linesCleared >= this.level * 10) {
                this.level++;
                this.dropInterval *= 0.9;
            }
        }
    }

    handleKey(event) {
        if (this.gameOver) {
            if (event.key === ' ') {
                this.reset();
                requestAnimationFrame((time) => this.update(time));
            }
            return;
        }
        switch (event.key) {
            case 'ArrowLeft':
                this.moveLeft();
                break;
            case 'ArrowRight':
                this.moveRight();
                break;
            case 'ArrowDown':
                this.moveDown();
                break;
            case 'ArrowUp':
                this.rotate();
                break;
            case ' ':
                while (this.validMove(this.currentPiece, 0, 1)) {
                    this.currentPiece.y++;
                }
                this.moveDown();
                break;
        }
    }

    draw() {
        this.context.clearRect(0, 0, this.boardWidth * this.cellSize + this.uiWidth, this.boardHeight * this.cellSize + (this.topOffset || 0));
        this.context.save();
        this.context.translate(0, this.topOffset || 0);
        this.drawBoard();
        if (this.currentPiece) this.drawPiece(this.currentPiece);
        if (this.nextPiece) this.drawNextPiece();
        this.drawScore();
        this.context.restore();
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

    drawNextPiece() {
    const offsetX = this.boardWidth * this.cellSize + 20;
        const offsetY = 20;
        this.context.fillStyle = '#000';
        this.context.font = `${Math.max(12, Math.floor(this.cellSize * 0.6))}px Arial`;
        this.context.fillText('Next:', offsetX, offsetY - 10);
        for (let y = 0; y < this.nextPiece.matrix.length; y++) {
            for (let x = 0; x < this.nextPiece.matrix[y].length; x++) {
                if (this.nextPiece.matrix[y][x]) {
                    const drawX = offsetX + x * this.cellSize;
                    const drawY = offsetY + y * this.cellSize;
                    this.context.fillStyle = this.getColor(this.nextPiece.type);
                    this.context.fillRect(drawX, drawY, this.cellSize, this.cellSize);
                    this.context.strokeRect(drawX, drawY, this.cellSize, this.cellSize);
                }
            }
        }
    }

    drawScore() {
    const offsetX = this.boardWidth * this.cellSize + 20;
        const offsetY = 150;
        this.context.fillStyle = '#000';
        this.context.font = `${Math.max(12, Math.floor(this.cellSize * 0.6))}px Arial`;
        this.context.fillText(`Score: ${this.score}`, offsetX, offsetY);
        this.context.fillText(`Level: ${this.level}`, offsetX, offsetY + 22);
        this.context.fillText(`Lines: ${this.linesCleared}`, offsetX, offsetY + 44);
    }

    drawGameOver() {
        this.context.fillStyle = 'rgba(0, 0, 0, 0.75)';
        const fullWidth = this.boardWidth * this.cellSize + this.uiWidth;
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

    getColor(type) {
        const colors = {
            'I': '#00f0f0',
            'J': '#0000f0',
            'L': '#f0a000',
            'O': '#f0f000',
            'S': '#00f000',
            'T': '#a000f0',
            'Z': '#f00000'
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