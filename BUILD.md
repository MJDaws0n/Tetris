# Building Tetris Executable

This guide explains how to build the Tetris application into standalone executable files for Windows, Linux, and macOS.

## Prerequisites

Before building, you need to have the following installed:
- [Node.js](https://nodejs.org/) (version 14 or higher)
- npm (comes with Node.js)

## Quick Build

The easiest way to build the executables:

```bash
# Install dependencies (only needed once)
npm install

# Build executables for all platforms
npm run build
```

This will:
1. Update the Neutralinojs binaries and client library
2. Build the application
3. Generate executables in `tetris/dist/tetris/` directory

## Step-by-Step Build Process

If you prefer to build step by step or encounter issues:

### 1. Install Dependencies

```bash
npm install
```

### 2. Install Neutralinojs CLI (if not already installed)

```bash
npm install -g @neutralinojs/neu
```

### 3. Update Neutralinojs Components

```bash
npm run build:update
```

Or manually:
```bash
cd tetris
neu update
```

This downloads the latest Neutralinojs binaries and client library.

### 4. Build the Application

```bash
npm run build:exe
```

Or manually:
```bash
cd tetris
neu build
```

## Output

After building, you'll find the executables in the `tetris/dist/tetris/` directory:

- **Windows**: `tetris-win_x64.exe` (~2.6 MB)
- **Linux x64**: `tetris-linux_x64` (~1.7 MB)
- **Linux ARM64**: `tetris-linux_arm64` (~1.8 MB)
- **Linux ARMhf**: `tetris-linux_armhf` (~1.4 MB)
- **macOS x64**: `tetris-mac_x64` (~2.3 MB)
- **macOS ARM64**: `tetris-mac_arm64` (~2.2 MB)
- **macOS Universal**: `tetris-mac_universal` (~4.5 MB)
- **Resources**: `resources.neu` (application resources bundle)

## Running the Executable

### Windows
Double-click `tetris-win_x64.exe` or run from command line:
```cmd
tetris-win_x64.exe
```

### Linux / macOS
Make the file executable (if needed) and run:
```bash
chmod +x tetris-linux_x64  # or appropriate binary name
./tetris-linux_x64
```

## Distribution

To distribute your application:

1. Copy the appropriate executable for your target platform from `tetris/dist/tetris/`
2. Include the `resources.neu` file in the same directory as the executable
3. Both files must be in the same directory for the application to run

For example, for Windows distribution:
```
tetris/
  ├── tetris-win_x64.exe
  └── resources.neu
```

## Troubleshooting

### Build fails with "neu: command not found"
Install the Neutralinojs CLI globally:
```bash
npm install -g @neutralinojs/neu
```

### Missing neutralino.js error
Run the update command before building:
```bash
cd tetris
neu update
```

### Executable doesn't run
Make sure both the executable and `resources.neu` are in the same directory.

## Advanced Configuration

The build configuration is stored in `tetris/neutralino.config.json`. You can modify:
- Window size and properties
- Application name and icon
- Native API permissions
- And more

See the [Neutralinojs documentation](https://neutralino.js.org/docs/configuration/neutralino.config.json) for details.

## Development

To run the application in development mode without building:
```bash
cd tetris
neu run
```

This starts a development server and opens the application.

## More Information

- [Neutralinojs Documentation](https://neutralino.js.org/docs)
- [Neutralinojs Distribution Guide](https://neutralino.js.org/docs/distribution/overview)
