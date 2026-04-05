import? 'config.just'

plugin_id := "root-notes-view"

# Build the plugin and install it into the Obsidian vault
update vault:
    just build
    just install {{vault}}

# Compile TypeScript to main.js
build:
    npm run build

# Copy built artefacts to the Obsidian plugins directory
install vault:
    cp main.js manifest.json styles.css '{{vault}}/.obsidian/plugins/{{plugin_id}}/'
    @echo "Installed to {{vault}}/.obsidian/plugins/{{plugin_id}}/"
    @echo "Re-enable the plugin in Obsidian (Settings → Community plugins) if needed."

# Install npm dependencies
deps:
    npm install

# Watch mode for development
dev:
    npm run dev
