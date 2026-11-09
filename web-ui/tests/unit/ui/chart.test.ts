import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import Chart from '../../../src/lib/ui/Chart.svelte';
import ConnectionDiagram from '../../../src/lib/ui/ConnectionDiagram.svelte';

const week = {
	label: 'Devices online',
	summary: 'Between 3 and 9 devices were online this week.',
	labels: ['Mon', 'Tue', 'Wed', 'Thu'],
	series: [
		{ name: 'Online', values: [3, 9, null, 5] },
		{ name: 'Away', values: [1, 2, 4, 0] }
	],
	xHeading: 'Day'
};

const plot = () => screen.getByRole('group', { name: /devices online/i });
const live = () => document.querySelector('figure.chart [aria-live="polite"]')!;

describe('Chart', () => {
	test('draws one mark group per series, a legend naming each and the summary above', () => {
		render(Chart, { ...week });
		expect(screen.getByText(week.summary)).toHaveClass('chart-summary');
		const svg = plot().querySelector('svg')!;
		expect(svg.querySelectorAll('.chart-series-1 .chart-line')).toHaveLength(1);
		expect(svg.querySelectorAll('.chart-series-2 .chart-line')).toHaveLength(1);
		// The gap splits the first series into two pieces
		expect(svg.querySelector('.chart-series-1 .chart-line')!.getAttribute('d')!.match(/M/g)).toHaveLength(2);
		const legend = document.querySelector('.chart-legend')!;
		expect(
			within(legend as HTMLElement)
				.getAllByRole('listitem')
				.map((li) => li.textContent?.trim())
		).toEqual(['Online', 'Away']);
		expect(plot()).toHaveAttribute('aria-label', `${week.label}. ${week.summary}`);
		expect(plot()).toHaveAttribute('aria-roledescription', 'chart');
	});

	test('columns draw a bar per positive value and the legend keys become blocks', () => {
		render(Chart, { ...week, kind: 'columns' });
		const svg = plot().querySelector('svg')!;
		expect(svg.querySelectorAll('.chart-series-1 .chart-bar')).toHaveLength(3);
		expect(svg.querySelectorAll('.chart-series-2 .chart-bar')).toHaveLength(3);
		expect(document.querySelectorAll('.chart-legend .chart-key.is-block')).toHaveLength(2);
	});

	test('one series has no legend', () => {
		render(Chart, { ...week, series: [week.series[0]!] });
		expect(document.querySelector('.chart-legend')).toBeNull();
	});

	test('the arrow keys, Home and End move the crosshair and announce the values', async () => {
		const user = userEvent.setup();
		render(Chart, { ...week });
		expect(plot()).toHaveAttribute('tabindex', '0');
		await user.tab();
		expect(plot()).toHaveFocus();
		expect(plot().querySelector('.chart-cross')).toBeNull();

		await user.keyboard('{Home}');
		expect(live()).toHaveTextContent('Mon: Online 3, Away 1');
		const x0 = Number(plot().querySelector('.chart-cross')!.getAttribute('x1'));
		expect(plot().querySelector('.chart-tip')).toHaveTextContent('Mon');

		await user.keyboard('{ArrowRight}');
		expect(live()).toHaveTextContent('Tue: Online 9, Away 2');
		expect(Number(plot().querySelector('.chart-cross')!.getAttribute('x1'))).toBeGreaterThan(x0);

		await user.keyboard('{ArrowRight}');
		// A gap reads as a dash, not as zero
		expect(live()).toHaveTextContent('Wed: Online –, Away 4');

		await user.keyboard('{End}');
		expect(live()).toHaveTextContent('Thu: Online 5, Away 0');
		await user.keyboard('{ArrowRight}');
		expect(live()).toHaveTextContent('Thu: Online 5, Away 0');

		await user.keyboard('{ArrowLeft}');
		expect(live()).toHaveTextContent('Wed:');

		await user.keyboard('{Escape}');
		expect(plot().querySelector('.chart-cross')).toBeNull();
		expect(plot().querySelector('.chart-tip')).toBeNull();
	});

	test('"Show the numbers" has a table with every value, formatted', async () => {
		const user = userEvent.setup();
		render(Chart, {
			...week,
			series: [{ name: 'CPU', values: [12, 50, null, 100] }],
			format: 'percent',
			yMax: 100
		});
		await user.click(screen.getByText('Show the numbers'));
		const region = screen.getByRole('region', { name: 'Devices online as a table' });
		const table = within(region).getByRole('table');
		expect(
			within(table)
				.getAllByRole('columnheader')
				.map((th) => th.textContent)
		).toEqual(['Day', 'CPU']);
		const rows = within(table).getAllByRole('row').slice(1);
		expect(rows.map((r) => [...r.children].map((c) => c.textContent))).toEqual([
			['Mon', '12%'],
			['Tue', '50%'],
			['Wed', '–'],
			['Thu', '100%']
		]);
		// The y ticks use the same format
		expect([...plot().querySelectorAll('svg text')].map((t) => t.textContent)).toContain('100%');
	});

	test('labels and names from data stay text', () => {
		const evil = '<img src=x onerror=alert(1)>';
		render(Chart, {
			...week,
			labels: [evil, 'Tue'],
			series: [{ name: evil, values: [1, 2] }],
			summary: evil
		});
		expect(document.querySelector('img')).toBeNull();
		expect(screen.getAllByText(evil).length).toBeGreaterThan(1);
	});
});

describe('ConnectionDiagram', () => {
	const props = {
		idServer: 'remote.example.com',
		relay: 'relay.example.com',
		idPort: 21116,
		relayPort: 21117
	};

	test('direct first: the steps say direct, otherwise relay, and the direct path is drawn', () => {
		render(ConnectionDiagram, { ...props, mode: 'direct-first' });
		const steps = screen.getAllByRole('listitem').map((li) => li.textContent);
		expect(steps).toEqual([
			'Both computers keep in touch with the ID server (remote.example.com:21116). When you connect, it tells each side where the other is.',
			'If the networks allow it, the two computers then talk to each other directly.',
			'Otherwise the session goes through the relay server (relay.example.com:21117).'
		]);
		expect(document.querySelectorAll('.dg-edge.is-direct')).toHaveLength(1);
		expect(document.querySelector('.dg-edge.is-off')).toBeNull();
		const img = screen.getByRole('img');
		expect(img.getAttribute('aria-labelledby')).toBe(document.querySelector('figcaption')!.id);
	});

	test('relay only: the steps say direct is off and every session uses the relay', () => {
		render(ConnectionDiagram, { ...props, mode: 'relay-only' });
		const steps = screen.getAllByRole('listitem').map((li) => li.textContent);
		expect(steps).toEqual([
			'Both computers keep in touch with the ID server (remote.example.com:21116). When you connect, it tells each side where the other is.',
			'A direct connection is switched off on this server.',
			'Every session goes through the relay server (relay.example.com:21117).'
		]);
		expect(document.querySelectorAll('.dg-edge.is-off')).toHaveLength(1);
		expect(document.querySelector('.dg-edge.is-direct')).toBeNull();
		expect(document.querySelector('.dg-label.is-off')?.textContent).toBe('2 (off)');
	});

	test('the relay falls back to the ID server host, and each diagram has its own marker ids', () => {
		render(ConnectionDiagram, { idServer: 'id.example.com' });
		render(ConnectionDiagram, { idServer: 'id.example.com' });
		expect(screen.getAllByText(/relay server \(id\.example\.com:21117\)/)).toHaveLength(2);
		const ids = [...document.querySelectorAll('marker')].map((m) => m.id);
		expect(new Set(ids).size).toBe(4);
	});
});
