// Rainbow color utilities: injects keyframe CSS once and exports class names
// for animated, color-cycling "rainbow light" backgrounds / borders / text.
// Colors deliberately avoid bright yellow — orange-yellow (#f59e0b) is used.

let injected = false;

const COLORS = [
	"#ef4444",
	"#f97316",
	"#f59e0b",
	"#84cc16",
	"#06b6d4",
	"#8b5cf6",
	"#ec4899",
];
const GRADIENT = `linear-gradient(90deg, ${COLORS.join(", ")})`;

const SOFT_COLORS = [
	"rgba(239,68,68,.14)",
	"rgba(249,115,22,.14)",
	"rgba(245,158,11,.14)",
	"rgba(132,204,22,.14)",
	"rgba(6,182,212,.14)",
	"rgba(139,92,246,.14)",
	"rgba(236,72,153,.14)",
];

function ensureRainbowStyles(): void {
	if (injected || typeof document === "undefined") return;
	injected = true;
	const css = `
@keyframes rainbow-slide {
  0% { background-position: 0% 50%; }
  100% { background-position: 200% 50%; }
}
@keyframes rainbow-fart-spin {
  to { transform: rotate(360deg); }
}
.rainbow-fart-spin {
  animation: rainbow-fart-spin .8s linear infinite;
}
.rainbow-background {
  background-image: ${GRADIENT};
  background-size: 200% 100%;
  animation: rainbow-slide 6s linear infinite;
}
.rainbow-secondary-background {
  background-image: linear-gradient(90deg, ${SOFT_COLORS.join(", ")});
  background-size: 200% 100%;
  animation: rainbow-slide 6s linear infinite;
}
.rainbow-border {
  border: 1px solid transparent;
  background-image:
    linear-gradient(var(--rf-surface, #ffffff), var(--rf-surface, #ffffff)) padding-box,
    ${GRADIENT} border-box;
  background-size: 200% 100%;
  animation: rainbow-slide 6s linear infinite;
}
.rainbow-text {
  background-image: ${GRADIENT};
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: rainbow-slide 6s linear infinite;
}
`;
	const style = document.createElement("style");
	style.textContent = css;
	document.head.appendChild(style);
}

ensureRainbowStyles();

export const rainbow = {
	background: "rainbow-background",
	secondaryBackground: "rainbow-secondary-background",
	border: "rainbow-border",
	text: "rainbow-text",
};
