import { App, TFile } from "obsidian";
import {
	buildLinkMaps as coreBuildLinkMaps,
} from "../core/buildLinkMaps";
import {
	computeGraph as coreComputeGraph,
	chainSize as coreChainSize,
	basename,
	normalizeChain,
} from "../core/graph";
import { computeTitle as coreComputeTitle } from "../core/title";
import { computeChains as coreComputeChains, type Chain } from "../core/chains";
import type { LinkMaps, GraphData } from "../core/types";

export { basename, normalizeChain };
export type { LinkMaps, GraphData, Chain };

const LOG_PREFIX = "[note-chain]";

export function buildLinkMaps(app: App): LinkMaps {
	const filePaths = app.vault.getMarkdownFiles().map((f) => f.path);
	return coreBuildLinkMaps(filePaths, app.metadataCache.resolvedLinks);
}

export function computeGraph(app: App): GraphData {
	return coreComputeGraph(buildLinkMaps(app));
}

export function chainsFromGraph(g: GraphData): Chain[] {
	return coreComputeChains([...g.rootNodes, ...g.cycleRoots], g.cycleRoots, g.outLinks);
}

export function computeTitle(
	rootPath: string,
	outLinks: Map<string, Set<string>>,
	_inLinks: Map<string, Set<string>>,
	app: App
): string | null {
	try {
		return coreComputeTitle(
			rootPath,
			outLinks,
			(path) => app.metadataCache.getCache(path)?.frontmatter ?? null
		);
	} catch (e) {
		console.error(LOG_PREFIX, `Unexpected error computing title for "${rootPath}":`, e);
		return null;
	}
}

export function chainSize(rootPath: string, outLinks: Map<string, Set<string>>): number {
	return coreChainSize(rootPath, outLinks);
}

export function resolveAndSortByCtime(paths: string[], app: App): TFile[] {
	const files: TFile[] = [];
	for (const path of paths) {
		const file = app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) files.push(file);
		else console.warn(LOG_PREFIX, `Expected a TFile at path "${path}" but got none.`);
	}
	return files.sort((a, b) => b.stat.ctime - a.stat.ctime);
}
