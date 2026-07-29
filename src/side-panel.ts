import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import { computeGraph, chainsFromGraph, computeTitle, resolveAndSortByCtime } from "./graph";

const LOG_PREFIX = "[note-chain]";

const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

export const VIEW_TYPE_ROOT_NOTES = "note-chain";

export class RootNotesView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private openThreadView: (file: TFile) => Promise<void>
	) {
		super(leaf);
	}

	getViewType(): string { return VIEW_TYPE_ROOT_NOTES; }
	getDisplayText(): string { return "Root Notes"; }
	getIcon(): string { return "git-fork"; }

	async onOpen() { this.render(); }
	async onClose() {}

	render() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.createEl("h4", { text: "Root Notes" });

		let graphData;
		try {
			graphData = computeGraph(this.app);
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

		// One entry per chain (spine or branch); branches get a [branch] prefix.
		const chains = chainsFromGraph(graphData);
		const isBranch = new Map<string, boolean>();
		for (const chain of chains) isBranch.set(chain.root, chain.parentRoot !== null);

		const cycleSet = new Set(cycleRoots);
		const now = Date.now();
		for (const file of resolveAndSortByCtime([...rootNodes, ...cycleRoots], this.app)) {
			const baseTitle = computeTitle(file.path, outLinks, inLinks, this.app) ?? file.basename;
			const title = isBranch.get(file.path) ? `[branch] ${baseTitle}` : baseTitle;
			const isCycle = cycleSet.has(file.path);
			const isStale = now - file.stat.ctime > STALE_THRESHOLD_MS;
			this.createNoteItem(ul, file, title, isCycle, isStale);
		}
	}

	private createNoteItem(ul: HTMLElement, file: TFile, title: string, isCycle: boolean, isStale: boolean) {
		const classes = ["root-notes-item"];
		if (isCycle) classes.push("root-notes-cycle");
		if (isStale) classes.push("is-stale");
		const li = ul.createEl("li", { cls: classes.join(" ") });
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
			this.app.workspace.getLeaf(false).openFile(file);
		});

		const threadBtn = li.createEl("button", {
			cls: "root-notes-thread-btn",
			attr: { title: "Show thread view", "aria-label": "Show thread view" },
		});
		threadBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
		threadBtn.addEventListener("click", (e) => {
			e.preventDefault();
			this.openThreadView(file);
		});
	}
}
