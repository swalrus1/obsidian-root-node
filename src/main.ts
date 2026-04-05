import {
	App,
	Editor,
	FuzzySuggestModal,
	getAllTags,
	ItemView,
	MarkdownRenderer,
	Plugin,
	TFile,
	ViewStateResult,
	WorkspaceLeaf,
} from "obsidian";

const VIEW_TYPE_ROOT_NOTES = "root-notes-view";
const VIEW_TYPE_THREAD = "thread-view";

const LOG_PREFIX = "[root-notes-view]";

export function normalizeChain(val: unknown): string[] {
	if (val === null || val === undefined) return [];
	if (Array.isArray(val)) return val.map((v) => String(v));
	return [String(val)];
}

interface LinkMaps {
	outLinks: Map<string, Set<string>>;
	inLinks: Map<string, Set<string>>;
}

interface GraphData extends LinkMaps {
	rootNodes: string[];
	cycleRoots: string[];
}

interface TitleEntry {
	title: string;
	path: string;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default class RootNotesPlugin extends Plugin {
	// In-memory map: display title → file path.
	// Rebuilt only when a file is created, modified, renamed, or deleted.
	titleMap: Map<string, string> = new Map();

	async onload() {
		this.registerView(
			VIEW_TYPE_ROOT_NOTES,
			(leaf) => new RootNotesView(leaf, this)
		);

		this.registerView(
			VIEW_TYPE_THREAD,
			(leaf) => new ThreadView(leaf, this.app)
		);

		this.addRibbonIcon("git-fork", "Root Notes View", () => {
			this.activateView();
		});

		this.addCommand({
			id: "open-root-notes-view",
			name: "Open Root Notes View",
			callback: () => this.activateView(),
		});

		this.addCommand({
			id: "insert-root-note-reference",
			name: "Insert root note reference",
			editorCallback: (editor: Editor) => {
				if (this.titleMap.size === 0) {
					console.warn(LOG_PREFIX, "Title map is empty — no root notes to insert.");
					return;
				}
				new RootNotesSuggestModal(this.app, this.titleMap, editor).open();
			},
		});

		this.addCommand({
			id: "show-thread-view",
			name: "Show thread view",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) this.openThreadView(file);
				return true;
			},
		});

		// Rebuild index + refresh view when file metadata changes (links, frontmatter).
		// `resolved` fires once all pending files are done.
		this.registerEvent(
			this.app.metadataCache.on("resolved", () => {
				this.rebuildTitleMap();
				this.refreshRootNotesView();
			})
		);

		// Structural changes not covered by metadataCache events
		this.registerEvent(this.app.vault.on("delete", () => this.rebuildTitleMap()));
		this.registerEvent(this.app.vault.on("rename", () => this.rebuildTitleMap()));

		this.app.workspace.onLayoutReady(() => {
			this.rebuildTitleMap();
			this.activateView();
		});
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_ROOT_NOTES);
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_THREAD);
	}

	rebuildTitleMap() {
		try {
			const { rootNodes, cycleRoots, outLinks, inLinks } = computeGraph(this.app);

			this.titleMap.clear();

			for (const path of [...rootNodes, ...cycleRoots]) {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile)) {
					console.warn(LOG_PREFIX, `Expected a TFile at path "${path}" but got none.`);
					continue;
				}
				const title = computeTitle(path, outLinks, inLinks, this.app) ?? file.basename;
				this.titleMap.set(title, path);
			}
		} catch (e) {
			console.error(LOG_PREFIX, "Failed to rebuild title map:", e);
		}
	}

	async activateView() {
		const { workspace } = this.app;

		const leaves = workspace.getLeavesOfType(VIEW_TYPE_ROOT_NOTES);
		if (leaves.length > 0) {
			workspace.revealLeaf(leaves[0]);
			return;
		}

		const leaf = workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: VIEW_TYPE_ROOT_NOTES, active: true });
			workspace.revealLeaf(leaf);
		}
	}

	async openThreadView(file: TFile) {
		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.setViewState({
			type: VIEW_TYPE_THREAD,
			state: { path: file.path },
			active: true,
		});
		this.app.workspace.revealLeaf(leaf);
	}

	private refreshRootNotesView() {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_ROOT_NOTES)) {
			if (leaf.view instanceof RootNotesView) {
				leaf.view.render();
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Fuzzy-search modal
// ---------------------------------------------------------------------------

class RootNotesSuggestModal extends FuzzySuggestModal<TitleEntry> {
	private items: TitleEntry[];

	constructor(app: App, titleMap: Map<string, string>, private editor: Editor) {
		super(app);
		this.setPlaceholder("Search root notes…");
		this.items = Array.from(titleMap.entries()).map(([title, path]) => ({ title, path }));
	}

	getItems(): TitleEntry[] {
		return this.items;
	}

	getItemText(item: TitleEntry): string {
		return item.title;
	}

	onChooseItem(item: TitleEntry): void {
		const file = this.app.vault.getAbstractFileByPath(item.path);
		if (!(file instanceof TFile)) {
			console.error(LOG_PREFIX, `Cannot resolve file for path "${item.path}" during insertion.`);
			return;
		}
		this.editor.replaceSelection(`[[${file.basename}]]`);
	}
}

// ---------------------------------------------------------------------------
// Root notes side-panel view
// ---------------------------------------------------------------------------

class RootNotesView extends ItemView {
	constructor(leaf: WorkspaceLeaf, private plugin: RootNotesPlugin) {
		super(leaf);
	}

	getViewType(): string { return VIEW_TYPE_ROOT_NOTES; }
	getDisplayText(): string { return "Root Notes"; }
	getIcon(): string { return "git-fork"; }

	async onOpen() { this.render(); }
	async onClose() {}

	render() {
		const app = this.plugin.app;
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.createEl("h4", { text: "Root Notes" });

		let graphData: GraphData;
		try {
			graphData = computeGraph(app);
		} catch (e) {
			console.error(LOG_PREFIX, "Failed to compute link graph:", e);
			container.createEl("p", {
				text: "Error computing root notes. See developer console for details.",
				cls: "root-notes-empty",
			});
			return;
		}

		const { rootNodes, cycleRoots, outLinks, inLinks } = graphData;

		if (rootNodes.length === 0 && cycleRoots.length === 0) {
			container.createEl("p", { text: "No root notes found.", cls: "root-notes-empty" });
			return;
		}

		const ul = container.createEl("ul", { cls: "root-notes-list" });

		const entries: { path: string; isCycle: boolean; chainSize: number }[] = [];
		for (const path of rootNodes)  entries.push({ path, isCycle: false, chainSize: chainSize(path, outLinks) });
		for (const path of cycleRoots) entries.push({ path, isCycle: true,  chainSize: chainSize(path, outLinks) });
		entries.sort((a, b) => b.chainSize - a.chainSize);

		for (const { path, isCycle } of entries) {
			const file = app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) {
				console.warn(LOG_PREFIX, `Expected a TFile at path "${path}" but got none.`);
				continue;
			}
			const title = computeTitle(path, outLinks, inLinks, app) ?? file.basename;
			this.createNoteItem(ul, file, title, isCycle);
		}
	}

	private createNoteItem(ul: HTMLElement, file: TFile, title: string, isCycle: boolean) {
		const app = this.plugin.app;
		const li = ul.createEl("li", {
			cls: isCycle ? "root-notes-item root-notes-cycle" : "root-notes-item",
		});
		const link = li.createEl("a", { text: title, cls: "root-notes-link" });
		if (isCycle) {
			li.createEl("span", {
				text: " ↺",
				cls: "root-notes-cycle-icon",
				attr: { title: "Part of a cycle — no external entry point" },
			});
		}
		link.addEventListener("click", (e) => {
			e.preventDefault();
			app.workspace.getLeaf(false).openFile(file);
		});

		const threadBtn = li.createEl("button", {
			cls: "root-notes-thread-btn",
			attr: { title: "Show thread view", "aria-label": "Show thread view" },
		});
		threadBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
		threadBtn.addEventListener("click", (e) => {
			e.preventDefault();
			this.plugin.openThreadView(file);
		});
	}
}

// ---------------------------------------------------------------------------
// Thread view — read-only, renders full subtree sorted by creation time desc
// ---------------------------------------------------------------------------

class ThreadView extends ItemView {
	private rootPath: string | null = null;

	constructor(leaf: WorkspaceLeaf, private pluginApp: App) {
		super(leaf);
	}

	getViewType(): string { return VIEW_TYPE_THREAD; }
	getDisplayText(): string {
		if (this.rootPath) {
			return `Thread: ${basename(this.rootPath)}`;
		}
		return "Thread";
	}
	getIcon(): string { return "list-tree"; }

	async setState(state: { path?: string }, result: ViewStateResult): Promise<void> {
		if (state.path) {
			this.rootPath = state.path;
			await this.render();
		}
		return super.setState(state, result);
	}

	getState(): Record<string, unknown> {
		return { path: this.rootPath };
	}

	async onOpen() {
		if (this.rootPath) await this.render();
	}

	async onClose() {}

	private async render() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();

		if (!this.rootPath) {
			container.createEl("p", { text: "No note selected.", cls: "root-notes-empty" });
			return;
		}

		const { outLinks } = buildLinkMaps(this.pluginApp);

		// BFS to collect all notes in the chain
		const chain = new Set<string>([this.rootPath]);
		const queue = [this.rootPath];
		while (queue.length > 0) {
			const note = queue.shift()!;
			for (const referenced of outLinks.get(note) ?? []) {
				if (!chain.has(referenced)) {
					chain.add(referenced);
					queue.push(referenced);
				}
			}
		}

		// Resolve paths to TFiles and sort by creation time descending (newest first)
		const files: TFile[] = [];
		for (const path of chain) {
			const file = this.pluginApp.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				files.push(file);
			} else {
				console.warn(LOG_PREFIX, `Thread view: expected a TFile at path "${path}" but got none.`);
			}
		}
		files.sort((a, b) => b.stat.ctime - a.stat.ctime);

		// Render each note's content
		for (const file of files) {
			const section = container.createEl("div", { cls: "thread-section" });
			const heading = section.createEl("h2", { cls: "thread-note-title" });
			const titleLink = heading.createEl("a", { text: file.basename, cls: "thread-note-title-link" });
			titleLink.addEventListener("click", (e) => {
				e.preventDefault();
				this.pluginApp.workspace.getLeaf(false).openFile(file);
			});

			let content: string;
			try {
				content = await this.pluginApp.vault.read(file);
			} catch (e) {
				console.error(LOG_PREFIX, `Thread view: failed to read file "${file.path}":`, e);
				section.createEl("p", {
					text: "Error reading note content.",
					cls: "root-notes-empty",
				});
				continue;
			}

			const body = section.createEl("div", { cls: "thread-note-body" });
			try {
				await MarkdownRenderer.render(this.pluginApp, content, body, file.path, this);
			} catch (e) {
				console.error(LOG_PREFIX, `Thread view: failed to render "${file.path}":`, e);
				body.setText(content);
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Graph computation
// ---------------------------------------------------------------------------

export function buildLinkMaps(app: App): LinkMaps {
	const resolvedLinks = app.metadataCache.resolvedLinks;
	const allFiles = app.vault.getMarkdownFiles();

	const outLinks = new Map<string, Set<string>>();
	const inLinks = new Map<string, Set<string>>();

	for (const file of allFiles) {
		if (!outLinks.has(file.path)) outLinks.set(file.path, new Set());
		if (!inLinks.has(file.path)) inLinks.set(file.path, new Set());
	}

	for (const [sourcePath, links] of Object.entries(resolvedLinks)) {
		if (!outLinks.has(sourcePath)) continue;
		for (const targetPath of Object.keys(links)) {
			if (!outLinks.has(targetPath)) continue;
			if (targetPath === sourcePath) continue; // ignore self-links
			outLinks.get(sourcePath)!.add(targetPath);
			inLinks.get(targetPath)!.add(sourcePath);
		}
	}

	// Among notes sharing a tag, a newer note references all older notes with that tag.
	const tagToFiles = new Map<string, TFile[]>();
	for (const file of allFiles) {
		const cache = app.metadataCache.getCache(file.path);
		if (!cache) continue;
		for (const tag of getAllTags(cache) ?? []) {
			if (!tagToFiles.has(tag)) tagToFiles.set(tag, []);
			tagToFiles.get(tag)!.push(file);
		}
	}

	for (const files of tagToFiles.values()) {
		if (files.length < 2) continue;
		// Sort descending by ctime (newest first), then add edges only between
		// consecutive pairs. This chains newer → older transitively in O(T log T)
		// instead of creating O(T²) pairwise edges.
		files.sort((a, b) => b.stat.ctime - a.stat.ctime);
		for (let i = 0; i < files.length - 1; i++) {
			const a = files[i], b = files[i + 1];
			if (a.stat.ctime === b.stat.ctime) continue; // equal ctime: no edge (order is ambiguous)
			outLinks.get(a.path)?.add(b.path);
			inLinks.get(b.path)?.add(a.path);
		}
	}

	return { outLinks, inLinks };
}

/**
 * Builds the reference graph and identifies roots of maximum inclusion chains
 * using Kosaraju's SCC algorithm. A maximum inclusion chain is a chain not
 * referenced by any note outside of it.
 * - Single-note SCC with no external references → root note (shown normally)
 * - Multi-note SCC with no external references → cyclic chain; one
 *   alphabetically-first representative is returned as the cycle root (shown in red)
 */
export function computeGraph(app: App): GraphData {
	const { outLinks, inLinks } = buildLinkMaps(app);
	const allNodes = Array.from(outLinks.keys());

	// Kosaraju pass 1: iterative DFS, record finish order
	const visited = new Set<string>();
	const finishOrder: string[] = [];

	for (const start of allNodes) {
		if (visited.has(start)) continue;
		const stack: [string, boolean][] = [[start, false]];
		while (stack.length > 0) {
			const top = stack[stack.length - 1];
			const [node, expanded] = top;
			if (!expanded) {
				if (visited.has(node)) { stack.pop(); continue; }
				visited.add(node);
				top[1] = true;
				for (const neighbor of outLinks.get(node) ?? []) {
					if (!visited.has(neighbor)) stack.push([neighbor, false]);
				}
			} else {
				stack.pop();
				finishOrder.push(node);
			}
		}
	}

	// Kosaraju pass 2: DFS on reversed graph in reverse finish order
	const component = new Map<string, number>();
	let compId = 0;

	for (let i = finishOrder.length - 1; i >= 0; i--) {
		const start = finishOrder[i];
		if (component.has(start)) continue;
		const stack: string[] = [start];
		while (stack.length > 0) {
			const node = stack.pop()!;
			if (component.has(node)) continue;
			component.set(node, compId);
			for (const neighbor of inLinks.get(node) ?? []) {
				if (!component.has(neighbor)) stack.push(neighbor);
			}
		}
		compId++;
	}

	// Group nodes by SCC and find source SCCs (no incoming edges from other SCCs)
	const sccs = new Map<number, string[]>();
	for (const [node, id] of component) {
		if (!sccs.has(id)) sccs.set(id, []);
		sccs.get(id)!.push(node);
	}

	const sccHasExternalParent = new Set<number>();
	for (const [srcPath, targets] of outLinks) {
		const srcComp = component.get(srcPath);
		if (srcComp === undefined) continue;
		for (const tgtPath of targets) {
			const dstComp = component.get(tgtPath);
			if (dstComp !== undefined && dstComp !== srcComp) {
				sccHasExternalParent.add(dstComp);
			}
		}
	}

	const rootNodes: string[] = [];
	const cycleRoots: string[] = [];

	for (const [id, nodes] of sccs) {
		if (sccHasExternalParent.has(id)) continue;

		if (nodes.length === 1) {
			rootNodes.push(nodes[0]);
		} else {
			nodes.sort((a, b) => basename(a).localeCompare(basename(b)));
			cycleRoots.push(nodes[0]);
		}
	}

	rootNodes.sort((a, b) => basename(a).localeCompare(basename(b)));
	cycleRoots.sort((a, b) => basename(a).localeCompare(basename(b)));

	return { rootNodes, cycleRoots, outLinks, inLinks };
}

// ---------------------------------------------------------------------------
// Title computation
// ---------------------------------------------------------------------------

/**
 * Compute the display title for the root of a maximum inclusion chain.
 *
 * Algorithm:
 * 1. Collect all notes in the chain via BFS from `rootPath`.
 * 2. A note is a candidate if it has a `chain` frontmatter property or any tag.
 * 3. A candidate X is eliminated if any other candidate Y can reach X through
 *    the chain graph (directly or through intermediate notes).
 * 4. Surviving candidate notes contribute their values (chain values + tags):
 *    - 0 surviving candidates → use the note's basename (caller falls back)
 *    - 1 surviving candidate  → use that candidate's value
 *    - 2+ surviving candidates → "chain collision: [A, B, ...]"
 */
export function computeTitle(
	rootPath: string,
	outLinks: Map<string, Set<string>>,
	inLinks: Map<string, Set<string>>,
	app: App
): string | null {
	try {
		// BFS to collect all notes in the chain (including root itself)
		const chain = new Set<string>([rootPath]);
		const queue = [rootPath];
		while (queue.length > 0) {
			const note = queue.shift()!;
			for (const referenced of outLinks.get(note) ?? []) {
				if (!chain.has(referenced)) {
					chain.add(referenced);
					queue.push(referenced);
				}
			}
		}

		// Collect chain values per note within the chain.
		// A note is a candidate if it has a chain property or any tag.
		const noteChains = new Map<string, string[]>();
		for (const path of chain) {
			const cache = app.metadataCache.getCache(path);
			const values = normalizeChain(cache?.frontmatter?.["chain"]);
			for (const tag of getAllTags(cache) ?? []) {
				values.push(tag);
			}
			if (values.length > 0) noteChains.set(path, values);
		}

		// Eliminate a candidate X if any other candidate Y can reach X
		// through the chain graph (directly or through intermediate notes).
		const candidatePaths = new Set(noteChains.keys());
		const eliminated = new Set<string>();
		for (const startPath of candidatePaths) {
			const visited = new Set<string>([startPath]);
			const bfsQueue = [startPath];
			while (bfsQueue.length > 0) {
				const current = bfsQueue.shift()!;
				for (const next of outLinks.get(current) ?? []) {
					if (!chain.has(next) || visited.has(next)) continue;
					visited.add(next);
					bfsQueue.push(next);
					if (candidatePaths.has(next)) {
						eliminated.add(next);
					}
				}
			}
		}

		// Surviving candidate notes contribute their values
		const candidates = new Set<string>();
		for (const [path, values] of noteChains) {
			if (!eliminated.has(path)) {
				for (const v of values) candidates.add(v);
			}
		}

		if (candidates.size === 0) return null;
		if (candidates.size === 1) return [...candidates][0];
		return `chain collision: [${[...candidates].sort().join(", ")}]`;
	} catch (e) {
		console.error(LOG_PREFIX, `Unexpected error computing title for "${rootPath}":`, e);
		return null;
	}
}

export function chainSize(rootPath: string, outLinks: Map<string, Set<string>>): number {
	const visited = new Set<string>([rootPath]);
	const queue = [rootPath];
	while (queue.length > 0) {
		const node = queue.shift()!;
		for (const neighbor of outLinks.get(node) ?? []) {
			if (!visited.has(neighbor)) {
				visited.add(neighbor);
				queue.push(neighbor);
			}
		}
	}
	return visited.size;
}

export function basename(path: string): string {
	return path.split("/").pop()?.replace(/\.md$/, "") ?? path;
}
