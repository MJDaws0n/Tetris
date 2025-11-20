# Tetris

This is a simple Tetris game built with Neutralino.js.

## How to Run

1. Open a terminal and change into the `tetris` folder.

2. Download the official Neutralino v6.3.0 release archive from:

   https://github.com/neutralinojs/neutralinojs/releases/tag/v6.3.0

   Download the file named `neutralinojs-v6.3.0.zip` and extract it:
   ```sh
   curl -L -o neutralinojs-v6.3.0.zip "https://github.com/neutralinojs/neutralinojs/releases/download/v6.3.0/neutralinojs-v6.3.0.zip"
   unzip neutralinojs-v6.3.0.zip
   ```

3. Inside the extracted folder, find the binary for your platform (for example, `neutralino-mac_arm64` for Apple Silicon Macs, or `neutralino-linux_x64` for 64-bit Linux, etc.). Copy the correct binary into the `tetris` folder:

so it's good i just need it so that it insteasd asks for you're name when app starts, it ask every single new game, also a higher score with same name will override it, and it should not be case sensitive

   ```sh
   cp neutralinojs-v6.3.0/neutralino-mac_arm64 ./
   # or for your platform, e.g.:
   # cp neutralinojs-v6.3.0/neutralino-linux_x64 ./
   ```

4. Make the binary executable and run it from the `tetris` folder:

   ```sh
   chmod +x neutralino-*
   ./neutralino-mac_arm64   # or the correct filename for your platform
   ```

The game window should open automatically. If anything goes wrong, double-check you copied the right binary for your OS and that it sits next to the project files (not inside a subfolder).

---

Enjoy the game!
