import { describe, expect, test } from 'vitest';
import {
	bounds,
	fitView,
	revealNode,
	snap,
	toCanvas,
	viewCentre,
	viewTransform,
	wirePath,
	zoomTo
} from '../../../src/lib/canvas/geometry.ts';
import { History } from '../../../src/lib/canvas/history.svelte.ts';

describe('view', () => {
	test('screen points map to the canvas through pan and zoom', () => {
		expect(toCanvas({ x: 100, y: 50, zoom: 2 }, 300, 250)).toEqual({ x: 100, y: 100 });
		expect(viewTransform({ x: 5, y: 6, zoom: 1.5 })).toBe('translate(5, 6) scale(1.5)');
		expect(viewCentre({ x: 0, y: 0, zoom: 1 }, { width: 800, height: 600 })).toEqual({ x: 400, y: 300 });
	});

	test('the wheel zooms around the pointer: the point under it stays', () => {
		const before = { x: 30, y: 40, zoom: 1 };
		const at = { x: 200, y: 150 };
		const after = zoomTo(before, 2, 0.25, 4, at);
		expect(toCanvas(after, at.x, at.y)).toEqual(toCanvas(before, at.x, at.y));
		expect(after.zoom).toBe(2);
	});

	test('zoom is clamped; without a point the pan stays', () => {
		expect(zoomTo({ x: 7, y: 8, zoom: 1 }, 10, 0.25, 4)).toEqual({ x: 7, y: 8, zoom: 4 });
		expect(zoomTo({ x: 7, y: 8, zoom: 1 }, 0.01, 0.25, 4).zoom).toBe(0.25);
	});

	test('fit shows every node, centred, never zoomed past the maximum', () => {
		const nodes = [
			{ x: 0, y: 0 },
			{ x: 1000, y: 400 }
		];
		const size = { width: 800, height: 600 };
		const v = fitView(nodes, 180, 52, size, { pad: 60, min: 0.25, max: 2 });
		expect(v).not.toBeNull();
		if (!v) return;
		const box = bounds(nodes, 180, 52);
		const left = (box?.minX ?? 0) * v.zoom + v.x;
		const right = (box?.maxX ?? 0) * v.zoom + v.x;
		expect(left).toBeGreaterThanOrEqual(0);
		expect(right).toBeLessThanOrEqual(size.width);
		expect(Math.round(left)).toBe(Math.round(size.width - right));
		expect(fitView([{ x: 0, y: 0 }], 180, 52, size, { pad: 60, min: 0.25, max: 2 })?.zoom).toBe(2);
		expect(fitView([], 180, 52, size, { pad: 60, min: 0.25, max: 2 })).toBeNull();
	});

	test('a flow too wide at the smallest zoom starts at its top-left corner', () => {
		const nodes = [
			{ x: 100, y: 150 },
			{ x: 700, y: 220 }
		];
		// A phone: nodes stay at 85 % (44 px high), so the flow can't fit
		const v = fitView(nodes, 180, 52, { width: 360, height: 500 }, { pad: 60, min: 0.85, max: 2 });
		expect(v?.zoom).toBe(0.85);
		expect(v && 100 * v.zoom + v.x).toBeCloseTo(60 * 0.85);
		// It fits vertically, so it stays centred that way
		expect(v && 150 * v.zoom + v.y).toBeGreaterThan(60 * 0.85);
	});

	test('a node off screen is panned into view, a visible one leaves the view alone', () => {
		const view = { x: 0, y: 0, zoom: 1 };
		const size = { width: 800, height: 600 };
		expect(revealNode(view, { x: 100, y: 100 }, 180, 52, size)).toBe(view);
		const moved = revealNode(view, { x: 900, y: -50 }, 180, 52, size);
		expect(900 + 180 + moved.x).toBeLessThanOrEqual(800);
		expect(-50 + moved.y).toBeGreaterThanOrEqual(0);
	});
});

describe('wires and grid', () => {
	test('a wire leaves and enters horizontally', () => {
		expect(wirePath({ x: 0, y: 0 }, { x: 100, y: 50 }, 0.5)).toBe('M 0 0 C 50 0, 50 50, 100 50');
		expect(wirePath({ x: 0, y: 0 }, { x: 100, y: 50 }, 0.4)).toBe('M 0 0 C 40 0, 60 50, 100 50');
	});

	test('snapping to a 20 px grid', () => {
		expect([snap(9, 20), snap(10, 20), snap(31, 20), snap(-11, 20)]).toEqual([0, 20, 40, -20]);
	});
});

describe('undo and redo', () => {
	test('steps back and forth; a new change clears redo', () => {
		const h = new History<{ n: number }>(50);
		expect(h.canUndo).toBe(false);
		h.push({ n: 1 });
		h.push({ n: 2 });
		expect(h.undo({ n: 3 })).toEqual({ n: 2 });
		expect(h.canRedo).toBe(true);
		expect(h.redo({ n: 2 })).toEqual({ n: 3 });
		expect(h.undo({ n: 3 })).toEqual({ n: 2 });
		h.push({ n: 2 });
		expect(h.canRedo).toBe(false);
		expect(h.redo({ n: 9 })).toBeNull();
	});

	test('keeps the last 50 steps', () => {
		const h = new History<number>(50);
		for (let i = 0; i < 60; i++) h.push(i);
		let last: number | null = null;
		let count = 0;
		for (let v = h.undo(99); v !== null; v = h.undo(v)) {
			last = v;
			count++;
		}
		expect(count).toBe(50);
		expect(last).toBe(10);
	});

	test('snapshots are copies: later changes don’t leak into history', () => {
		const h = new History<{ list: number[] }>();
		const doc = { list: [1] };
		h.push(doc);
		doc.list.push(2);
		expect(h.undo(doc)).toEqual({ list: [1] });
	});
});
