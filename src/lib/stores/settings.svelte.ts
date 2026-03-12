import { browser } from '$app/environment';
import {
	applyUIFont,
	applyMonoFont,
	applyFontSize,
	applyGridFontSize,
	applyThemeClass
} from '$lib/theme-utils';

const STORAGE_KEY = 'autokube-settings';

export interface SettingsState {
	// Appearance
	lightTheme: string;
	darkTheme: string;
	// Typography
	font: string;
	fontSize: string;
	terminalFont: string;
	editorFont: string;
	gridFontSize: string;
	// Toggles
	showResourceUsage: boolean;
	compactTableRows: boolean;
	showNamespaceBadges: boolean;
	confirmDelete: boolean;
}

const defaults: SettingsState = {
	lightTheme: 'default-light',
	darkTheme: 'dark-autokube',
	font: 'system',
	fontSize: 'normal',
	terminalFont: 'fira-code',
	editorFont: 'system-mono',
	gridFontSize: 'normal',
	showResourceUsage: true,
	compactTableRows: false,
	showNamespaceBadges: true,
	confirmDelete: true
};

function loadFromStorage(): SettingsState {
	if (!browser) return { ...defaults };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) return { ...defaults, ...JSON.parse(raw) };
	} catch {
		/* ignore */
	}
	return { ...defaults };
}

function createSettingsStore() {
	const state = $state<SettingsState>(loadFromStorage());

	function save() {
		if (!browser) return;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	}

	function applyAll(currentMode: string | undefined) {
		if (!browser) return;
		applyUIFont(state.font);
		applyMonoFont(state.terminalFont);
		applyMonoFont(state.editorFont);
		applyFontSize(state.fontSize);
		applyGridFontSize(state.gridFontSize);

		const isDark = currentMode === 'dark';
		const themeId = isDark ? state.darkTheme : state.lightTheme;
		applyThemeClass(themeId);
	}

	return {
		get state() {
			return state;
		},

		get lightTheme() {
			return state.lightTheme;
		},
		set lightTheme(v: string) {
			state.lightTheme = v;
			save();
		},

		get darkTheme() {
			return state.darkTheme;
		},
		set darkTheme(v: string) {
			state.darkTheme = v;
			save();
		},

		get font() {
			return state.font;
		},
		set font(v: string) {
			state.font = v;
			save();
			applyUIFont(v);
		},

		get fontSize() {
			return state.fontSize;
		},
		set fontSize(v: string) {
			state.fontSize = v;
			save();
			applyFontSize(v);
		},

		get terminalFont() {
			return state.terminalFont;
		},
		set terminalFont(v: string) {
			state.terminalFont = v;
			save();
			applyMonoFont(v);
		},

		get editorFont() {
			return state.editorFont;
		},
		set editorFont(v: string) {
			state.editorFont = v;
			save();
			applyMonoFont(v);
		},

		get gridFontSize() {
			return state.gridFontSize;
		},
		set gridFontSize(v: string) {
			state.gridFontSize = v;
			save();
			applyGridFontSize(v);
		},

		get showResourceUsage() {
			return state.showResourceUsage;
		},
		set showResourceUsage(v: boolean) {
			state.showResourceUsage = v;
			save();
		},

		get compactTableRows() {
			return state.compactTableRows;
		},
		set compactTableRows(v: boolean) {
			state.compactTableRows = v;
			save();
		},

		get showNamespaceBadges() {
			return state.showNamespaceBadges;
		},
		set showNamespaceBadges(v: boolean) {
			state.showNamespaceBadges = v;
			save();
		},

		get confirmDelete() {
			return state.confirmDelete;
		},
		set confirmDelete(v: boolean) {
			state.confirmDelete = v;
			save();
		},

		applyAll
	};
}

export const settingsStore = createSettingsStore();
