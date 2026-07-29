import { chainNotes } from "./graph";

/**
 * A partition of the reference graph. Every reachable node belongs to exactly
 * one Chain (invariant).
 *
 * - `parentRoot === null` → the chain is a **spine**: the largest chain among
 *   all chains sharing any of its nodes; it owns every node it reaches.
 * - `parentRoot !== null` → the chain is a **branch**: it shares an oldest
 *   prefix (the sub-spine) with a larger chain and owns only its unique newest
 *   suffix. `parentRoot` is the root of the immediate chain it joins into.
 */
export interface Chain {
	root: string;
	/** Nodes owned exclusively by this chain (its unique suffix for branches). */
	nodes: string[];
	/** Root of the parent chain a branch joins, or null for a spine. */
	parentRoot: string | null;
	/**
	 * The join node: the closest node to `root` that is owned by another chain —
	 * i.e. the next note after this branch's own nodes. Null for a spine.
	 */
	joinNode: string | null;
	isCycle: boolean;
}

/**
 * Partition the graph into spines and branches.
 *
 * Roots are processed largest-reach-first (ties broken by path, so exactly one
 * chain wins each overlap group and becomes the spine). Each root claims its
 * as-yet-unclaimed reachable nodes; a root that hits a node already owned by a
 * larger chain becomes a branch whose parent is the owner of that join node.
 */
export function computeChains(
	roots: string[],
	cycleRoots: string[],
	outLinks: Map<string, Set<string>>
): Chain[] {
	const cycleSet = new Set(cycleRoots);

	const size = new Map<string, number>();
	for (const root of roots) size.set(root, chainNotes(root, outLinks).length);

	const ordered = [...roots].sort((a, b) => {
		const sizeDiff = size.get(b)! - size.get(a)!;
		if (sizeDiff !== 0) return sizeDiff;
		return a.localeCompare(b);
	});

	const owner = new Map<string, string>();
	const chains: Chain[] = [];

	for (const root of ordered) {
		const owned: string[] = [];
		let parentRoot: string | null = null;
		let joinNode: string | null = null;

		const queue = [root];
		const seen = new Set<string>([root]);
		while (queue.length > 0) {
			const node = queue.shift()!;
			const existing = owner.get(node);
			if (existing !== undefined) {
				// Already owned by a larger chain: this is a join point. Everything
				// reachable past it is owned too, so stop expanding here. The first
				// join encountered (BFS order) is the immediate parent + next note.
				if (parentRoot === null) {
					parentRoot = existing;
					joinNode = node;
				}
				continue;
			}
			owner.set(node, root);
			owned.push(node);
			for (const next of outLinks.get(node) ?? []) {
				if (!seen.has(next)) {
					seen.add(next);
					queue.push(next);
				}
			}
		}

		chains.push({ root, nodes: owned, parentRoot, joinNode, isCycle: cycleSet.has(root) });
	}

	return chains;
}
