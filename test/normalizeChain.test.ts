import { describe, it, expect } from "vitest";
import { normalizeChain } from "../src/main";

describe("normalizeChain", () => {
	it("returns [] for null", () => {
		expect(normalizeChain(null)).toEqual([]);
	});

	it("returns [] for undefined", () => {
		expect(normalizeChain(undefined)).toEqual([]);
	});

	it("wraps a string in an array", () => {
		expect(normalizeChain("project-alpha")).toEqual(["project-alpha"]);
	});

	it("passes through a string array unchanged", () => {
		expect(normalizeChain(["a", "b"])).toEqual(["a", "b"]);
	});

	it("converts a number to a string array", () => {
		expect(normalizeChain(42)).toEqual(["42"]);
	});

	it("converts mixed array elements to strings", () => {
		expect(normalizeChain([1, true, "x"])).toEqual(["1", "true", "x"]);
	});
});
