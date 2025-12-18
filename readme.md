# Tetris
By MJDawson (and copilot)

Play online by visiting
https://tetris.mjdawson.net

## Play localy
You should use ws:// not ws://, the server hosts only a WS image, and a reverse proxy must be used to set it up to use wss. Cloudflare should work, however I use my own implementation called [ProxyDNSCache](https://github.com/mjdaws0n/ProxyDNSCache) for both the website, and the websocket.

To run just clone files, make changes then run 
```sh
cp .env.example .env
```
then for the life of you **CHANGE THE DEFAULT PASSWORDS**. In that same folder where the .env file is, run
```sh
docker compose up --build -d
```
to start the app. Then just visit localhost:8080 (or the port in .env) to acess your tetris game.

## Don't ruin the fun
**You may** use my live websockets ```wss://tetris-server.mjdawson.net``` or ```wss://tetris-server.mjdawson.net:441``` if you wish to only change the styles of the game (stylesheet / visuals of game), but please don't make changes to the javascript or functionality of the game then use my live websocket. I ask out of kindness that you don't do that, it ruins the fun and will require me to add confusing checks and authentiations to ensure only my host is using the websocket.