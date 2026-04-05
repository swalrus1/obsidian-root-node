import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			// Replace the real Obsidian bundle with a lightweight test stub.
			obsidian: path.resolve(__dirname, "test/mock-obsidian.ts"),
		},
	},
	test: {
		environment: "node",
	},
});
