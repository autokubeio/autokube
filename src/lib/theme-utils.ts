/**
 * Theme utilities for applying fonts and settings across the application
 */

export interface FontMeta {
	id: string;
	name: string;
	family: string;
	googleFont?: string;
}

export const UI_FONTS: FontMeta[] = [
	{
		id: 'system',
		name: 'System UI',
		family: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
	},
	{
		id: 'geist',
		name: 'Geist',
		family: "'Geist', sans-serif",
		googleFont: 'Geist:wght@400;500;600;700'
	},
	{
		id: 'inter',
		name: 'Inter',
		family: "'Inter', sans-serif",
		googleFont: 'Inter:wght@400;500;600;700'
	},
	{
		id: 'plus-jakarta',
		name: 'Plus Jakarta Sans',
		family: "'Plus Jakarta Sans', sans-serif",
		googleFont: 'Plus+Jakarta+Sans:wght@400;500;600;700'
	},
	{
		id: 'dm-sans',
		name: 'DM Sans',
		family: "'DM Sans', sans-serif",
		googleFont: 'DM+Sans:wght@400;500;600;700'
	},
	{
		id: 'outfit',
		name: 'Outfit',
		family: "'Outfit', sans-serif",
		googleFont: 'Outfit:wght@400;500;600;700'
	},
	{
		id: 'space-grotesk',
		name: 'Space Grotesk',
		family: "'Space Grotesk', sans-serif",
		googleFont: 'Space+Grotesk:wght@400;500;600;700'
	},
	{
		id: 'sofia-sans',
		name: 'Sofia Sans',
		family: "'Sofia Sans', sans-serif",
		googleFont: 'Sofia+Sans:wght@400;500;600;700'
	},
	{
		id: 'nunito',
		name: 'Nunito',
		family: "'Nunito', sans-serif",
		googleFont: 'Nunito:wght@400;500;600;700'
	},
	{
		id: 'poppins',
		name: 'Poppins',
		family: "'Poppins', sans-serif",
		googleFont: 'Poppins:wght@400;500;600;700'
	},
	{
		id: 'montserrat',
		name: 'Montserrat',
		family: "'Montserrat', sans-serif",
		googleFont: 'Montserrat:wght@400;500;600;700'
	},
	{
		id: 'raleway',
		name: 'Raleway',
		family: "'Raleway', sans-serif",
		googleFont: 'Raleway:wght@400;500;600;700'
	},
	{
		id: 'manrope',
		name: 'Manrope',
		family: "'Manrope', sans-serif",
		googleFont: 'Manrope:wght@400;500;600;700'
	},
	{
		id: 'roboto',
		name: 'Roboto',
		family: "'Roboto', sans-serif",
		googleFont: 'Roboto:wght@400;500;600;700'
	},
	{
		id: 'open-sans',
		name: 'Open Sans',
		family: "'Open Sans', sans-serif",
		googleFont: 'Open+Sans:wght@400;500;600;700'
	},
	{ id: 'lato', name: 'Lato', family: "'Lato', sans-serif", googleFont: 'Lato:wght@400;700' },
	{
		id: 'source-sans',
		name: 'Source Sans 3',
		family: "'Source Sans 3', sans-serif",
		googleFont: 'Source+Sans+3:wght@400;500;600;700'
	},
	{
		id: 'work-sans',
		name: 'Work Sans',
		family: "'Work Sans', sans-serif",
		googleFont: 'Work+Sans:wght@400;500;600;700'
	},
	{
		id: 'fira-sans',
		name: 'Fira Sans',
		family: "'Fira Sans', sans-serif",
		googleFont: 'Fira+Sans:wght@400;500;600;700'
	},
	{
		id: 'quicksand',
		name: 'Quicksand',
		family: "'Quicksand', sans-serif",
		googleFont: 'Quicksand:wght@400;500;600;700'
	},
	{
		id: 'comfortaa',
		name: 'Comfortaa',
		family: "'Comfortaa', sans-serif",
		googleFont: 'Comfortaa:wght@400;500;600;700'
	}
];

export const FONT_SIZES = [
	{ id: 'small', name: 'Small', value: '14px' },
	{ id: 'normal', name: 'Normal', value: '16px' },
	{ id: 'large', name: 'Large', value: '18px' },
	{ id: 'extra-large', name: 'Extra Large', value: '20px' }
];

export const MONO_FONTS: FontMeta[] = [
	{
		id: 'system-mono',
		name: 'System Mono',
		family: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
	},
	{
		id: 'fira-code',
		name: 'Fira Code',
		family: "'Fira Code', monospace",
		googleFont: 'Fira+Code:wght@400;500;600'
	},
	{
		id: 'jetbrains-mono',
		name: 'JetBrains Mono',
		family: "'JetBrains Mono', monospace",
		googleFont: 'JetBrains+Mono:wght@400;500;600'
	},
	{
		id: 'cascadia-code',
		name: 'Cascadia Code',
		family: "'Cascadia Code', monospace",
		googleFont: 'Cascadia+Code:wght@400;500;600'
	},
	{
		id: 'source-code-pro',
		name: 'Source Code Pro',
		family: "'Source Code Pro', monospace",
		googleFont: 'Source+Code+Pro:wght@400;500;600'
	},
	{
		id: 'ibm-plex-mono',
		name: 'IBM Plex Mono',
		family: "'IBM Plex Mono', monospace",
		googleFont: 'IBM+Plex+Mono:wght@400;500;600'
	},
	{
		id: 'roboto-mono',
		name: 'Roboto Mono',
		family: "'Roboto Mono', monospace",
		googleFont: 'Roboto+Mono:wght@400;500;600'
	},
	{
		id: 'inconsolata',
		name: 'Inconsolata',
		family: "'Inconsolata', monospace",
		googleFont: 'Inconsolata:wght@400;500;600'
	}
];

export interface ThemeMeta {
	id: string;
	name: string;
	preview: {
		bg: string;
		sidebar: string;
		fg: string;
		primary: string;
		border: string;
	};
}

export const LIGHT_THEMES: ThemeMeta[] = [
	{
		id: 'default-light',
		name: 'Default',
		preview: {
			bg: '#ffffff',
			sidebar: '#fafafa',
			fg: '#171717',
			primary: '#18181b',
			border: '#e5e5e5'
		}
	},
	{
		id: 'light-plus',
		name: 'Light+',
		preview: {
			bg: '#ffffff',
			sidebar: '#fafafa',
			fg: '#212121',
			primary: '#0051ff',
			border: '#e6e6e6'
		}
	},
	{
		id: 'catppuccin-latte',
		name: 'Catppuccin Latte',
		preview: {
			bg: '#eff1f5',
			sidebar: '#e2e3e9',
			fg: '#4b4e68',
			primary: '#8839ef',
			border: '#cdd1da'
		}
	},
	{
		id: 'rose-pine-dawn',
		name: 'Rose Pine Dawn',
		preview: {
			bg: '#faf3eb',
			sidebar: '#f0e7dc',
			fg: '#49445f',
			primary: '#907aa9',
			border: '#ddd0be'
		}
	},
	{
		id: 'nord-light',
		name: 'Nord Light',
		preview: {
			bg: '#d8e0ec',
			sidebar: '#d1daeb',
			fg: '#2e3440',
			primary: '#5e81ac',
			border: '#bcc5d4'
		}
	},
	{
		id: 'solarized-light',
		name: 'Solarized Light',
		preview: {
			bg: '#fdf6e3',
			sidebar: '#f5e8c6',
			fg: '#576e75',
			primary: '#2a8cce',
			border: '#e3d3a8'
		}
	},
	{
		id: 'ayu-light',
		name: 'Ayu Light',
		preview: {
			bg: '#f8f8f8',
			sidebar: '#f2f2f2',
			fg: '#5c6773',
			primary: '#2b8ead',
			border: '#dedede'
		}
	},
	{
		id: 'quiet-light',
		name: 'Quiet Light',
		preview: {
			bg: '#f5f5f1',
			sidebar: '#eeede9',
			fg: '#333333',
			primary: '#3f57c4',
			border: '#d9d9d7'
		}
	},
	{
		id: 'github-light',
		name: 'GitHub Light',
		preview: {
			bg: '#ffffff',
			sidebar: '#f6f8fa',
			fg: '#24292f',
			primary: '#0969da',
			border: '#d0d7de'
		}
	},
	{
		id: 'atom-light',
		name: 'Atom Light',
		preview: {
			bg: '#f8f8f8',
			sidebar: '#f2f2f2',
			fg: '#383b47',
			primary: '#0384be',
			border: '#dbdbdb'
		}
	},
	{
		id: 'one-light',
		name: 'One Light',
		preview: {
			bg: '#f9f9fa',
			sidebar: '#eeeff2',
			fg: '#383b47',
			primary: '#3357ff',
			border: '#d9dae2'
		}
	},
	{
		id: 'material-lighter',
		name: 'Material Lighter',
		preview: {
			bg: '#fafafa',
			sidebar: '#f5f5f5',
			fg: '#2c6f80',
			primary: '#3fa7c0',
			border: '#dedede'
		}
	},
	{
		id: 'winter-light',
		name: 'Winter Light',
		preview: {
			bg: '#eff3f7',
			sidebar: '#e9eef4',
			fg: '#212832',
			primary: '#0077d1',
			border: '#cdd5de'
		}
	},
	{
		id: 'snazzy-light',
		name: 'Snazzy Light',
		preview: {
			bg: '#eef0f5',
			sidebar: '#e6e9f0',
			fg: '#272e3c',
			primary: '#54d6fb',
			border: '#d1d5e3'
		}
	},
	{
		id: 'panda-light',
		name: 'Panda Light',
		preview: {
			bg: '#fff4ee',
			sidebar: '#f8ede5',
			fg: '#2b2b2b',
			primary: '#3eacf5',
			border: '#e4d0c0'
		}
	},
	{
		id: 'night-owl-light',
		name: 'Night Owl Light',
		preview: {
			bg: '#ffffff',
			sidebar: '#f6f6f8',
			fg: '#484474',
			primary: '#09a49b',
			border: '#dddde3'
		}
	},
	{
		id: 'slack-ochin',
		name: 'Slack Ochin',
		preview: {
			bg: '#ffffff',
			sidebar: '#f4f6f8',
			fg: '#1e2e3d',
			primary: '#0568cb',
			border: '#d2d9e0'
		}
	},
	{
		id: 'gruvbox-light',
		name: 'Gruvbox Light',
		preview: {
			bg: '#fbf1c7',
			sidebar: '#ebdbb2',
			fg: '#3c3836',
			primary: '#458588',
			border: '#d5c4a1'
		}
	},
	{
		id: 'horizon-light',
		name: 'Horizon Light',
		preview: {
			bg: '#fce8e2',
			sidebar: '#f5ddd4',
			fg: '#1a1d28',
			primary: '#e8005c',
			border: '#dfc9be'
		}
	},
	{
		id: 'shades-light',
		name: 'Shades Light',
		preview: {
			bg: '#f5f4ff',
			sidebar: '#eae7ff',
			fg: '#2e2a5e',
			primary: '#5533ff',
			border: '#cdc7f0'
		}
	},
	{
		id: 'tokyo-day',
		name: 'Tokyo Day',
		preview: {
			bg: '#e1e2e9',
			sidebar: '#dcdde5',
			fg: '#3f4b6e',
			primary: '#4876d6',
			border: '#c4c6d0'
		}
	}
];

export const DARK_THEMES: ThemeMeta[] = [
	{
		id: 'default-dark',
		name: 'Default',
		preview: {
			bg: '#1f1f1f',
			sidebar: '#1a1a1a',
			fg: '#f2f2f2',
			primary: '#fafafa',
			border: '#383838'
		}
	},
	{
		id: 'dark-autokube',
		name: 'AutoKube',
		preview: {
			bg: '#1f1f1f',
			sidebar: '#1a1a1a',
			fg: '#f2f2f2',
			primary: '#22c55e',
			border: '#383838'
		}
	},
	{
		id: 'dark-plus',
		name: 'Dark+',
		preview: {
			bg: '#1f1f1f',
			sidebar: '#1a1a1a',
			fg: '#d4d4d4',
			primary: '#0066ff',
			border: '#404040'
		}
	},
	{
		id: 'catppuccin-mocha',
		name: 'Catppuccin Mocha',
		preview: {
			bg: '#1e1e2e',
			sidebar: '#181825',
			fg: '#cdd6f4',
			primary: '#cba6f7',
			border: '#45475a'
		}
	},
	{
		id: 'dracula',
		name: 'Dracula',
		preview: {
			bg: '#282a36',
			sidebar: '#21222c',
			fg: '#f8f8f2',
			primary: '#bd93f9',
			border: '#44475a'
		}
	},
	{
		id: 'rose-pine',
		name: 'Rose Pine',
		preview: {
			bg: '#191724',
			sidebar: '#120f1d',
			fg: '#e0def4',
			primary: '#ebbcba',
			border: '#393552'
		}
	},
	{
		id: 'rose-pine-moon',
		name: 'Rose Pine Moon',
		preview: {
			bg: '#232136',
			sidebar: '#1a1a2e',
			fg: '#e0def4',
			primary: '#c4a7e7',
			border: '#44415a'
		}
	},
	{
		id: 'tokyo-night',
		name: 'Tokyo Night',
		preview: {
			bg: '#1a1b26',
			sidebar: '#16161e',
			fg: '#a9b1d6',
			primary: '#7aa2f7',
			border: '#3b3d57'
		}
	},
	{
		id: 'nord',
		name: 'Nord',
		preview: {
			bg: '#2e3440',
			sidebar: '#242831',
			fg: '#d8dee9',
			primary: '#81a1c1',
			border: '#434c5e'
		}
	},
	{
		id: 'one-dark-pro',
		name: 'One Dark Pro',
		preview: {
			bg: '#282c34',
			sidebar: '#21252b',
			fg: '#abb2bf',
			primary: '#61afef',
			border: '#3e4451'
		}
	},
	{
		id: 'material-darker',
		name: 'Material Darker',
		preview: {
			bg: '#212121',
			sidebar: '#1a1a1a',
			fg: '#eaeff0',
			primary: '#80d8ff',
			border: '#424242'
		}
	},
	{
		id: 'solarized-dark',
		name: 'Solarized Dark',
		preview: {
			bg: '#002b36',
			sidebar: '#00202b',
			fg: '#839496',
			primary: '#268bd2',
			border: '#0d4050'
		}
	},
	{
		id: 'everforest',
		name: 'Everforest',
		preview: {
			bg: '#2d353b',
			sidebar: '#272d33',
			fg: '#d3c6aa',
			primary: '#83c092',
			border: '#475258'
		}
	},
	{
		id: 'kanagawa',
		name: 'Kanagawa',
		preview: {
			bg: '#1f1f28',
			sidebar: '#16161d',
			fg: '#dcd7ba',
			primary: '#7e9cd8',
			border: '#3d3d4f'
		}
	},
	{
		id: 'monokai',
		name: 'Monokai',
		preview: {
			bg: '#272822',
			sidebar: '#1e1f1a',
			fg: '#f8f8f2',
			primary: '#f92472',
			border: '#49483e'
		}
	},
	{
		id: 'monokai-pro',
		name: 'Monokai Pro',
		preview: {
			bg: '#2d2a2e',
			sidebar: '#221f22',
			fg: '#fcfcfa',
			primary: '#ff6188',
			border: '#504d51'
		}
	},
	{
		id: 'gruvbox-dark',
		name: 'Gruvbox Dark',
		preview: {
			bg: '#282828',
			sidebar: '#1d2021',
			fg: '#ebdbb2',
			primary: '#fabd2f',
			border: '#3c3836'
		}
	},
	{
		id: 'palenight',
		name: 'Palenight',
		preview: {
			bg: '#292d3e',
			sidebar: '#1b1e2b',
			fg: '#a6accd',
			primary: '#82aaff',
			border: '#444a65'
		}
	},
	{
		id: 'ayu-dark',
		name: 'Ayu Dark',
		preview: {
			bg: '#0b0e14',
			sidebar: '#080b11',
			fg: '#b3aba3',
			primary: '#39bae6',
			border: '#2c3347'
		}
	},
	{
		id: 'synthwave-84',
		name: 'Synthwave 84',
		preview: {
			bg: '#1f1535',
			sidebar: '#150f27',
			fg: '#ffffff',
			primary: '#ff7edb',
			border: '#3e3262'
		}
	},
	{
		id: 'cobalt2',
		name: 'Cobalt2',
		preview: {
			bg: '#1a3347',
			sidebar: '#122538',
			fg: '#d9edf3',
			primary: '#ffcc00',
			border: '#2e5a7a'
		}
	},
	{
		id: 'andromeda',
		name: 'Andromeda',
		preview: {
			bg: '#1f2329',
			sidebar: '#181d22',
			fg: '#e0d9e2',
			primary: '#00e6b8',
			border: '#3e4552'
		}
	},
	{
		id: 'github-dark',
		name: 'GitHub Dark',
		preview: {
			bg: '#161b22',
			sidebar: '#101419',
			fg: '#c9d1d9',
			primary: '#57a5ff',
			border: '#2a313c'
		}
	}
];

/**
 * Apply UI font to the document
 */
export function applyUIFont(fontId: string) {
	const font = UI_FONTS.find((f) => f.id === fontId);
	if (!font) return;

	if (font.googleFont) {
		const linkId = 'autokube-ui-font-link';
		let link = document.getElementById(linkId) as HTMLLinkElement | null;
		if (!link) {
			link = document.createElement('link');
			link.id = linkId;
			link.rel = 'stylesheet';
			document.head.appendChild(link);
		}
		link.href = `https://fonts.googleapis.com/css2?family=${font.googleFont}&display=swap`;
	}

	document.documentElement.style.setProperty('--font-sans', font.family);
	document.documentElement.style.fontFamily = font.family;
}

/**
 * Apply mono font to the document (terminal / editor)
 */
export function applyMonoFont(fontId: string) {
	const font = MONO_FONTS.find((f) => f.id === fontId);
	if (!font) return;

	if (font.googleFont) {
		const linkId = 'autokube-mono-font-link';
		let link = document.getElementById(linkId) as HTMLLinkElement | null;
		if (!link) {
			link = document.createElement('link');
			link.id = linkId;
			link.rel = 'stylesheet';
			document.head.appendChild(link);
		}
		link.href = `https://fonts.googleapis.com/css2?family=${font.googleFont}&display=swap`;
	}

	document.documentElement.style.setProperty('--font-mono', font.family);
}

/**
 * Apply font size to the document
 */
export function applyFontSize(sizeId: string) {
	const size = FONT_SIZES.find((s) => s.id === sizeId);
	if (size) {
		document.documentElement.style.fontSize = size.value;
		document.documentElement.style.setProperty('--font-size-base', size.value);
	}
}

/**
 * Apply grid font size
 */
export function applyGridFontSize(sizeId: string) {
	const size = FONT_SIZES.find((s) => s.id === sizeId);
	if (size) {
		document.documentElement.style.setProperty('--font-size-grid', size.value);
	}
}

/**
 * Apply theme class to the document
 */
export function applyThemeClass(themeId: string) {
	const root = document.documentElement;
	Array.from(root.classList)
		.filter((cls) => cls.startsWith('theme-'))
		.forEach((cls) => root.classList.remove(cls));

	if (themeId && themeId !== 'default-dark' && themeId !== 'default-light') {
		root.classList.add(`theme-${themeId}`);
	}
}
