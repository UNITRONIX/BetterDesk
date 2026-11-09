<!--
  QR code for a text (a server config, an enrolment link), drawn as one SVG
  path from the module matrix of qrcode-generator. Black modules on white
  with a 4-module quiet zone, in both themes: phone cameras and scanner
  apps expect dark on light and a light margin, and many fail on an
  inverted (light on dark) code, so the code keeps a white box in dark mode
  too (as the old keys page did).
  text: what the code holds (UTF-8). label: its accessible name ("QR code
  for the server configuration"). size: width and height in px (default
  200). level: error correction (L, M, Q, H; default M). Text too long for
  a QR code renders nothing.
-->
<script lang="ts">
	import qrcode from 'qrcode-generator';

	interface Props {
		text: string;
		label: string;
		size?: number;
		level?: 'L' | 'M' | 'Q' | 'H';
	}

	let { text, label, size = 200, level = 'M' }: Props = $props();

	const QUIET = 4;

	const matrix = $derived.by(() => {
		try {
			const qr = qrcode(0, level);
			// The library writes one byte per char code; hand it UTF-8 bytes
			// as a byte string so text outside Latin-1 encodes correctly
			const bytes = new TextEncoder().encode(text);
			let byteString = '';
			for (const b of bytes) byteString += String.fromCharCode(b);
			qr.addData(byteString, 'Byte');
			qr.make();
			const count = qr.getModuleCount();
			let d = '';
			for (let row = 0; row < count; row++) {
				for (let col = 0; col < count; col++) {
					if (qr.isDark(row, col)) d += `M${col + QUIET} ${row + QUIET}h1v1h-1z`;
				}
			}
			return { count, d };
		} catch {
			return null;
		}
	});

	const box = $derived(matrix ? matrix.count + QUIET * 2 : 0);
</script>

{#if matrix}
	<svg
		class="qr"
		role="img"
		aria-label={label}
		width={size}
		height={size}
		viewBox="0 0 {box} {box}"
		shape-rendering="crispEdges"
		><rect class="qr-light" width={box} height={box} /><path class="qr-dark" d={matrix.d} /></svg
	>
{/if}

<style>
	/* Fixed black on white in both themes: scanners need dark on light */
	.qr {
		display: block;
		max-width: 100%;
		height: auto;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		forced-color-adjust: none;
	}
	.qr-light {
		fill: #fff;
	}
	.qr-dark {
		fill: #000;
	}
</style>
