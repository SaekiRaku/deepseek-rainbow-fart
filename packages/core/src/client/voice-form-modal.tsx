// Shared create/edit voice form modal (used by both "创建音色" and "编辑音色").
import { useRef, useState } from "react";
import { Play, Plus, X } from "lucide-react";
import { rainbow } from "./rainbow";

interface VoiceFormVoice {
	id: string;
	name?: string;
	gender?: string;
	language?: string;
	text?: string;
	speed?: number;
	avatar?: string;
	prompts?: string;
	description?: string;
}

interface VoiceFormModalProps {
	mode: "create" | "edit";
	initial?: VoiceFormVoice;
	avatarVersion?: number;
	busy: boolean;
	testing?: boolean;
	msg: string;
	onSubmit: (fd: FormData, mode: "create" | "edit") => void;
	onTest?: (fd: FormData, testText: string) => void;
	onClose: () => void;
}

// ── light theme primitives (kept in sync with config-view) ──────────────────
const label: React.CSSProperties = {
	display: "block",
	fontSize: 13,
	color: "var(--rf-label)",
	marginBottom: 6,
};
const hint: React.CSSProperties = {
	fontSize: 12,
	color: "var(--rf-faint)",
	marginTop: 6,
};
const textInput: React.CSSProperties = {
	width: "100%",
	padding: "8px 10px",
	borderRadius: 8,
	border: "1px solid var(--rf-border-strong)",
	background: "var(--rf-surface)",
	color: "var(--rf-ink)",
	fontSize: 13,
	boxSizing: "border-box",
};
const formSection: React.CSSProperties = {
	border: "1px solid var(--rf-border)",
	borderRadius: 10,
	background: "var(--rf-surface-alt)",
	padding: 14,
	marginBottom: 14,
};
const formSectionTitle: React.CSSProperties = {
	fontSize: 12,
	fontWeight: 600,
	letterSpacing: ".4px",
	textTransform: "uppercase",
	color: "var(--rf-muted)",
	marginBottom: 10,
};

function AvatarPicker(props: {
	initialUrl?: string;
	onChange: (file: File | null) => void;
}) {
	const [preview, setPreview] = useState<string | null>(props.initialUrl ?? null);
	const fileRef = useRef<HTMLInputElement | null>(null);
	return (
		<div style={{ position: "relative", width: 64, height: 64, flexShrink: 0 }}>
			<button
				type="button"
				onClick={() => fileRef.current?.click()}
				style={{
					width: 64,
					height: 64,
					borderRadius: "50%",
					border: "2px dashed var(--rf-accent)",
					background: preview ? "transparent" : "var(--rf-bubble)",
					cursor: "pointer",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					overflow: "hidden",
					padding: 0,
				}}
			>
				{preview ? (
					<img
						src={preview}
						alt="avatar"
						style={{ width: "100%", height: "100%", objectFit: "cover" }}
					/>
				) : (
					<Plus size={20} color="var(--rf-accent)" />
				)}
			</button>
			{preview && (
				<button
					type="button"
					title="移除头像"
					onClick={() => {
						setPreview(null);
						props.onChange(null);
					}}
					style={{
						position: "absolute",
						top: -4,
						right: -4,
						width: 20,
						height: 20,
						borderRadius: "50%",
						border: "none",
						background: "var(--rf-danger)",
						color: "#ffffff",
						cursor: "pointer",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<X size={12} strokeWidth={3} />
				</button>
			)}
			<input
				ref={fileRef}
				type="file"
				accept="image/png,image/jpeg,image/svg+xml,image/webp"
				style={{ display: "none" }}
				onChange={(e) => {
					const f = e.target.files?.[0];
					if (!f) return;
					setPreview(URL.createObjectURL(f));
					props.onChange(f);
				}}
			/>
		</div>
	);
}

export function VoiceFormModal(props: VoiceFormModalProps) {
	const { mode, initial, avatarVersion, busy, testing, msg, onSubmit, onTest, onClose } = props;
	const [avatarFile, setAvatarFile] = useState<File | null | undefined>(undefined);
	const formRef = useRef<HTMLFormElement | null>(null);

	const collect = (): FormData | null => {
		const form = formRef.current;
		if (!form) return null;
		const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim();
		const gender = (form.elements.namedItem("gender") as HTMLInputElement).value.trim();
		const language = (form.elements.namedItem("language") as HTMLInputElement).value.trim();
		const text = (form.elements.namedItem("text") as HTMLInputElement).value.trim();
		const description = (form.elements.namedItem("description") as HTMLInputElement).value.trim();
		const prompts = (form.elements.namedItem("prompts") as HTMLInputElement)?.value.trim();
		const audioFile = (form.elements.namedItem("audio") as HTMLInputElement)?.files?.[0];
		const speedRaw = (form.elements.namedItem("speed") as HTMLInputElement)?.value;
		const speed = speedRaw ? Number(speedRaw) : undefined;
		if (mode === "create" && !audioFile) return null;
		if (!text) return null;
		const avatar = avatarFile instanceof File
			? "./avatar.png"
			: avatarFile === undefined
				? initial?.avatar
				: undefined;
		const meta = {
			meta: {
				...(name ? { name } : {}),
				...(gender ? { gender } : {}),
				...(language ? { language } : {}),
				...(speed !== undefined && Number.isFinite(speed) ? { speed } : {}),
				...(prompts ? { prompts } : {}),
				...(avatar ? { avatar } : {}),
				text,
				audio: "./audio.wav",
			},
			...(description ? { description } : {}),
		};
		const fd = new FormData();
		fd.append(
			"meta",
			new Blob([JSON.stringify(meta, null, 2)], { type: "application/json" }),
			"meta.json",
		);
		if (audioFile) fd.append("audio", audioFile, "audio.wav");
		if (avatarFile) fd.append("avatar", avatarFile, "avatar.png");
		return fd;
	};

	const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const fd = collect();
		if (fd) {
			onSubmit(fd, mode);
		} else {
			alert(
				mode === "create"
					? "请提供音频文件和音频对应文字"
					: "请填写音频对应文字",
			);
		}
	};

	const handleTest = async () => {
		const form = formRef.current;
		if (!form) return;
		const testText = (form.elements.namedItem("testText") as HTMLInputElement)?.value.trim();
		if (!testText) {
			alert("请输入测试文字");
			return;
		}
		const fd = collect();
		if (!fd) {
			alert(
				mode === "create"
					? "请提供音频文件和音频对应文字"
					: "请填写音频对应文字",
			);
			return;
		}
		if (!onTest) return;
		// 编辑模式且未选择新音频：复用已有音频进行试听合成
		if (mode === "edit" && !(form.elements.namedItem("audio") as HTMLInputElement)?.files?.[0]) {
			if (!initial?.id) return;
			const res = await fetch(`/rainbow-fart/voices/${initial.id}/sample`);
			if (!res.ok) {
				alert("获取原音频失败");
				return;
			}
			const blob = await res.blob();
			fd.append("audio", blob, "audio.wav");
		}
		onTest(fd, testText);
	};

	const avatarInitialUrl = mode === "edit" && initial?.avatar
		? `/rainbow-fart/voices/${initial.id}/avatar?v=${avatarVersion ?? 0}`
		: undefined;

	return (
		<div
			style={{
				position: "fixed",
				inset: 0,
				background: "var(--rf-overlay)",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				zIndex: 100,
			}}
		>
			<div
				style={{
					width: 500,
					maxWidth: "92vw",
					maxHeight: "90vh",
					borderRadius: 12,
					overflow: "hidden",
					display: "flex",
					flexDirection: "column",
					boxShadow: "0 10px 40px rgba(0,0,0,.4)",
				}}
			>
				{/* sticky header */}
				<div
					style={{
						padding: "16px 20px",
						fontSize: 15,
						fontWeight: 600,
						color: "var(--rf-ink)",
						background: "linear-gradient(180deg, var(--rf-surface-alt) 0%, var(--rf-surface) 100%)",
						borderBottom: "1px solid var(--rf-border)",
					}}
				>
					{mode === "create"
						? "创建音色"
						: `编辑音色「${initial?.name ?? initial?.id ?? ""}」`}
				</div>

				{/* scrollable body */}
				<form
					ref={formRef}
					id="voice-form"
					onSubmit={handleSubmit}
					style={{
						padding: "16px 20px 12px",
						overflowY: "auto",
						flex: 1,
						background:
							"linear-gradient(180deg, var(--rf-surface-alt) 0%, var(--rf-surface) 60%)",
					}}
				>
					<div style={formSection}>
						<div style={formSectionTitle}>音频控制</div>
						<label style={label}>
							{mode === "edit" ? "替换音频（.wav）" : "音频文件（.wav）*"}
						</label>
						<input
							type="file"
							name="audio"
							accept="audio/wav,.wav"
							style={{ ...textInput, marginBottom: 4 }}
						/>
						<div style={{ ...hint, marginBottom: 10 }}>
							{mode === "edit"
								? "不选则保留原音频。只支持 PCM WAV（单声道 16-bit）"
								: "只支持 PCM WAV（单声道 16-bit）"}
						</div>
						<label style={label}>音频对应文字 *</label>
						<textarea
							name="text"
							defaultValue={initial?.text ?? ""}
							style={{ ...textInput, minHeight: 60, marginBottom: 10 }}
							placeholder="必填：参考音频朗读的内容"
						/>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: 8,
								marginBottom: 10,
							}}
						>
							<span style={{ fontSize: 12, color: "var(--rf-muted)", flexShrink: 0 }}>
								默认语速
							</span>
							<input
								type="range"
								name="speed"
								min={0.5}
								max={1.5}
								step={0.05}
								defaultValue={initial?.speed ?? 1}
								onChange={(e) => {
									const label = e.currentTarget.parentElement?.querySelector(
										"[data-speed-label]",
									);
									if (label)
										label.textContent = `${Number(e.target.value).toFixed(2)}×`;
								}}
								style={{ flex: 1, accentColor: "var(--rf-accent)" }}
							/>
							<span
								data-speed-label
								style={{
									fontSize: 12,
									color: "var(--rf-label)",
									minWidth: 44,
									textAlign: "right",
								}}
							>
								{(initial?.speed ?? 1).toFixed(2)}×
							</span>
						</div>
						<div
							style={{
								borderTop: "1px dashed var(--rf-border)",
								paddingTop: 10,
							}}
						>
							<div
								style={{
									fontSize: 12,
									fontWeight: 600,
									letterSpacing: ".4px",
									textTransform: "uppercase",
									color: "var(--rf-muted)",
									marginBottom: 8,
								}}
							>
								测试合成
							</div>
							<input
								type="text"
								name="testText"
								style={{ ...textInput, marginBottom: 8 }}
								defaultValue="欢迎使用 Deepseek Rainbow Fart 让智能体协作更具氛围!"
								placeholder="输入想测试的文案"
							/>
							<button
								type="button"
								onClick={() => void handleTest()}
								disabled={busy || testing}
								className={testing ? rainbow.secondaryBackground : undefined}
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 6,
									padding: "6px 12px",
									borderRadius: 6,
									border: "1px solid var(--rf-border-strong)",
									cursor: "pointer",
									fontSize: 12,
									fontWeight: 600,
									color: testing ? "var(--rf-muted)" : "var(--rf-label)",
									background: testing ? undefined : "var(--rf-surface)",
								}}
							>
								<Play size={12} /> {testing ? "合成中…" : "测试合成"}
							</button>
						</div>
					</div>

					<div style={formSection}>
						<div style={formSectionTitle}>基础信息</div>
						<div style={{ display: "flex", gap: 12 }}>
							<AvatarPicker
								initialUrl={avatarInitialUrl}
								onChange={(f) => setAvatarFile(f)}
							/>
							<div style={{ flex: 1, minWidth: 0 }}>
								<label style={label}>名称</label>
								<input
									type="text"
									name="name"
									defaultValue={initial?.name ?? ""}
									style={{ ...textInput, marginBottom: 10 }}
									placeholder="可选"
								/>
								<label style={label}>描述</label>
								<input
									type="text"
									name="description"
									defaultValue={initial?.description ?? ""}
									style={{ ...textInput, marginBottom: 10 }}
									placeholder="可选"
								/>
							</div>
						</div>
					</div>

					<div style={formSection}>
						<div style={formSectionTitle}>元信息</div>
						<div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
							<div style={{ flex: 1, minWidth: 0 }}>
								<label style={label}>性别</label>
								<input
									type="text"
									name="gender"
									defaultValue={initial?.gender ?? ""}
									style={{ ...textInput }}
									placeholder="可选，如：女"
								/>
							</div>
							<div style={{ flex: 1, minWidth: 0 }}>
								<label style={label}>语言</label>
								<input
									type="text"
									name="language"
									defaultValue={initial?.language ?? ""}
									style={{ ...textInput }}
									placeholder="可选，如：中文"
								/>
							</div>
						</div>
						<label style={label}>音色提示词</label>
						<textarea
							name="prompts"
							defaultValue={initial?.prompts ?? ""}
							style={{ ...textInput, minHeight: 56 }}
							placeholder="可选：生成彩虹屁时附加的提示词（通过 ${voice_prompts} 注入）"
						/>
					</div>

					{msg && (
						<div
							style={{
								fontSize: 12,
								color: msg.startsWith("已") ? "var(--rf-success)" : "var(--rf-danger)",
								marginBottom: 10,
							}}
						>
							{msg}
						</div>
					)}
				</form>

				{/* sticky footer */}
<div
				style={{
					padding: "12px 20px",
					display: "flex",
					justifyContent: "flex-end",
					gap: 8,
					background: "linear-gradient(180deg, var(--rf-surface) 0%, var(--rf-surface-alt) 100%)",
					borderTop: "1px solid var(--rf-border)",
				}}
			>
				<button
					type="button"
					onClick={onClose}
					style={{
						padding: "8px 16px",
						borderRadius: 8,
						border: "1px solid var(--rf-border-strong)",
						cursor: "pointer",
						fontSize: 13,
						color: "var(--rf-label)",
						background: "var(--rf-surface)",
					}}
				>
						取消
					</button>
					<button
						type="submit"
						form="voice-form"
						disabled={busy || testing}
						className={rainbow.background}
						style={{
							padding: "8px 16px",
							borderRadius: 8,
							border: "none",
							cursor: "pointer",
							fontSize: 13,
							fontWeight: 600,
							color: "#ffffff",
							opacity: busy ? 0.7 : undefined,
						}}
					>
						{busy ? "保存中…" : mode === "create" ? "创建" : "保存"}
					</button>
				</div>
			</div>
		</div>
	);
}
