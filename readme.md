# Tetris
By MJDawson (and copilot)

Play online by visiting
https://tetris.mjdawson.net

## Play localy
The backend of this code does NOT nativly pull the correct websocket server by default. This is as a certifcate is required and on the server the game is hosted on, an reverse proxy is used to host the game. If you wish to spin up your own version, you must edit the websocket connection manually in the file.

This is because I couldn't be bothered to set it up to pull from the .env file as I am lazy.

Edit the ./website/pubic/game.js file and change the url on this line to say what you wish for it to be
```js
this.wsUrl = 'wss://tetris-server.mjdawson.net:441';
```
If using localy, you should use ws:// not ws://, the server hosts only a WS image, and a reverse proxy must be used to set it up to use wss. Cloudflare should work, however I use my own implementation called [ProxyDNSCache](https://github.com/mjdaws0n/ProxyDNSCache) for both the website, and the websocket.

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