<!--
	CodeEditor Component - Powered by CodeMirror 6
	
	A flexible code editor with syntax highlighting, theme support, and readonly mode.
	
	Usage:
		<CodeEditor
			value={code}
			language="yaml"
			theme="dark"
			readonly={false}
			onchange={(newValue) => code = newValue}
			class="h-96"
		/>
-->

<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { EditorView, type ViewUpdate } from '@codemirror/view';
	import { EditorState, type Extension, Compartment, Prec } from '@codemirror/state';
	import { basicSetup } from 'codemirror';
	import { yaml } from '@codemirror/lang-yaml';
	import { javascript } from '@codemirror/lang-javascript';
	import { json } from '@codemirror/lang-json';
	import { oneDark } from '@codemirror/theme-one-dark';

	interface Props {
		value: string;
		/** Increment this to force-reset the editor content (e.g., after loading new YAML) */
		resetKey?: number;
		language?: 'yaml' | 'javascript' | 'json' | 'typescript';
		theme?: 'light' | 'dark';
		readonly?: boolean;
		fontFamily?: string;
		onchange?: (value: string) => void;
		class?: string;
	}

	let {
		value = '',
		resetKey = 0,
		language = 'yaml',
		theme = 'dark',
		readonly = false,
		fontFamily = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
		onchange,
		class: className = ''
	}: Props = $props();

	let editorContainer: HTMLDivElement;
	let editorView: EditorView | null = null;

	// Compartments allow hot-swapping extensions without recreating the editor
	const themeCompartment = new Compartment();
	const languageCompartment = new Compartment();
	const editableCompartment = new Compartment();
	const fontCompartment = new Compartment();

	// Language extensions map
	const languageExtensions: Record<string, () => Extension> = {
		yaml: () => yaml(),
		javascript: () => javascript(),
		typescript: () => javascript({ typescript: true }),
		json: () => json()
	};

	// Light theme for CodeMirror
	const lightTheme = EditorView.theme(
		{
			'&': { backgroundColor: '#ffffff', color: '#24292e' },
			'.cm-content': { caretColor: '#24292e' },
			'.cm-cursor, .cm-dropCursor': { borderLeftColor: '#24292e' },
			'&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
				backgroundColor: '#b4d5fe'
			},
			'.cm-activeLine': { backgroundColor: '#f6f8fa' },
			'.cm-gutters': { backgroundColor: '#f6f8fa', color: '#6e7781', border: 'none' },
			'.cm-activeLineGutter': { backgroundColor: '#e7ecf0' }
		},
		{ dark: false }
	);

	// Override oneDark to match zinc-950 background instead of #282c34
	// Prec.highest() is required so this wins over oneDark's own CSS specificity
	const darkOverrideTheme = Prec.highest(
		EditorView.theme(
			{
				'&': { backgroundColor: '#09090b' },
				'.cm-gutters': { backgroundColor: '#09090b', borderRight: '1px solid #27272a' },
				'.cm-activeLineGutter': { backgroundColor: '#18181b' },
				'.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
				'&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
					backgroundColor: '#1e3a5f'
				}
			},
			{ dark: true }
		)
	);

	onMount(() => {
		createEditor();
	});

	// ONLY reset editor content when resetKey changes (not on every value change)
	$effect(() => {
		void resetKey; // This is the only tracked dependency
		if (editorView) {
			// Read value without tracking so keystroke changes don't re-trigger this effect
			const content = untrack(() => value);
			editorView.dispatch({
				changes: { from: 0, to: editorView.state.doc.length, insert: content },
				selection: { anchor: 0 }
			});
		}
	});

	// Hot-swap theme without recreating the editor
	$effect(() => {
		if (editorView) {
			editorView.dispatch({
				effects: themeCompartment.reconfigure(
					theme === 'dark' ? [oneDark, darkOverrideTheme] : lightTheme
				)
			});
		}
	});

	// Hot-swap language without recreating the editor
	$effect(() => {
		if (editorView) {
			editorView.dispatch({
				effects: languageCompartment.reconfigure(languageExtensions[language]())
			});
		}
	});

	// Hot-swap readonly without recreating the editor
	$effect(() => {
		if (editorView) {
			editorView.dispatch({
				effects: editableCompartment.reconfigure([
					EditorView.editable.of(!readonly),
					EditorState.readOnly.of(readonly)
				])
			});
		}
	});

	// Hot-swap font family without recreating the editor
	$effect(() => {
		if (editorView) {
			editorView.dispatch({
				effects: fontCompartment.reconfigure(
					EditorView.theme({
						'&': { fontFamily },
						'.cm-scroller': { fontFamily: 'inherit' },
						'.cm-content': { fontFamily: 'inherit' }
					})
				)
			});
		}
	});

	function createEditor() {
		if (editorView) {
			editorView.destroy();
		}

		const extensions: Extension[] = [
			basicSetup,
			languageCompartment.of(languageExtensions[language]()),
			editableCompartment.of([
				EditorView.editable.of(!readonly),
				EditorState.readOnly.of(readonly)
			]),
			themeCompartment.of(theme === 'dark' ? [oneDark, darkOverrideTheme] : lightTheme),
			EditorView.updateListener.of((update: ViewUpdate) => {
				if (update.docChanged) {
					onchange?.(update.state.doc.toString());
				}
			}),
			EditorView.theme({
				'&': {
					height: '100%',
					fontSize: '13px',
				},
				'.cm-scroller': { overflow: 'auto' },
			}),
			fontCompartment.of(
				EditorView.theme({
					'&': { fontFamily },
					'.cm-scroller': { fontFamily: 'inherit' },
					'.cm-content': { fontFamily: 'inherit' }
				})
			)
		];

		editorView = new EditorView({
			state: EditorState.create({ doc: value, extensions }),
			parent: editorContainer
		});
	}

	onDestroy(() => {
		editorView?.destroy();
		editorView = null;
	});
</script>

<div bind:this={editorContainer} class={className}></div>

<style>
	:global(.cm-editor) {
		height: 100%;
	}

	:global(.cm-scroller) {
		overflow: auto;
	}
</style>
