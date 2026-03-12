/**
 * Svelte action for column resize handles
 *
 * Usage:
 * <div class="resize-handle" use:columnResize={{ onResize, onResizeEnd, minWidth }} />
 */

export interface ColumnResizeParams {
	onResize: (width: number) => void;
	onResizeEnd: (width: number) => void;
	minWidth?: number;
}

export function columnResize(node: HTMLElement, params: ColumnResizeParams) {
	let startX: number;
	let startWidth: number;
	let currentWidth: number;
	let currentParams = params;
	let isLeftHandle = false;

	function onMouseDown(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();

		// Get the parent th/td element's width
		const parent = node.parentElement;
		if (!parent) return;

		// Check if this is a left-side resize handle
		isLeftHandle = node.classList.contains('resize-handle-left');

		startX = e.clientX;
		startWidth = parent.offsetWidth;
		currentWidth = startWidth;

		// Set cursor for entire document during drag
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';

		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', onMouseUp);
	}

	function onMouseMove(e: MouseEvent) {
		let delta = e.clientX - startX;
		if (isLeftHandle) {
			delta = -delta;
		}
		currentWidth = Math.max(currentParams.minWidth ?? 50, startWidth + delta);
		currentParams.onResize(currentWidth);
	}

	function onMouseUp() {
		document.body.style.cursor = '';
		document.body.style.userSelect = '';

		window.removeEventListener('mousemove', onMouseMove);
		window.removeEventListener('mouseup', onMouseUp);

		// Use the calculated width, not the rendered width
		currentParams.onResizeEnd(currentWidth);
	}

	node.addEventListener('mousedown', onMouseDown);

	return {
		update(newParams: ColumnResizeParams) {
			currentParams = newParams;
		},
		destroy() {
			node.removeEventListener('mousedown', onMouseDown);
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
		}
	};
}
