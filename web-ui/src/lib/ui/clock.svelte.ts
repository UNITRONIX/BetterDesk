/**
 * One clock for every relative time on the page ("just now", "5m ago").
 * It ticks once a minute while at least one reader is mounted and pauses
 * while the tab is hidden; coming back to the tab ticks at once. Reading
 * minuteNow() inside markup or $derived subscribes to it.
 */

import { createSubscriber } from 'svelte/reactivity';

const MINUTE = 60_000;

let now = Date.now();
let active = false;

const subscribe = createSubscriber((update) => {
	let timer: ReturnType<typeof setInterval> | undefined;
	const tick = () => {
		now = Date.now();
		update();
	};
	const start = () => {
		timer ??= setInterval(tick, MINUTE);
	};
	const stop = () => {
		clearInterval(timer);
		timer = undefined;
	};
	const onVisibility = () => {
		if (document.hidden) stop();
		else {
			tick();
			start();
		}
	};
	now = Date.now();
	active = true;
	if (!document.hidden) start();
	document.addEventListener('visibilitychange', onVisibility);
	return () => {
		stop();
		active = false;
		document.removeEventListener('visibilitychange', onVisibility);
	};
});

/** The current time, updated once a minute for reactive readers */
export function minuteNow(): number {
	subscribe();
	return active ? now : Date.now();
}
