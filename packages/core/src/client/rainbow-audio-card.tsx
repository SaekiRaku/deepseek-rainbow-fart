import { LoaderCircle, Pause, Play } from "lucide-react";
import { useSyncExternalStore, type CSSProperties } from "react";
import type { RainbowAudioEventData } from "../rainbow-audio";
import {
	getPlaybackState,
	getRainbowCard,
	pauseAudio,
	playAudio,
	seekAudio,
	subscribePlayback,
	subscribeRainbowCards,
} from "./audio";
import { rainbow } from "./rainbow";
import { useAppColors, useColorScheme } from "./theme";

type TurnTailProps = {
	sessionId: string;
	turn: { turn: number };
};

function formatTime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
	const whole = Math.floor(seconds);
	return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function RainbowAudioTurnTail({ sessionId, turn }: TurnTailProps) {
	const data = useSyncExternalStore(
		subscribeRainbowCards,
		() => getRainbowCard(sessionId, turn.turn),
		() => null,
	);
	return data ? <RainbowAudioCard data={data} /> : null;
}

export function RainbowAudioCard({ data }: { data: RainbowAudioEventData }) {
	const colors = useAppColors();
	const scheme = useColorScheme();
	const playback = useSyncExternalStore(
		subscribePlayback,
		getPlaybackState,
		getPlaybackState,
	);
	const readyData = data.status === "ready" ? data : null;
	const failed = data.status === "error";
	const active = readyData !== null && playback.audioId === readyData.audioId;
	const playing = active && playback.playing;
	const duration = active && playback.duration > 0
		? playback.duration
		: readyData ? readyData.durationMs / 1000 : 0;
	const currentTime = active ? playback.currentTime : 0;
	const unavailable = active && playback.error;

	function togglePlayback(): void {
		if (!readyData) return;
		if (playing) pauseAudio();
		else playAudio(readyData.audioId, active && currentTime >= duration - 0.05);
	}

	return (
		<article
			className={rainbow.border}
			style={{
				"--rf-surface": colors.surface,
				width: "min(360px, 100%)",
				boxSizing: "border-box",
				padding: 12,
				borderRadius: 8,
				backgroundColor: colors.surface,
				color: colors.ink,
				boxShadow: scheme === "light" ? "0 8px 24px rgba(17, 24, 39, 0.1)" : "none",
			} as CSSProperties}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
				<button
					type="button"
					onClick={togglePlayback}
					title={readyData ? (playing ? "暂停" : "播放") : failed ? "构造彩虹屁失败" : "正在构造彩虹屁"}
					aria-label={readyData ? (playing ? "暂停 Rainbow Fart" : "播放 Rainbow Fart") : failed ? "构造彩虹屁失败" : "正在构造彩虹屁"}
					disabled={!readyData}
					style={{
						width: 36,
						height: 36,
						flex: "0 0 36px",
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
						border: `1px solid ${colors.border}`,
						borderRadius: "50%",
						background: colors.bubble,
						color: colors.ink,
						cursor: readyData ? "pointer" : "default",
					}}
				>
					{readyData ? (
						playing
							? <Pause size={16} fill="currentColor" strokeWidth={0} />
							: <Play size={16} fill="currentColor" strokeWidth={0} />
					) : failed ? (
						<span style={{ fontSize: 16, lineHeight: 1 }}>!</span>
					) : (
						<LoaderCircle size={16} className="rainbow-fart-spin" />
					)}
				</button>

				<div style={{ minWidth: 0, flex: 1 }}>
					<div style={{ display: "flex", alignItems: "center", marginBottom: 5 }}>
						<span className={rainbow.text} style={{ fontSize: 12, fontWeight: 700 }}>
							Rainbow Fart
						</span>
					</div>
					<p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, overflowWrap: "anywhere" }}>
						{readyData ? readyData.text : failed ? "构造彩虹屁失败" : "正在构造彩虹屁中..."}
					</p>
				</div>
			</div>

			{readyData && <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
				<input
					type="range"
					min={0}
					max={Math.max(duration, 0.01)}
					step={0.05}
					value={Math.min(currentTime, duration || 0)}
					onChange={(event) => seekAudio(readyData.audioId, Number(event.currentTarget.value))}
					aria-label="语音播放进度"
					style={{ width: "100%", minWidth: 0, accentColor: colors.accent }}
				/>
				<span style={{ flex: "0 0 auto", fontSize: 11, color: colors.muted }}>
					{formatTime(currentTime)} / {formatTime(duration)}
				</span>
			</div>}
			{unavailable && (
				<p style={{ margin: "7px 0 0", fontSize: 11, color: colors.warning }}>
					语音已失效，请生成新的 Rainbow Fart
				</p>
			)}
		</article>
	);
}
