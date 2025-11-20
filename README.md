# Tetris

A Tetris game built with [NeutralinoJS](https://neutralino.js.org/), which can be built into standalone executables for Windows, Linux, and macOS.

## Features

- Cross-platform desktop application
- Standalone executables (no installation required)
- Lightweight (~2-3 MB per executable)
- Native performance

## Quick Start

### Running Pre-built Executables

If you have the pre-built executables, simply:

1. Make sure both the executable and `resources.neu` are in the same directory
2. Run the executable:
   - **Windows**: Double-click `tetris-win_x64.exe`
   - **Linux/macOS**: `chmod +x tetris-[platform] && ./tetris-[platform]`

### Building from Source

See [BUILD.md](BUILD.md) for detailed build instructions.

Quick build:
```bash
npm install
npm run build
```

Executables will be generated in `tetris/dist/tetris/`

## Development

To run in development mode:
```bash
cd tetris
neu run
```

## Technology

Built with:
- [NeutralinoJS](https://neutralino.js.org/) - Lightweight cross-platform desktop app framework
- HTML5, CSS3, JavaScript

## License

ISC

## Author

mjdawson
