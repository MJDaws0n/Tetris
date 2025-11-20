# Tetris

This is a simple Tetris game built with Neutralino.js.

## How to Run

1. Open a terminal and change into the `tetris` folder.

2. Download the official Neutralino v6.3.0 release for your platform from:

   https://github.com/neutralinojs/neutralinojs/releases/tag/v6.3.0

   Pick the archive that matches your OS/architecture, extract it, and copy the appropriate `neutralino` binary into the `tetris` folder (the app expects the launcher next to the project files).

   Example (macOS, Apple Silicon):
   ```sh
   # download and extract (adjust URL/file as needed)
   curl -L -o neutralino.tar.gz "https://github.com/neutralinojs/neutralinojs/releases/download/v6.3.0/neutralino-mac_arm64.zip"
   unzip neutralino.tar.gz
   mv neutralino-mac_arm64 ./
   ```

3. Make the binary executable and run it from the `tetris` folder:

   ```sh
   chmod +x neutralino-*
   ./neutralino-mac_arm64   # replace with the correct filename for your platform
   ```

The game window should open automatically. If anything goes wrong, double-check you downloaded the matching binary for your OS and that it sits next to the project files (not buried inside `bin`).

---

Enjoy the game!
