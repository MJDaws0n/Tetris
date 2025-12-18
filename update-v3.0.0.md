# Tetris v3.0.0 - Major Update Plan

## Overview
This update introduces a complete visual redesign with Apple-inspired dark mode aesthetics and implements **Tetris: Territory Wars** multiplayer mode based on [GitHub Issue #2](https://github.com/MJDaws0n/Tetris/issues/2).

---

## 1. Visual Redesign (Apple Dark Mode Premium Theme)

### Color Palette
- **Background**: Deep blacks and grays (`#000000`, `#1c1c1e`, `#2c2c2e`, `#3a3a3c`)
- **Accent**: SF Pro-style blues (`#0a84ff`), greens (`#30d158`), purples (`#bf5af2`)
- **Text**: Pure white (`#ffffff`), secondary gray (`#98989d`)
- **Borders**: Subtle separators (`#38383a`)
- **Glassmorphism**: Blur effects with transparency

### Components to Restyle
1. **Body/Background**: Replace swirly gradients with subtle, clean dark gradient
2. **Header**: Minimal, with SF-style typography
3. **Modals**: Glassmorphism effect, rounded corners (14-16px), subtle shadows
4. **Buttons**: Pill-shaped, gradient fills, hover states with glow
5. **Checkboxes**: Custom iOS-style toggle switches
6. **Cards**: Subtle borders, refined shadows, consistent spacing
7. **Tables**: Clean lines, proper spacing, hover states
8. **Inputs**: Dark fields with subtle borders, focus rings
9. **Game Canvas**: Refined grid lines, modern block styling

### Typography
- System font stack prioritizing SF Pro
- Proper font weights and letter spacing
- Improved hierarchy

---

## 2. Multiplayer: Territory Wars Mode

### Core Concept (from GitHub Issue #2)
- Each player has their own isolated Tetris board
- Clearing lines captures tiles on a **shared 10x10 capture grid**
- Multi-line clears (double/triple/Tetris) capture connected chains
- Chains connecting to existing territory strengthen position
- Bigger clears can overwrite opponent territory
- **Win condition**: First to create a connected path from one side to the other

### Server Changes (`node-app/index.js`)

#### New Data Structures
```javascript
// Room management
const rooms = new Map(); // roomCode -> Room object

class Room {
  id: string
  code: string (6 chars)
  host: WebSocket
  hostName: string
  players: Map<WebSocket, PlayerInfo>
  state: 'lobby' | 'playing' | 'finished'
  hardMode: boolean
  captureGrid: 10x10 array (0 = empty, playerId = captured)
  winner: string | null
  rankings: PlayerRanking[]
}
```

#### New WebSocket Message Types
| Type | Direction | Purpose |
|------|-----------|---------|
| `create_room` | C→S | Host creates a new room |
| `room_created` | S→C | Returns room code |
| `join_room` | C→S | Player joins with code |
| `room_joined` | S→C | Confirms join + player list |
| `player_joined` | S→C | Broadcasts new player |
| `player_left` | S→C | Broadcasts player leaving |
| `start_game` | C→S | Host starts the game |
| `game_started` | S→C | Broadcasts game start |
| `line_clear` | C→S | Player cleared lines |
| `grid_update` | S→C | Broadcasts capture grid state |
| `player_eliminated` | S→C | Player game over |
| `game_over` | S→C | Game finished, winner announced |
| `leave_room` | C→S | Player leaves room |

#### Name Uniqueness
- Validate unique names within a room
- Return error if name already taken

### Client Changes (`website/public/game.js`)

#### New UI Screens
1. **Main Menu Screen**
   - "Single Player" button
   - "Multiplayer" button  
   - "Leaderboard" button

2. **Multiplayer Menu**
   - "Create Room" button
   - "Join Room" button (with code input)
   - Back button

3. **Room Lobby**
   - Room code display (copyable)
   - Player list with names
   - Hard Mode toggle (host only)
   - "Start Game" button (host only, requires 2+ players)
   - Leave button

4. **Multiplayer Game View**
   - Player's Tetris board (main)
   - Capture Grid visualization (prominent)
   - Mini boards showing opponents (optional/simplified)
   - Player list with status (alive/eliminated)

5. **Results/Podium Screen**
   - Podium visualization (1st, 2nd, 3rd)
   - Full rankings list
   - "Play Again" / "Back to Menu" buttons

#### Game Logic Additions
- Track line clears and send to server
- Receive and render capture grid updates
- Handle elimination state
- Territory capture logic (server-side calculation)

### Capture Grid Logic

#### Tile Placement
```javascript
// When player clears N lines:
// 1. Find available/opponent tiles
// 2. If N >= 2, try to place connected chain
// 3. If chain touches existing territory, prioritize connection
// 4. Can overwrite opponent tiles if clear size > their last clear at that position

// Win detection:
// Check if any player has connected path top-to-bottom OR left-to-right
```

---

## 3. Updated Start Screen Flow

### New Modal Structure
```
┌─────────────────────────────────────┐
│           🎮 TETRIS                 │
│                                     │
│    ┌─────────────────────────┐     │
│    │    SINGLE PLAYER        │     │
│    └─────────────────────────┘     │
│    ┌─────────────────────────┐     │
│    │    MULTIPLAYER          │     │
│    └─────────────────────────┘     │
│    ┌─────────────────────────┐     │
│    │    LEADERBOARD          │     │
│    └─────────────────────────┘     │
│                                     │
└─────────────────────────────────────┘
```

### Single Player Flow
```
Main Menu → Single Player → Name + Settings (Ghost/Hard) → Game
```

### Multiplayer Flow
```
Main Menu → Multiplayer → Create/Join
  │
  ├─ Create → Name Entry → Lobby (host) → Game → Results
  │
  └─ Join → Name + Code Entry → Lobby → Game → Results
```

---

## 4. Files to Modify

### `website/public/styles.css`
- Complete rewrite with Apple dark mode theme
- New component styles for multiplayer UI
- Custom toggle switches
- Glassmorphism modals
- Podium/results styling

### `website/public/index.html`
- New modal structures
- Multiplayer UI elements
- Capture grid container
- Results screen

### `website/public/game.js` (or `/js/game.js`)
- Game class extensions for multiplayer
- New UI state management
- WebSocket message handlers for rooms
- Capture grid rendering
- Results screen logic

### `node-app/index.js`
- Room management system
- New WebSocket handlers
- Capture grid logic
- Win detection algorithm
- Name uniqueness validation

---

## 5. Implementation Order

1. **Phase 1**: CSS Redesign (styles.css complete rewrite)
2. **Phase 2**: HTML Structure Updates (new modals, containers)
3. **Phase 3**: Server Multiplayer Logic (rooms, messages)
4. **Phase 4**: Client Multiplayer Logic (UI, game state)
5. **Phase 5**: Territory Wars Capture Grid
6. **Phase 6**: Results/Podium Screen
7. **Phase 7**: Testing & Polish

---

## 6. Technical Notes

### WebSocket Protocol Additions
All new messages follow existing JSON format:
```javascript
{ type: 'message_type', ...payload }
```

### State Management
- Client tracks: `gameMode`, `roomCode`, `isHost`, `players[]`, `captureGrid[][]`
- Server tracks: `rooms` Map with full game state

### Backward Compatibility
- Single player mode remains fully functional
- Existing leaderboard system preserved
- Multiplayer scores added to leaderboard

---

## Version Bump
- Update version in HTML title: "v3.0.0"
- Update CSS cache buster: `styles.css?=3.0.0`
- Update JS cache buster: `game.js?=3.0.0`
