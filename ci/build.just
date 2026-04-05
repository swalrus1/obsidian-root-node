import 'config.just'

plugin_id := "root-notes-view"
plugin_dir := vault / ".obsidian/plugins" / plugin_id

# Build the plugin and install it into the Obsidian vault
update: build install

# Compile TypeScript to main.js
build:
    npm run build

# Copy built artefacts to the Obsidian plugins directory
install:
    mkdir -p {{plugin_dir}}
    cp main.js manifest.json styles.css {{plugin_dir}}/
    @echo "Installed to {{plugin_dir}}"
    @echo "Re-enable the plugin in Obsidian (Settings → Community plugins) if needed."

# Install npm dependencies
deps:
    npm install

# Watch mode for development
dev:
    npm run dev
