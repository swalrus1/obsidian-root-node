import { ItemView, MarkdownRenderer, TFile, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { computeGraph, chainsFromGraph, computeTitle, basename } from "./graph";
import { chainNotes } from "../core/graph";

const LOG_PREFIX = "[note-chain]";

// Paragraphs consisting only of wikilink lines (e.g. successor references) add
// no readable content to the thread — strip them before rendering.
const WIKILINK_ONLY_PARA = /(\[\[[^\]]*\]\](?:\n|$))+\n?/g;

export function preprocessContent(content: string): string {
	return content.replace(WIKILINK_ONLY_PARA, "");
}

export const VIEW_TYPE_THREAD = "thread-view";

/**
 * Read-only view that renders all notes in a chain as a scrollable thread,
 * sorted by creation time descending (newest first).
 */
export class ThreadView extends ItemView {
	private rootPath: string | null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string { return VIEW_TYPE_THREAD; }
	getDisplayText(): string {
		return this.rootPath ? `Thread: ${basename(this.rootPath)}` : "Thread";
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

		const graph = computeGraph(this.app);
		const { outLinks } = graph;

		// A branch shows only its own nodes; a spine (or a path that is not a
		// chain root — fallback) shows everything reachable from it.
		const chain = chainsFromGraph(graph).find((c) => c.root === this.rootPath);
		const paths = chain && chain.parentRoot !== null ? chain.nodes : chainNotes(this.rootPath, outLinks);

		// Resolve paths to TFiles and sort by creation time descending (newest first)
		const files: TFile[] = [];
		for (const path of paths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				files.push(file);
			} else {
				console.warn(LOG_PREFIX, `Thread view: expected a TFile at path "${path}" but got none.`);
			}
		}
		files.sort((a, b) => b.stat.ctime - a.stat.ctime);

		for (const file of files) {
			await this.renderNote(container, file);
		}

		// Branch: append a pseudo-node linking to the chain it joins into.
		if (chain && chain.parentRoot !== null) {
			this.renderContinuation(container, chain.parentRoot, chain.joinNode, outLinks);
		}
	}

	private async renderNote(container: HTMLElement, file: TFile) {
		const section = container.createEl("div", { cls: "thread-section" });
		const heading = section.createEl("h2", { cls: "thread-note-title" });
		const titleLink = heading.createEl("a", { text: file.basename, cls: "thread-note-title-link" });
		titleLink.addEventListener("click", (e) => {
			e.preventDefault();
			this.app.workspace.getLeaf(false).openFile(file);
		});

		let content: string;
		try {
			content = await this.app.vault.read(file);
		} catch (e) {
			console.error(LOG_PREFIX, `Thread view: failed to read file "${file.path}":`, e);
			section.createEl("p", { text: "Error reading note content.", cls: "root-notes-empty" });
			return;
		}

		const body = section.createEl("div", { cls: "thread-note-body" });
		try {
			await MarkdownRenderer.render(this.app, preprocessContent(content), body, file.path, this);
		} catch (e) {
			console.error(LOG_PREFIX, `Thread view: failed to render "${file.path}":`, e);
			body.setText(content);
		}
	}

	private renderContinuation(
		container: HTMLElement,
		parentRoot: string,
		joinNode: string | null,
		outLinks: Map<string, Set<string>>
	) {
		const parentTitle = computeTitle(parentRoot, outLinks, outLinks, this.app) ?? basename(parentRoot);
		const section = container.createEl("div", { cls: "thread-section thread-continuation" });
		const heading = section.createEl("h2", { cls: "thread-note-title" });
		const link = heading.createEl("a", {
			text: `Continued in: ${parentTitle}`,
			cls: "thread-note-title-link",
		});
		link.addEventListener("click", (e) => {
			e.preventDefault();
			this.setState({ path: parentRoot }, { history: true } as ViewStateResult);
		});

		// Link straight to the next note (the join node this branch attaches to).
		const joinFile = joinNode ? this.app.vault.getAbstractFileByPath(joinNode) : null;
		if (joinFile instanceof TFile) {
			const nextHeading = section.createEl("h2", { cls: "thread-note-title" });
			const nextLink = nextHeading.createEl("a", {
				text: `Next note: ${joinFile.basename}`,
				cls: "thread-note-title-link",
			});
			nextLink.addEventListener("click", (e) => {
				e.preventDefault();
				this.app.workspace.getLeaf(false).openFile(joinFile);
			});
		}
	}
}
