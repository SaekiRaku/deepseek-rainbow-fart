// Theme helpers: follow the harness (dsh) light/dark color scheme so the
// rainbow-fart UI stays in sync when the user switches, and fall back to the
// OS preference when the host exposes no explicit marker. All components read
// colors from useAppColors() instead of hard-coding hex values.
import { useSyncExternalStore, type CSSProperties } from "react";

export type ColorScheme = "light" | "dark";

/** Attributes the host may set on <html> to advertise its color scheme. */
const SCHEME_ATTRS = [
	"data-mantine-color-scheme",
	"data-color-scheme",
	"data-theme",
];

/** dsh sets this on the body to switch the harness into its dark palette. */
const BODY_DARK_ATTR = "data-ds-dark-theme";

export function detectColorScheme(): ColorScheme {
	if (typeof document === "undefined") return "light";
	const body = document.body;
	if (body?.hasAttribute(BODY_DARK_ATTR)) return "dark";
	const root = document.documentElement;
	for (const attr of SCHEME_ATTRS) {
		const value = root.getAttribute(attr);
		if (value === "dark" || value === "light") return value;
	}
	if (root.classList.contains("dark")) return "dark";
	return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches
		? "dark"
		: "light";
}

function subscribeColorScheme(cb: () => void): () => void {
	if (typeof document === "undefined") return () => {};
	const targets: Array<{ el: Element; attrs: string[] }> = [];
	const body = document.body;
	if (body) targets.push({ el: body, attrs: [BODY_DARK_ATTR, "class", "style"] });
	const root = document.documentElement;
	targets.push({ el: root, attrs: [...SCHEME_ATTRS, "class", "style"] });

	const observer = new MutationObserver(() => cb());
	for (const target of targets) {
		observer.observe(target.el, { attributes: true, attributeFilter: target.attrs, subtree: false });
	}
	const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
	mq?.addEventListener?.("change", cb);
	return () => {
		observer.disconnect();
		mq?.removeEventListener?.("change", cb);
	};
}

const getServerSnapshot = (): ColorScheme => "light";

export function useColorScheme(): ColorScheme {
	return useSyncExternalStore(
		subscribeColorScheme,
		detectColorScheme,
		getServerSnapshot,
	);
}

/** Semantic color tokens for the rainbow-fart UI, per color scheme. */
export interface AppColors {
	/** Primary text. */
	ink: string;
	/** Secondary text (labels, meta). */
	muted: string;
	/** Label text (slightly stronger than muted). */
	label: string;
	/** Tertiary text (hints, placeholders). */
	faint: string;
	/** Page / card background. */
	surface: string;
	/** Subtle section/header background. */
	surfaceAlt: string;
	/** Soft block background (toolbars, quiet badges). */
	bubble: string;
	/** Hairline border. */
	border: string;
	/** Stronger border (inputs, buttons). */
	borderStrong: string;
	danger: string;
	dangerBg: string;
	dangerBorder: string;
	success: string;
	warning: string;
	/** Accent text used on quiet buttons (选用/编辑). */
	accent: string;
	/** Modal backdrop. */
	overlay: string;
}

export const LIGHT_COLORS: AppColors = {
	ink: "#111827",
	muted: "#6b7280",
	label: "#374151",
	faint: "#9ca3af",
	surface: "#ffffff",
	surfaceAlt: "#f8f9fb",
	bubble: "#f3f4f6",
	border: "#e5e7eb",
	borderStrong: "#d1d5db",
	danger: "#dc2626",
	dangerBg: "#fef2f2",
	dangerBorder: "#fecaca",
	success: "#16a34a",
	warning: "#b45309",
	accent: "#4f46e5",
	overlay: "rgba(17,24,39,.4)",
};

export const DARK_COLORS: AppColors = {
	ink: "#e5e7eb",
	muted: "#9ca3af",
	label: "#cbd5e1",
	faint: "#6b7280",
	surface: "#1f2227",
	surfaceAlt: "#262a31",
	bubble: "#2a2e35",
	border: "#343842",
	borderStrong: "#4b505a",
	danger: "#f87171",
	dangerBg: "rgba(220,38,38,.16)",
	dangerBorder: "rgba(248,113,113,.32)",
	success: "#4ade80",
	warning: "#fbbf24",
	accent: "#818cf8",
	overlay: "rgba(0,0,0,.55)",
};

export function colorsFor(scheme: ColorScheme): AppColors {
	return scheme === "dark" ? DARK_COLORS : LIGHT_COLORS;
}

/** Reactive color tokens for the current scheme (re-renders on scheme change). */
export function useAppColors(): AppColors {
	return colorsFor(useColorScheme());
}

/** CSS custom properties mirroring `colors`, so nested UI (e.g. the voice
 *  form modal) can consume the same tokens via var(--rf-*). */
export function colorsToCssVars(colors: AppColors): CSSProperties {
	return {
		"--rf-ink": colors.ink,
		"--rf-muted": colors.muted,
		"--rf-label": colors.label,
		"--rf-faint": colors.faint,
		"--rf-surface": colors.surface,
		"--rf-surface-alt": colors.surfaceAlt,
		"--rf-bubble": colors.bubble,
		"--rf-border": colors.border,
		"--rf-border-strong": colors.borderStrong,
		"--rf-danger": colors.danger,
		"--rf-danger-bg": colors.dangerBg,
		"--rf-danger-border": colors.dangerBorder,
		"--rf-success": colors.success,
		"--rf-warning": colors.warning,
		"--rf-accent": colors.accent,
		"--rf-overlay": colors.overlay,
	} as CSSProperties;
}