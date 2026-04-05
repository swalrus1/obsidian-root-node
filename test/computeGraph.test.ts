import { describe, it, expect } from "vitest";
import { computeGraph } from "../src/main";
import { buildApp, mkFile } from "./helpers";

describe("computeGraph – root detection", () => {
	it("a single isolated note is a root", () => {
		const app = buildApp({ files: [mkFile("a.md")] });
		const { rootNodes, cycleRoots } = computeGraph(app as never);
		expect(rootNodes).toContain("a.md");
		expect(cycleRoots).toHaveLength(0);
	});

	it("a note with only outgoing links is a root", () => {
		const app = buildApp({
			files: [mkFile("a.md"), mkFile("b.md")],
			links: { "a.md": ["b.md"] },
		});
		const { rootNodes } = computeGraph(app as never);
		expect(rootNodes).toContain("a.md");
		expect(rootNodes).not.toContain("b.md");
	});

	it("a note referenced from outside is not a root", () => {
		const app = buildApp({
			files: [mkFile("root.md"), mkFile("child.md"), mkFile("grandchild.md")],
			links: { "root.md": ["child.md"], "child.md": ["grandchild.md"] },
		});
		const { rootNodes } = computeGraph(app as never);
		expect(rootNodes).toEqual(["root.md"]);
	});

	it("two independent notes are both roots", () => {
		const app = buildApp({ files: [mkFile("a.md"), mkFile("b.md")] });
		const { rootNodes } = computeGraph(app as never);
		expect(rootNodes).toContain("a.md");
		expect(rootNodes).toContain("b.md");
	});

	it("two independent chains each have one root", () => {
		const app = buildApp({
			files: [mkFile("r1.md"), mkFile("c1.md"), mkFile("r2.md"), mkFile("c2.md")],
			links: { "r1.md": ["c1.md"], "r2.md": ["c2.md"] },
		});
		const { rootNodes } = computeGraph(app as never);
		expect(rootNodes).toContain("r1.md");
		expect(rootNodes).toContain("r2.md");
		expect(rootNodes).not.toContain("c1.md");
		expect(rootNodes).not.toContain("c2.md");
	});
});

describe("computeGraph – cycle detection", () => {
	it("a two-note cycle is reported as a cycle root, not a regular root", () => {
		const app = buildApp({
			files: [mkFile("a.md"), mkFile("b.md")],
			links: { "a.md": ["b.md"], "b.md": ["a.md"] },
		});
		const { rootNodes, cycleRoots } = computeGraph(app as never);
		expect(rootNodes).toHaveLength(0);
		expect(cycleRoots).toHaveLength(1);
	});

	it("cycle root is the alphabetically first node in the SCC", () => {
		const app = buildApp({
			files: [mkFile("z.md"), mkFile("a.md")],
			links: { "z.md": ["a.md"], "a.md": ["z.md"] },
		});
		const { cycleRoots } = computeGraph(app as never);
		expect(cycleRoots[0]).toBe("a.md");
	});

	it("a cycle referenced by an external note is not a root", () => {
		// ext → a ↔ b: the cycle {a,b} has an external parent, so it should not appear
		const app = buildApp({
			files: [mkFile("ext.md"), mkFile("a.md"), mkFile("b.md")],
			links: { "ext.md": ["a.md"], "a.md": ["b.md"], "b.md": ["a.md"] },
		});
		const { rootNodes, cycleRoots } = computeGraph(app as never);
		expect(rootNodes).toContain("ext.md");
		expect(cycleRoots).toHaveLength(0);
	});

	it("returns both a regular root and a separate cycle root when independent", () => {
		const app = buildApp({
			files: [mkFile("solo.md"), mkFile("p.md"), mkFile("q.md")],
			links: { "p.md": ["q.md"], "q.md": ["p.md"] },
		});
		const { rootNodes, cycleRoots } = computeGraph(app as never);
		expect(rootNodes).toContain("solo.md");
		expect(cycleRoots).toHaveLength(1);
	});
});
