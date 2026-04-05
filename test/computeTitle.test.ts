import { describe, it, expect } from "vitest";
import { computeTitle } from "../src/main";

// Helpers to build outLinks / inLinks maps and a minimal App mock directly,
// without going through buildLinkMaps (which tests cover separately).

function makeLinks(edges: [string, string][]): {
	outLinks: Map<string, Set<string>>;
	inLinks: Map<string, Set<string>>;
} {
	const outLinks = new Map<string, Set<string>>();
	const inLinks = new Map<string, Set<string>>();

	const ensure = (m: Map<string, Set<string>>, k: string) => {
		if (!m.has(k)) m.set(k, new Set());
	};

	for (const [a, b] of edges) {
		ensure(outLinks, a); ensure(outLinks, b);
		ensure(inLinks, a);  ensure(inLinks, b);
		outLinks.get(a)!.add(b);
		inLinks.get(b)!.add(a);
	}
	return { outLinks, inLinks };
}

/** Minimal App mock: caches map path → { frontmatter, _tags } */
function makeApp(caches: Record<string, { frontmatter?: Record<string, unknown>; _tags?: string[] }>) {
	return {
		metadataCache: {
			getCache: (path: string) => caches[path] ?? null,
		},
	};
}

describe("computeTitle – no candidates", () => {
	it("returns null when no note has a chain property or tag", () => {
		const { outLinks, inLinks } = makeLinks([["a.md", "b.md"]]);
		const app = makeApp({});
		expect(computeTitle("a.md", outLinks, inLinks, app as never)).toBeNull();
	});
});

describe("computeTitle – single candidate", () => {
	it("returns the chain property value of the sole candidate", () => {
		const { outLinks, inLinks } = makeLinks([]);
		outLinks.set("a.md", new Set());
		inLinks.set("a.md", new Set());
		const app = makeApp({ "a.md": { frontmatter: { chain: "my-project" } } });
		expect(computeTitle("a.md", outLinks, inLinks, app as never)).toBe("my-project");
	});

	it("returns a tag when the candidate has no chain property but has a tag", () => {
		const { outLinks, inLinks } = makeLinks([]);
		outLinks.set("a.md", new Set());
		inLinks.set("a.md", new Set());
		const app = makeApp({ "a.md": { _tags: ["#foo"] } });
		expect(computeTitle("a.md", outLinks, inLinks, app as never)).toBe("#foo");
	});

	it("uses a chain array value", () => {
		const { outLinks, inLinks } = makeLinks([]);
		outLinks.set("a.md", new Set());
		inLinks.set("a.md", new Set());
		const app = makeApp({ "a.md": { frontmatter: { chain: ["alpha"] } } });
		expect(computeTitle("a.md", outLinks, inLinks, app as never)).toBe("alpha");
	});
});

describe("computeTitle – candidate elimination (direct)", () => {
	it("eliminates a candidate reached directly by another candidate", () => {
		// a (candidate) → b (candidate): b is eliminated, a survives
		const { outLinks, inLinks } = makeLinks([["a.md", "b.md"]]);
		const app = makeApp({
			"a.md": { frontmatter: { chain: "root-title" } },
			"b.md": { frontmatter: { chain: "child-title" } },
		});
		expect(computeTitle("a.md", outLinks, inLinks, app as never)).toBe("root-title");
	});

	it("non-candidate in-between does not protect the downstream candidate", () => {
		// a (candidate) → mid (no chain/tag) → b (candidate): b still eliminated
		const { outLinks, inLinks } = makeLinks([["a.md", "mid.md"], ["mid.md", "b.md"]]);
		const app = makeApp({
			"a.md": { frontmatter: { chain: "root-title" } },
			"b.md": { frontmatter: { chain: "child-title" } },
		});
		expect(computeTitle("a.md", outLinks, inLinks, app as never)).toBe("root-title");
	});
});

describe("computeTitle – candidate elimination (transitive)", () => {
	it("eliminates a candidate reachable only through other candidates", () => {
		// a → b → c, all candidates; b and c are eliminated, a survives
		const { outLinks, inLinks } = makeLinks([["a.md", "b.md"], ["b.md", "c.md"]]);
		const app = makeApp({
			"a.md": { frontmatter: { chain: "top" } },
			"b.md": { frontmatter: { chain: "mid" } },
			"c.md": { frontmatter: { chain: "bot" } },
		});
		expect(computeTitle("a.md", outLinks, inLinks, app as never)).toBe("top");
	});
});

describe("computeTitle – collision", () => {
	it("reports collision when two candidates are not reachable from each other", () => {
		// root → a (candidate), root → b (candidate); neither reaches the other
		const { outLinks, inLinks } = makeLinks([
			["root.md", "a.md"],
			["root.md", "b.md"],
		]);
		const app = makeApp({
			"a.md": { frontmatter: { chain: "alpha" } },
			"b.md": { frontmatter: { chain: "beta" } },
		});
		const title = computeTitle("root.md", outLinks, inLinks, app as never);
		expect(title).toBe("chain collision: [alpha, beta]");
	});

	it("collision values are sorted alphabetically", () => {
		const { outLinks, inLinks } = makeLinks([
			["root.md", "z.md"],
			["root.md", "a.md"],
		]);
		const app = makeApp({
			"z.md": { frontmatter: { chain: "zzz" } },
			"a.md": { frontmatter: { chain: "aaa" } },
		});
		const title = computeTitle("root.md", outLinks, inLinks, app as never);
		expect(title).toBe("chain collision: [aaa, zzz]");
	});
});
