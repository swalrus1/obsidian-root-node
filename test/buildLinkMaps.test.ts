import { describe, it, expect } from "vitest";
import { buildLinkMaps } from "../src/main";
import { buildApp, mkFile } from "./helpers";

describe("buildLinkMaps – explicit links", () => {
	it("produces empty maps for an isolated note", () => {
		const app = buildApp({ files: [mkFile("a.md")] });
		const { outLinks, inLinks } = buildLinkMaps(app as never);
		expect([...outLinks.get("a.md")!]).toEqual([]);
		expect([...inLinks.get("a.md")!]).toEqual([]);
	});

	it("records a → b edge in both maps", () => {
		const app = buildApp({
			files: [mkFile("a.md"), mkFile("b.md")],
			links: { "a.md": ["b.md"] },
		});
		const { outLinks, inLinks } = buildLinkMaps(app as never);
		expect(outLinks.get("a.md")).toContain("b.md");
		expect(inLinks.get("b.md")).toContain("a.md");
	});

	it("ignores self-links", () => {
		const app = buildApp({
			files: [mkFile("a.md")],
			links: { "a.md": ["a.md"] },
		});
		const { outLinks } = buildLinkMaps(app as never);
		expect([...outLinks.get("a.md")!]).toEqual([]);
	});

	it("ignores links to files not in the vault", () => {
		const app = buildApp({
			files: [mkFile("a.md")],
			links: { "a.md": ["ghost.md"] },
		});
		const { outLinks } = buildLinkMaps(app as never);
		expect([...outLinks.get("a.md")!]).toEqual([]);
	});
});

describe("buildLinkMaps – tag-based edges", () => {
	it("adds newer → older edge for two notes sharing a tag", () => {
		const app = buildApp({
			files: [mkFile("old.md", 1), mkFile("new.md", 2)],
			caches: {
				"old.md": { _tags: ["#project"] },
				"new.md": { _tags: ["#project"] },
			},
		});
		const { outLinks, inLinks } = buildLinkMaps(app as never);
		expect(outLinks.get("new.md")).toContain("old.md");
		expect(inLinks.get("old.md")).toContain("new.md");
	});

	it("does NOT add reverse edge (older does not reference newer)", () => {
		const app = buildApp({
			files: [mkFile("old.md", 1), mkFile("new.md", 2)],
			caches: {
				"old.md": { _tags: ["#project"] },
				"new.md": { _tags: ["#project"] },
			},
		});
		const { outLinks } = buildLinkMaps(app as never);
		expect(outLinks.get("old.md")).not.toContain("new.md");
	});

	it("adds no edge when two notes share a tag but have equal ctime", () => {
		const app = buildApp({
			files: [mkFile("a.md", 5), mkFile("b.md", 5)],
			caches: {
				"a.md": { _tags: ["#same"] },
				"b.md": { _tags: ["#same"] },
			},
		});
		const { outLinks } = buildLinkMaps(app as never);
		expect([...outLinks.get("a.md")!]).not.toContain("b.md");
		expect([...outLinks.get("b.md")!]).not.toContain("a.md");
	});

	it("chains three tag-mates consecutively, not pairwise", () => {
		// newest(3) → mid(2) → oldest(1)
		// Only 2 edges should be created, not 3 (pairwise would add newest→oldest too,
		// but that's already reachable transitively).
		const app = buildApp({
			files: [mkFile("old.md", 1), mkFile("mid.md", 2), mkFile("new.md", 3)],
			caches: {
				"old.md": { _tags: ["#t"] },
				"mid.md": { _tags: ["#t"] },
				"new.md": { _tags: ["#t"] },
			},
		});
		const { outLinks } = buildLinkMaps(app as never);
		// Consecutive edges only
		expect(outLinks.get("new.md")).toContain("mid.md");
		expect(outLinks.get("mid.md")).toContain("old.md");
		// Direct newest→oldest edge must NOT exist (that would be pairwise)
		expect(outLinks.get("new.md")).not.toContain("old.md");
	});

	it("handles notes with multiple tags independently", () => {
		const app = buildApp({
			files: [mkFile("a.md", 1), mkFile("b.md", 2), mkFile("c.md", 3)],
			caches: {
				"a.md": { _tags: ["#x"] },
				"b.md": { _tags: ["#x", "#y"] },
				"c.md": { _tags: ["#y"] },
			},
		});
		const { outLinks } = buildLinkMaps(app as never);
		// #x chain: b(2) → a(1)
		expect(outLinks.get("b.md")).toContain("a.md");
		// #y chain: c(3) → b(2)
		expect(outLinks.get("c.md")).toContain("b.md");
	});
});
