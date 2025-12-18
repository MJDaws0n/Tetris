#!/bin/sh
# Entrypoint script to generate env-config.js for frontend

set -e


# Use environment variables directly (for Docker/K8s/Coolify)
game_version=${GAME_VERSION:-3.2.0}
ws_url=${WS_URL:-wss://tetris-server.mjdawson.net:441}

# Ensure public dir exists
mkdir -p /usr/local/apache2/htdocs

# Replace version and WS_URL in index.html and game.js
INDEX_HTML="/usr/local/apache2/htdocs/index.html"
GAME_JS="/usr/local/apache2/htdocs/js/game.js"

# Update version in index.html (for stylesheet and visible version)
if [ -f "$INDEX_HTML" ]; then
	sed -i "s/v=[0-9]\+\.[0-9]\+\.[0-9]\+/v=$game_version/g" "$INDEX_HTML"
	sed -i "s/Tetris by Max v[0-9]\+\.[0-9]\+\.[0-9]\+/Tetris by Max v$game_version/g" "$INDEX_HTML"
fi

# Update wsUrl and version in game.js
if [ -f "$GAME_JS" ]; then
	sed -i "s|this.wsUrl = '[^']*';|this.wsUrl = '$ws_url';|g" "$GAME_JS"
fi

# Start the actual web server (replace this with your real CMD)
exec "$@"
