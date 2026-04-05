/**
 * Minimal stub for the `obsidian` module used in unit tests.
 * Only the surface area exercised by the tested functions is implemented.
 */

export class Plugin {
	app: unknown;
	registerView() {}
	registerEvent() {}
	addRibbonIcon() {}
	addCommand() {}
}

export class ItemView {
	containerEl = { children: [null, { empty() {}, createEl() { return { empty() {}, createEl() {} }; } }] };
	registerEvent() {}
}

export class FuzzySuggestModal<T> {
	constructor(public app: unknown) {}
	setPlaceholder() {}
	open() {}
}

export class TFile {
	path = "";
	basename = "";
	stat = { ctime: 0 };
}

export const MarkdownRenderer = {
	render: async () => {},
};

export function getAllTags(cache: { _tags?: string[] } | null): string[] | null {
	return cache?._tags ?? null;
}

export class WorkspaceLeaf {}

export type ViewStateResult = Record<string, unknown>;
