import { App, Editor, FuzzySuggestModal, ItemView, Plugin, TFile, WorkspaceLeaf } from "obsidian";

const VIEW_TYPE_ROOT_NOTES = "root-notes-view";

// Minimal Dataview API surface we use
interface DataviewApi {
	page(path: string): Record<string, unknown> | undefined;
}

const LOG_PREFIX = "[root-notes-view]";

function getDataviewApi(app: App): DataviewApi | null {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const api = (app as any).plugins?.plugins?.["dataview"]?.api ?? null;
	if (!api) {
		console.warn(
			LOG_PREFIX,
			"Dataview plugin not found or not loaded. Thread-based titles will be unavailable."
		);
	}
	return api;
}

function normalizeThread(val: unknown): string[] {
	if (val === null || val === undefined) return [];
	if (Array.isArray(val)) return val.map((v) => String(v));
	return [String(val)];
}

interface GraphData {
	rootNodes: string[];
	cycleNodes: string[];
	outLinks: Map<string, Set<string>>;
	inLinks: Map<string, Set<string>>;
}

interface TitleEntry {
	title: string;
	path: string;
}

export default class RootNotesPlugin extends Plugin {
	// In-memory map: display title → file path.
	// Rebuilt only when a file is created, modified, renamed, or deleted.
	titleMap: Map<string, string> = new Map();

	async onload() {
		this.registerView(
			VIEW_TYPE_ROOT_NOTES,
			(leaf) => new RootNotesView(leaf, this)
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

		// Rebuild index + refresh view when file metadata changes (links, frontmatter).
		// `changed` fires per-file; `resolved` fires once all pending files are done.
		this.registerEvent(
			this.app.metadataCache.on("resolved", () => {
				this.rebuildTitleMap();
				this.refreshView();
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

	rebuildTitleMap() {
		try {
			const dv = getDataviewApi(this.app);
			const { rootNodes, cycleNodes, outLinks, inLinks } = computeGraph(this.app);

			this.titleMap.clear();

			for (const path of [...rootNodes, ...cycleNodes]) {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile)) {
					console.warn(LOG_PREFIX, `Expected a TFile at path "${path}" but got none.`);
					continue;
				}
				const title = computeTitle(path, outLinks, inLinks, dv) ?? file.basename;
				this.titleMap.set(title, path);
			}
		} catch (e) {
			console.error(LOG_PREFIX, "Failed to rebuild title map:", e);
		}
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_ROOT_NOTES);
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

	private refreshView() {
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
// Side-panel view
// ---------------------------------------------------------------------------

class RootNotesView extends ItemView {
	constructor(leaf: WorkspaceLeaf, private plugin: RootNotesPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_ROOT_NOTES;
	}

	getDisplayText(): string {
		return "Root Notes";
	}

	getIcon(): string {
		return "git-fork";
	}

	async onOpen() {
		this.render();
	}

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

		const { rootNodes, cycleNodes, outLinks, inLinks } = graphData;
		const dv = getDataviewApi(app);

		if (rootNodes.length === 0 && cycleNodes.length === 0) {
			container.createEl("p", {
				text: "No root notes found.",
				cls: "root-notes-empty",
			});
			return;
		}

		const ul = container.createEl("ul", { cls: "root-notes-list" });

		for (const path of rootNodes) {
			const file = app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) {
				console.warn(LOG_PREFIX, `Expected a TFile at path "${path}" but got none.`);
				continue;
			}
			const title = computeTitle(path, outLinks, inLinks, dv) ?? file.basename;
			this.createNoteItem(ul, file, title, false);
		}

		for (const path of cycleNodes) {
			const file = app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) {
				console.warn(LOG_PREFIX, `Expected a TFile at path "${path}" but got none.`);
				continue;
			}
			const title = computeTitle(path, outLinks, inLinks, dv) ?? file.basename;
			this.createNoteItem(ul, file, title, true);
		}
	}

	private createNoteItem(
		ul: HTMLElement,
		file: TFile,
		title: string,
		isCycle: boolean
	) {
		const app = this.plugin.app;
		const li = ul.createEl("li", {
			cls: isCycle ? "root-notes-item root-notes-cycle" : "root-notes-item",
		});
		const link = li.createEl("a", {
			text: title,
			cls: "root-notes-link",
		});
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
	}
}

// ---------------------------------------------------------------------------
// Graph computation
// ---------------------------------------------------------------------------

/**
 * Builds the vault link graph and finds root nodes using Kosaraju's SCC algorithm:
 * - True roots: nodes with no incoming edges (shown normally)
 * - Cycle roots: SCCs with no external parents, size > 1 or with self-loops
 *   (one representative per cycle, shown in red)
 */
function computeGraph(app: App): GraphData {
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
			outLinks.get(sourcePath)!.add(targetPath);
			inLinks.get(targetPath)!.add(sourcePath);
		}
	}

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
	const cycleNodes: string[] = [];

	for (const [id, nodes] of sccs) {
		if (sccHasExternalParent.has(id)) continue;

		if (nodes.length === 1) {
			const node = nodes[0];
			const hasSelfLoop = outLinks.get(node)?.has(node) ?? false;
			if (hasSelfLoop) {
				cycleNodes.push(node);
			} else {
				rootNodes.push(node);
			}
		} else {
			nodes.sort((a, b) => basename(a).localeCompare(basename(b)));
			cycleNodes.push(nodes[0]);
		}
	}

	rootNodes.sort((a, b) => basename(a).localeCompare(basename(b)));
	cycleNodes.sort((a, b) => basename(a).localeCompare(basename(b)));

	return { rootNodes, cycleNodes, outLinks, inLinks };
}

// ---------------------------------------------------------------------------
// Title computation
// ---------------------------------------------------------------------------

/**
 * Compute the display title for a root node.
 *
 * Algorithm:
 * 1. Collect all nodes reachable from `rootPath` (BFS).
 * 2. For each reachable node, read its `thread` Dataview field.
 * 3. A thread value A (carried by node X) is eliminated if any node Y in the
 *    subgraph that has a *different* thread value links directly to X.
 *    (Y's thread "overrides" X's thread, so A is not a root-level thread.)
 * 4. Surviving thread values are candidates for the title:
 *    - 0 candidates → use the note's basename (caller falls back)
 *    - 1 candidate  → use that thread value
 *    - 2+ candidates → "thread collision: [A, B, ...]"
 */
function computeTitle(
	rootPath: string,
	outLinks: Map<string, Set<string>>,
	inLinks: Map<string, Set<string>>,
	dv: DataviewApi | null
): string | null {
	if (!dv) return null;

	try {
		// BFS to collect all reachable nodes (including root itself)
		const subgraph = new Set<string>([rootPath]);
		const queue = [rootPath];
		while (queue.length > 0) {
			const node = queue.shift()!;
			for (const neighbor of outLinks.get(node) ?? []) {
				if (!subgraph.has(neighbor)) {
					subgraph.add(neighbor);
					queue.push(neighbor);
				}
			}
		}

		// Collect thread values per node within the subgraph
		const nodeThreads = new Map<string, string[]>();
		for (const path of subgraph) {
			let page: Record<string, unknown> | undefined;
			try {
				page = dv.page(path);
			} catch (e) {
				console.error(LOG_PREFIX, `Dataview failed to read page "${path}":`, e);
				continue;
			}
			const threads = normalizeThread(page?.["thread"]);
			if (threads.length > 0) nodeThreads.set(path, threads);
		}

		// Eliminate thread values: thread A (from node X) is eliminated when some
		// node Y in the subgraph has a thread *different* from A and Y → X.
		const eliminated = new Set<string>(); // paths whose thread is overridden
		for (const [xPath, xThreads] of nodeThreads) {
			for (const yPath of inLinks.get(xPath) ?? []) {
				if (!subgraph.has(yPath)) continue;
				const yThreads = nodeThreads.get(yPath);
				if (!yThreads) continue;
				const overlaps = yThreads.some((t) => xThreads.includes(t));
				if (!overlaps) {
					eliminated.add(xPath);
					break;
				}
			}
		}

		// Surviving thread values are the candidates
		const candidates = new Set<string>();
		for (const [path, threads] of nodeThreads) {
			if (!eliminated.has(path)) {
				for (const t of threads) candidates.add(t);
			}
		}

		if (candidates.size === 0) return null;
		if (candidates.size === 1) return [...candidates][0];
		return `thread collision: [${[...candidates].sort().join(", ")}]`;
	} catch (e) {
		console.error(LOG_PREFIX, `Unexpected error computing title for "${rootPath}":`, e);
		return null;
	}
}

function basename(path: string): string {
	return path.split("/").pop()?.replace(/\.md$/, "") ?? path;
}
