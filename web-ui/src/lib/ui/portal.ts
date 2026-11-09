/**
 * Attachment that moves an element to the end of <body> while it exists:
 * {@attach portal}. Dialogs and sheets use it so no page container (a
 * stacking context, overflow, a transform) can cover or clip them, and so
 * one opened later sits above one opened earlier. Use it only on a block's
 * single root element: Svelte removes the element itself when the block goes.
 */
export function portal(node: HTMLElement): () => void {
	document.body.appendChild(node);
	return () => node.remove();
}
