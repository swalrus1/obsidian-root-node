import { describe, it, expect } from "vitest";
import { chainSize } from "../src/main";

function makeOutLinks(edges: [string, string][]): Map<string, Set<string>> {
	const out = new Map<string, Set<string>>();
	for (const [a, b] of edges) {
		if (!out.has(a)) out.set(a, new Set());
		if (!out.has(b)) out.set(b, new Set());
		out.get(a)!.add(b);
	}
	return out;
}

describe("chainSize", () => {
	it("a single isolated note has size 1", () => {
		const out = makeOutLinks([]);
		out.set("a.md", new Set());
		expect(chainSize("a.md", out)).toBe(1);
	});

	it("a two-note chain has size 2", () => {
		const out = makeOutLinks([["a.md", "b.md"]]);
		expect(chainSize("a.md", out)).toBe(2);
	});

	it("a linear chain of three has size 3", () => {
		const out = makeOutLinks([["a.md", "b.md"], ["b.md", "c.md"]]);
		expect(chainSize("a.md", out)).toBe(3);
	});

	it("counts each note once in a diamond (shared child)", () => {
		// a → b, a → c, b → d, c → d  →  {a, b, c, d} = 4
		const out = makeOutLinks([
			["a.md", "b.md"],
			["a.md", "c.md"],
			["b.md", "d.md"],
			["c.md", "d.md"],
		]);
		expect(chainSize("a.md", out)).toBe(4);
	});

	it("does not follow back-edges out of the chain", () => {
		// a → b, b → a  (cycle): still only 2 distinct nodes
		const out = makeOutLinks([["a.md", "b.md"], ["b.md", "a.md"]]);
		expect(chainSize("a.md", out)).toBe(2);
	});
});
