// Activation status tag rendered in the conversation header utilities strip.
// 32px tall, 🌈 icon, rainbow border/text. Fixed width so switching between
// "点击激活" and "已激活" never jumps; after activation it shows "已激活" for
// a beat, then animates its width to 0 and unmounts (the tag disappears).
import { useEffect, useState, useSyncExternalStore } from "react";
import { ensureActivated, isActivated, subscribeActivation } from "./audio";
import { rainbow } from "./rainbow";
import { useAppColors } from "./theme";

const getSnapshot = () => isActivated();
const getServerSnapshot = () => false;

type Phase = "idle" | "activated" | "collapsing" | "gone";

// Fixed content width shared by both text states (centered), so the pill never
// resizes on state change.
const TAG_WIDTH = 132;

export function ActivationTag() {
	const colors = useAppColors();
	const activated = useSyncExternalStore(
		subscribeActivation,
		getSnapshot,
		getServerSnapshot,
	);
	const [phase, setPhase] = useState<Phase>("idle");

	useEffect(() => {
		if (!activated) {
			setPhase("idle");
			return;
		}
		setPhase("activated");
		const t1 = setTimeout(() => setPhase("collapsing"), 900);
		const t2 = setTimeout(() => setPhase("gone"), 900 + 500);
		return () => {
			clearTimeout(t1);
			clearTimeout(t2);
		};
	}, [activated]);

	if (phase === "gone") return null;

	const idle = phase === "idle";
	const shrinking = phase === "collapsing";

	return (
		<button
			type="button"
			onClick={() => idle && ensureActivated()}
			title={
				idle
					? "点击激活 Rainbow Fart（浏览器需一次点击才能播放声音）"
					: "Rainbow Fart 已激活：新消息会语音播报"
			}
			aria-hidden={!idle}
			style={{
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				gap: 6,
				height: 32,
				width: shrinking ? 0 : TAG_WIDTH,
				minWidth: shrinking ? 0 : undefined,
				padding: 0,
				borderRadius: 999,
				fontSize: 13,
				lineHeight: 1,
				cursor: idle ? "pointer" : "default",
				whiteSpace: "nowrap",
				overflow: "hidden",
				boxSizing: "border-box",
				background: colors.surface,
				border: `1px solid ${colors.border}`,
				opacity: shrinking ? 0 : 1,
				transition: shrinking
					? "width .5s ease, min-width .5s ease, opacity .5s ease"
					: "none",
			}}
		>
			<span
				className={rainbow.text}
				style={{ fontWeight: 600 }}
			>
				{idle ? "点击激活" : "已激活"}
			</span>
			<span aria-hidden style={{ fontSize: 16 }}>
				🌈
			</span>
		</button>
	);
}
