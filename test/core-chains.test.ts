import { describe, it, expect } from "vitest";
import { computeChains, type Chain } from "../core/chains";

function mk(edges: [string, string][]): Map<string, Set<string>> {
	const out = new Map<string, Set<string>>();
	const ensure = (k: string) => {
		if (!out.has(k)) out.set(k, new Set());
	};
	for (const [a, b] of edges) {
		ensure(a);
		ensure(b);
		out.get(a)!.add(b);
	}
	return out;
}

function byRoot(chains: Chain[]): Map<string, Chain> {
	return new Map(chains.map((c) => [c.root, c]));
}

describe("core/computeChains", () => {
	it("a single linear chain is a spine owning all its nodes", () => {
		// a -> b -> c (a newest, c oldest)
		const out = mk([
			["a.md", "b.md"],
			["b.md", "c.md"],
		]);
		const chains = computeChains(["a.md"], [], out);
		expect(chains).toHaveLength(1);
		expect(chains[0].parentRoot).toBeNull();
		expect(chains[0].joinNode).toBeNull();
		expect(chains[0].nodes.sort()).toEqual(["a.md", "b.md", "c.md"]);
	});

	it("splits a smaller secondary chain into a branch with its unique suffix and parent", () => {
		// spine s -> s2 -> j -> k (4 nodes); branch b -> j joins at j (reach 3)
		const out = mk([
			["s.md", "s2.md"],
			["s2.md", "j.md"],
			["j.md", "k.md"],
			["b.md", "j.md"],
		]);
		const chains = byRoot(computeChains(["s.md", "b.md"], [], out));

		const spine = chains.get("s.md")!;
		expect(spine.parentRoot).toBeNull();
		expect(spine.nodes.sort()).toEqual(["j.md", "k.md", "s.md", "s2.md"]);

		const branch = chains.get("b.md")!;
		expect(branch.parentRoot).toBe("s.md");
		expect(branch.joinNode).toBe("j.md"); // next note: closest spine node
		expect(branch.nodes).toEqual(["b.md"]); // only its unique suffix

		// invariant: every node owned exactly once
		const all = [...spine.nodes, ...branch.nodes].sort();
		expect(all).toEqual(["b.md", "j.md", "k.md", "s.md", "s2.md"]);
	});

	it("breaks equal-size ties by root path alpha (smallest is the spine)", () => {
		// two 2-node chains sharing tail t: a -> t and z -> t
		const out = mk([
			["a.md", "t.md"],
			["z.md", "t.md"],
		]);
		const chains = byRoot(computeChains(["z.md", "a.md"], [], out));
		// a < z, so a wins the tie and becomes the spine
		expect(chains.get("a.md")!.parentRoot).toBeNull();
		expect(chains.get("a.md")!.nodes.sort()).toEqual(["a.md", "t.md"]);
		expect(chains.get("z.md")!.parentRoot).toBe("a.md");
		expect(chains.get("z.md")!.joinNode).toBe("t.md");
		expect(chains.get("z.md")!.nodes).toEqual(["z.md"]);
	});

	it("points a nested branch at its immediate parent branch, not the spine", () => {
		// spine  s -> s2 -> s3 -> j -> k   (reach 5)
		// branch b -> b2 -> j              (joins spine at j; owns b, b2)
		// nested c -> b2                   (joins branch at b2; parent is b, not s)
		const out = mk([
			["s.md", "s2.md"],
			["s2.md", "s3.md"],
			["s3.md", "j.md"],
			["j.md", "k.md"],
			["b.md", "b2.md"],
			["b2.md", "j.md"],
			["c.md", "b2.md"],
		]);
		const chains = byRoot(computeChains(["s.md", "b.md", "c.md"], [], out));

		expect(chains.get("s.md")!.parentRoot).toBeNull();
		expect(chains.get("s.md")!.nodes.sort()).toEqual(["j.md", "k.md", "s.md", "s2.md", "s3.md"]);

		expect(chains.get("b.md")!.parentRoot).toBe("s.md");
		expect(chains.get("b.md")!.joinNode).toBe("j.md");
		expect(chains.get("b.md")!.nodes.sort()).toEqual(["b.md", "b2.md"]);

		expect(chains.get("c.md")!.parentRoot).toBe("b.md");
		expect(chains.get("c.md")!.joinNode).toBe("b2.md"); // joins the branch, not the spine
		expect(chains.get("c.md")!.nodes).toEqual(["c.md"]);
	});

	it("marks cycle roots via isCycle", () => {
		const out = mk([["a.md", "b.md"]]);
		const chains = computeChains(["a.md"], ["a.md"], out);
		expect(chains[0].isCycle).toBe(true);
	});
});
