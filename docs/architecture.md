# Plugin Architecture

## Code layout

- `core/` — pure logic with **no Obsidian imports**. Single source of truth for
  graph + title computation:
  - `core/buildLinkMaps.ts` — pure `buildLinkMaps(filePaths, resolvedLinks)`.
  - `core/graph.ts` — `computeGraph`, `chainNotes` (BFS from a root over
    `outLinks`), `chainSize`, `basename`, `normalizeChain`.
  - `core/chains.ts` — `computeChains(roots, cycleRoots, outLinks)` partitions
    the graph into spines and branches (see "Spine / Branch Partition" below).
    Exports the `Chain` interface.
  - `core/title.ts` — `computeTitle(rootPath, outLinks, getFrontmatter)`,
    parameterised over a frontmatter reader.
  - `core/types.ts` — `LinkMaps`, `GraphData`, `ResolvedLinks`,
    `FrontmatterReader`.
- `src/` — Obsidian-flavoured adapter over `core/`. Bundled by esbuild into
  `main.js` (single CommonJS bundle for Obsidian).
  - `src/graph.ts` is a thin wrapper: `buildLinkMaps(app)` reads
    `app.vault.getMarkdownFiles()` + `app.metadataCache.resolvedLinks` and
    delegates; `computeTitle(...)` builds a frontmatter reader from
    `app.metadataCache.getCache(path)?.frontmatter` and delegates;
    `chainsFromGraph(graphData)` delegates to `core/chains.computeChains` (takes
    an already-computed `GraphData` so callers can reuse one `computeGraph`
    call); `resolveAndSortByCtime` stays here because it needs the Obsidian
    `TFile.stat.ctime` accessor.
- `cli/` — standalone Node CLI bundled by `cli/esbuild.config.mjs` into
  `cli/dist/cli.js`. Loads a vault directory from disk (`cli/src/fs-vault.ts`),
  parses YAML frontmatter via `js-yaml`, resolves wikilinks (basename or
  relative path), then drives `core/` directly. Commands: `list`, `get`,
  `create`, `list-notes` (see `cli/src/commands/`).
- `skills/manage-notes/` — Claude Code skill source (`SKILL.md`). Single-file
  skill that translates natural-language requests into CLI invocations and
  emits relative note paths. Refuses content-reading requests. Install via
  `just install-skill` (symlinks into `~/.claude/skills/`).
- `test/` — all vitest tests. Pure-logic tests target `core/` directly; plugin
  tests go through `src/graph.ts` (via the in-memory mock at
  `test/helpers.ts`); CLI tests build ephemeral vaults with `fs.mkdtempSync`.

Styles are in `styles.css`. The plugin bundle is built with esbuild; output is
`main.js`.

---

## Entry point: `RootNotesPlugin`

`export default class RootNotesPlugin extends Plugin`

Owns all lifecycle, event registration, and cross-component state.

**Responsibilities:**
- Registers both view types (`note-chain`, `thread-view`) on load.
- Registers the ribbon icon and all five commands.
- Owns the in-memory title map (`titleMap: Map<string, string>`).
- Calls `rebuildTitleMap()` on the events that invalidate it.
- Calls `refreshRootNotesView()` to repaint the sidebar after a rebuild.
- Exposes `openThreadView(file: TFile)` so other components can open a thread tab.
- Detaches both view types on unload.

**Events that trigger index rebuild:**
- `metadataCache.on("resolved")` — fires after all pending file metadata is processed; covers creates, edits.
- `vault.on("delete")` and `vault.on("rename")` — structural changes not guaranteed to fire `resolved`.
- `workspace.onLayoutReady` — initial build at startup.

---

## Component: Sidebar (`RootNotesView`)

`class RootNotesView extends ItemView` — view type `note-chain`

Opened in the right leaf on startup and via the "Open Note Chain" command.

---

## Command: Refresh index (`src/index-builder.ts`)

Registered as `refresh-index`. Rebuilds managed index notes for all tags in the vault.

**Algorithm:**
1. Scans all markdown files via `metadataCache`; skips notes whose `chain` starts with `internal/index` to avoid self-indexing.
2. Builds `tag → TFile[]` map using `getAllTags` (covers frontmatter and inline tags).
3. For each tag, looks for an existing note with `chain: "internal/index/tag/<tag>"`:
   - 0 found → creates a new note via `vault.create` with a timestamp filename.
   - 1 found → overwrites content in place.
   - 2+ found → shows a `Notice` and throws (user must deduplicate first).
4. Writes tag index content: YAML frontmatter with the chain value, the managed epigraph, and a sorted `[[wikilink]]` list of tagged notes.
5. Applies the same find-or-create logic for a master index (`chain: "internal/index"`) that lists all `internal/index/` notes. Pre-existing orphaned index notes (tags since deleted) are included via the metadata cache; newly created ones are merged in directly since the cache hasn't updated yet.
6. Shows a `Notice` on success.

**Error handling:** duplicate chain values abort immediately via `assertUnique`; the error is caught in `main.ts` and logged.

---

## Command: Create successor

Registered as `create-successor`. Available when a file is active (`checkCallback`).

1. Captures `currentFile = workspace.getActiveFile()`.
2. Looks up the Unique Note Creator's "Create new unique note" command via `findUniqueNoteCommandId()` — tries known IDs (`zk-prefixer:new-zk-note`, `unique-note-creator:new-unique-note`) first, then falls back to a name-based scan of `app.commands.commands`. Returns `null` if nothing matches.
3. If no command was found, shows a `Notice`, logs an error (including the full list of available command IDs to aid diagnosis), and aborts.
4. Registers a one-shot `file-open` listener that, on the first event delivering a file other than the original, inserts `[[currentFile.basename]]` into the active `MarkdownView`'s editor.
5. Executes the resolved command via `app.commands.executeCommandById`. If execution fails, the listener is cleaned up immediately and a `Notice` is shown.

`file-open` is used rather than `active-leaf-change` because the Unique Note Creator opens the new note in the *same* active leaf — only the file changes, so `active-leaf-change` does not fire.

The dynamic command-id lookup exists because Obsidian's core plugin command IDs are not part of the public API and have historically shifted (e.g., `zk-prefixer` vs. potential renames); hardcoding a single ID would silently break across Obsidian versions.

**Render cycle** (called by `refreshRootNotesView()` and `onOpen`):
1. Calls `computeGraph(app)` to get `rootNodes`, `cycleNodes`, `outLinks`, `inLinks`.
2. Resolves each path to a `TFile`; skips with a warn if not a `TFile`.
3. Sorts entries by `file.stat.ctime` **descending** (newest root note first). The biggest-chain-first sort is intentionally not applied — surfacing recent activity is the product intent (chains become "disposable" with age).
4. Calls `chainsFromGraph(graphData)` to partition roots into spines/branches; each root whose `Chain.parentRoot !== null` is a branch.
5. For each node path, calls `computeTitle(...)` → falls back to `file.basename`. Branch entries are prefixed with `[branch] `.
5. Computes `isStale = (Date.now() - ctime) > STALE_THRESHOLD_MS` where `STALE_THRESHOLD_MS = 30 days`. Stale chains receive the `is-stale` class; `styles.css` fades them to `opacity: 0.5`. This is a deliberate visual de-emphasis, not a filter — stale chains remain clickable.
6. Renders an `<ul>` where each `<li>` contains:
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
1. Calls `computeGraph(app)` then `chainsFromGraph(...)` and finds the `Chain` whose `root === rootPath`.
2. Selects the paths to render:
   - **Branch** (`chain.parentRoot !== null`): only `chain.nodes` (its own suffix).
   - **Spine, or `rootPath` is not a chain root (fallback)**: `chainNotes(rootPath, outLinks)` — the full reachable subtree (preserves the pre-partition behavior for any non-root path).
3. Resolves each path to a `TFile`; sorts by `TFile.stat.ctime` descending (newest first).
4. For each file (`renderNote`):
   - Creates a `div.thread-section` with an `h2.thread-note-title`.
   - The `h2` contains a clickable `<a>` that opens the note.
   - Reads file content with `vault.read(file)`.
   - Renders markdown with `MarkdownRenderer.render(app, content, el, sourcePath, this)`.
5. **Branch only** (`renderContinuation`): appends a trailing `div.thread-section.thread-continuation` pseudo-node — a link "Continued in: `<parent title>`" that re-renders the view in place via `setState({ path: parentRoot })`. Because it navigates to the parent chain's root, nested branches chain up to their spine one hop at a time.

The view is read-only by design (no editor, no CodeMirror). Tab title is `Thread: <basename>`.

---

## Component: In-Memory Title Map

`plugin.titleMap: Map<string, string>` — maps display title → file path.

Populated exclusively by `TitleStore.rebuild(app)`, which:
1. Calls `computeGraph(app)` to get all root and cycle node paths.
2. Resolves each path to a `TFile` (skips with a warn if missing).
3. Sorts resolved entries by `file.stat.ctime` **descending** (newest root first) — so the Link Chain modal presents chains in the same recency order as the side panel.
4. Calls `computeTitle(...)` per entry, falls back to `file.basename`.

Consumed by:
- `RootNotesSuggestModal` (fuzzy search for "Link chain" command).
- `render()` in `RootNotesView` does **not** use it; it calls `computeTitle` directly so the sidebar always shows fresh data.

Collision semantics: if two root notes resolve to the same display title, the second one silently overwrites the first in the map. This is a known limitation of the prototype.

---

## Component: Fuzzy-Search Modal (`RootNotesSuggestModal`)

`class RootNotesSuggestModal extends FuzzySuggestModal<TitleEntry>`

Opened by the "Link chain" command (editor callback — only active when an editor is focused).

Snapshots `plugin.titleMap` at construction time into a `TitleEntry[]` array. On item selection, inserts `[[basename]]` at the editor cursor via `editor.replaceSelection`.

---

## Graph Computation

Two pure functions operating on `App`:

### `buildLinkMaps(app): LinkMaps`

Iterates `app.vault.getMarkdownFiles()` and `app.metadataCache.resolvedLinks` to build:
- `outLinks: Map<path, Set<path>>` — forward edges (A links to B).
- `inLinks: Map<path, Set<path>>` — reverse edges (B is linked by A).

Only markdown files are included; non-markdown targets in `resolvedLinks` are skipped. Self-links are ignored.

Used by both `computeGraph` and `ThreadView`.

### `computeGraph(app): GraphData`

Runs **Kosaraju's SCC algorithm** (iterative, no recursion) on `outLinks`/`inLinks` to find source SCCs — SCCs with no incoming edges from other SCCs:
- Single-node SCC → **root note** (shown normally in sidebar).
- Multi-node SCC → **cycle node** (shown in red with ↺). One alphabetically-first representative is picked per cycle.

Returns `rootNodes[]`, `cycleNodes[]`, `outLinks`, `inLinks`.

---

## Spine / Branch Partition

### `computeChains(roots, cycleRoots, outLinks): Chain[]`

Partitions all reachable nodes into spines and branches (see
`docs/premise.md` for the model). `Chain = { root, nodes, parentRoot, isCycle }`;
`parentRoot === null` marks a spine, `parentRoot !== null` a branch (there is no
separate `kind` field — it is derivable from `parentRoot`).

**Algorithm:**
1. Precompute each root's reach size via `chainNotes`.
2. Order roots by size **descending**, ties broken by root path (`localeCompare`)
   — so exactly one chain in each overlap group wins and becomes the spine.
3. Maintain a global `owner: node → root` map. For each root in order, BFS over
   `outLinks`:
   - An unowned node is claimed (added to `owner` and this chain's `nodes`) and
     expanded.
   - An already-owned node is a **join point**: it (and everything past it, which
     is already owned — ownership is downward-closed) is not expanded. The first
     join encountered in BFS order sets `parentRoot`.
4. A chain that hit no join owns its entire reach and is a **spine**
   (`parentRoot === null`). A chain that hit a join owns only its unique suffix
   and is a **branch** whose parent is the immediate chain it joined.

This satisfies the invariant (every node owned exactly once) and the "largest
chain wins" rule. Cycle roots are passed through as ordinary roots and flagged
via `isCycle`.

---

## Title Computation

### `computeTitle(rootPath, outLinks, inLinks, app): string | null`

Computes the display title of the root of a maximum inclusion chain using the `chain` frontmatter property.

**Algorithm:**
1. BFS from `rootPath` over `outLinks` → `chain: Set<path>`.
2. A note is a **candidate** if it has a `chain` frontmatter property.
3. **Elimination rule:** candidate X is eliminated if any other candidate Y can reach X through the chain graph (directly or through intermediate notes).
4. Collect `chain` values from surviving candidate notes:
   - 0 surviving candidates → return `null` (caller uses `file.basename`).
   - 1 surviving candidate → return its value.
   - 2+ surviving candidates → return `"chain collision: [A, B, ...]"`.

No external plugin dependency — uses Obsidian's native metadata cache directly.

---

## Error Handling

All unexpected errors are logged to the browser console with the `[note-chain]` prefix.
- `console.warn` — expected-but-notable cases (unexpected file type).
- `console.error` — unexpected failures (graph computation, file read, markdown render).
- `render()` in the sidebar shows an inline error message if `computeGraph` throws.
- `ThreadView.render()` shows a per-section error message if a file read or render fails, and continues with remaining notes.
