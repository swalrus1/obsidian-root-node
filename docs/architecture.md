# Plugin Architecture

All source code is in `src/main.ts`. Styles are in `styles.css`.
Built with esbuild; output is `main.js` (single CommonJS bundle).

---

## Entry point: `RootNotesPlugin`

`export default class RootNotesPlugin extends Plugin`

Owns all lifecycle, event registration, and cross-component state.

**Responsibilities:**
- Registers both view types (`root-notes-view`, `thread-view`) on load.
- Registers the ribbon icon and all three commands.
- Owns the in-memory title map (`titleMap: Map<string, string>`).
- Calls `rebuildTitleMap()` on the events that invalidate it.
- Calls `refreshRootNotesView()` to repaint the sidebar after a rebuild.
- Exposes `openThreadView(file: TFile)` so other components can open a thread tab.
- Detaches both view types on unload.

**Events that trigger index rebuild:**
- `metadataCache.on("resolved")` — fires after all pending file metadata is processed; covers creates, edits.
- `vault.on("delete")` and `vault.on("rename")` — structural changes not guaranteed to fire `resolved`.
- `workspace.on("dataview:index-ready")` — fires when the Dataview plugin finishes loading; enables thread-based titles if Dataview was not yet active at startup.
- `workspace.onLayoutReady` — initial build at startup.

---

## Component: Sidebar (`RootNotesView`)

`class RootNotesView extends ItemView` — view type `root-notes-view`

Opened in the right leaf on startup and via the "Open Root Notes View" command.

**Render cycle** (called by `refreshRootNotesView()` and `onOpen`):
1. Calls `computeGraph(app)` to get `rootNodes`, `cycleNodes`, `outLinks`, `inLinks`.
2. Calls `getDataviewApi(app)` for the Dataview handle (may be null).
3. For each node path, calls `computeTitle(...)` → falls back to `file.basename`.
4. Renders an `<ul>` where each `<li>` contains:
   - A clickable `<a>` that opens the note in the current leaf.
   - A `↺` span for cycle nodes.
   - A thread-view button (list-lines SVG icon) that calls `plugin.openThreadView(file)`. The button is hidden via CSS and revealed on `li:hover`.

`render()` does **not** touch `plugin.titleMap` — that is the plugin's responsibility.

---

## Component: Thread View (`ThreadView`)

`class ThreadView extends ItemView` — view type `thread-view`

Opened as a new tab via `plugin.openThreadView(file)` or the "Show thread view" command (requires an active file). Multiple thread tabs can coexist.

**State:** `rootPath: string | null` — persisted via `getState()`/`setState()`, so the tab survives Obsidian restarts.

**Render cycle** (async, called from `setState` and `onOpen`):
1. Calls `buildLinkMaps(app)` to get `outLinks`.
2. BFS from `rootPath` over `outLinks` to collect the full subtree (set of paths).
3. Resolves each path to a `TFile`; sorts by `TFile.stat.ctime` descending (newest first).
4. For each file:
   - Creates a `div.thread-section` with an `h2.thread-note-title`.
   - The `h2` contains a clickable `<a>` that opens the note.
   - Reads file content with `vault.read(file)`.
   - Renders markdown with `MarkdownRenderer.render(app, content, el, sourcePath, this)`.

The view is read-only by design (no editor, no CodeMirror). Tab title is `Thread: <basename>`.

---

## Component: In-Memory Title Map

`plugin.titleMap: Map<string, string>` — maps display title → file path.

Populated exclusively by `plugin.rebuildTitleMap()`, which:
1. Calls `computeGraph(app)` to get all root and cycle node paths.
2. For each path, resolves to a `TFile` and calls `computeTitle(...)` (Dataview-aware).
3. Falls back to `file.basename` when `computeTitle` returns null.

Consumed by:
- `RootNotesSuggestModal` (fuzzy search for "Insert root note reference" command).
- `render()` in `RootNotesView` does **not** use it; it calls `computeTitle` directly so the sidebar always shows fresh data.

Collision semantics: if two root notes resolve to the same display title, the second one silently overwrites the first in the map. This is a known limitation of the prototype.

---

## Component: Fuzzy-Search Modal (`RootNotesSuggestModal`)

`class RootNotesSuggestModal extends FuzzySuggestModal<TitleEntry>`

Opened by the "Insert root note reference" command (editor callback — only active when an editor is focused).

Snapshots `plugin.titleMap` at construction time into a `TitleEntry[]` array. On item selection, inserts `[[basename]]` at the editor cursor via `editor.replaceSelection`.

---

## Graph Computation

Two pure functions operating on `App`:

### `buildLinkMaps(app): LinkMaps`

Iterates `app.vault.getMarkdownFiles()` and `app.metadataCache.resolvedLinks` to build:
- `outLinks: Map<path, Set<path>>` — forward edges (A links to B).
- `inLinks: Map<path, Set<path>>` — reverse edges (B is linked by A).

Only markdown files are included; non-markdown targets in `resolvedLinks` are skipped.

Used by both `computeGraph` and `ThreadView`.

### `computeGraph(app): GraphData`

Runs **Kosaraju's SCC algorithm** (iterative, no recursion) on `outLinks`/`inLinks` to find source SCCs — SCCs with no incoming edges from other SCCs:
- Single-node SCC, no self-loop → **root note** (shown normally in sidebar).
- Single-node SCC with self-loop, or multi-node SCC → **cycle node** (shown in red with ↺). One alphabetically-first representative is picked per cycle.

Returns `rootNodes[]`, `cycleNodes[]`, `outLinks`, `inLinks`.

---

## Title Computation

### `computeTitle(rootPath, outLinks, inLinks, dv): string | null`

Computes the display title of a root node using Dataview's `thread` frontmatter field.

**Algorithm:**
1. BFS from `rootPath` over `outLinks` → `subgraph: Set<path>`.
2. For each node in the subgraph, read `dv.page(path)?.thread` and normalise to `string[]`.
3. **Elimination rule:** a node X's thread value A is eliminated if any node Y in the subgraph with a *non-overlapping* thread value links directly to X (Y → X). This encodes "Y's thread overrides X's thread".
4. Collect surviving thread values as candidates:
   - 0 candidates → return `null` (caller uses `file.basename`).
   - 1 candidate → return it.
   - 2+ candidates → return `"thread collision: [A, B, ...]"`.

Returns `null` when Dataview is unavailable; callers always fall back to `file.basename`.

---

## Error Handling

All unexpected errors are logged to the browser console with the `[root-notes-view]` prefix.
- `console.warn` — expected-but-notable cases (Dataview missing, unexpected file type).
- `console.error` — unexpected failures (graph computation, file read, markdown render).
- `render()` in the sidebar shows an inline error message if `computeGraph` throws.
- `ThreadView.render()` shows a per-section error message if a file read or render fails, and continues with remaining notes.
