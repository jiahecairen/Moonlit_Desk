# Native menu bar application

From the project root, run npm ci and npm run build:mac.
Open Moonlit Desk.app and choose a Hexo project using the menu.

The app reads project settings from the user's Application Support directory.
The editor and its JavaScript dependencies are bundled into the application
resources. It uses an installed Node.js runtime.

LauncherFeature provides menuItems() and shutdown() hooks for additional
features. EditorFeature launches the local editor. HexoServer manages a Node
process and BackupService creates deduplicated ZIP snapshots.

Read the project [README](../README.md) for configuration, backup, and publishing
details.
