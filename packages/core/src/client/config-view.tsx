// Rainbow Fart configuration page (registered as a conversation view tab).
// Follows the harness color scheme (light/dark); config changes auto-save
// (debounced). Colored elements use the animated rainbow classes from ./rainbow.
import { useCallback, useEffect, useRef, useState } from "react";
import {
	Check,
	Download,
	Music,
	PackageOpen,
	Pencil,
	Play,
	Plus,
	RotateCcw,
	Sparkles,
	Trash2,
} from "lucide-react";
import { rainbow } from "./rainbow";
import { colorsToCssVars, useAppColors } from "./theme";
import { VoiceFormModal } from "./voice-form-modal";

interface VoiceInfo {
	id: string;
	name?: string;
	gender?: string;
	language?: string;
	text: string;
	audio: string;
	speed?: number;
	avatar?: string;
	prompts?: string;
	description?: string;
	builtIn: boolean;
	importedAt: number;
}

interface Config {
	enabled: boolean;
	generationModel: ModelSelection | null;
	playbackMode: "web-audio" | "local";
	language: string;
	prompt: string;
	voiceSpeeds: Record<string, number | null>;
	voiceId: string;
}

interface ModelSelection {
	provider: string;
	model: string;
}

interface ModelOption extends ModelSelection {
	providerName: string;
	name: string;
}

interface Status {
	enabled: boolean;
	playbackMode: "web-audio" | "local";
	engineReady: boolean;
	engineError: string | null;
	voices: VoiceInfo[];
	currentVoiceId: string | null;
	model: { provider: string; model: string } | null;
	lastAudio: { at: number; bytes: number; text: string } | null;
}

const DEFAULT_CONFIG: Config = {
	enabled: true,
	generationModel: null,
	playbackMode: "web-audio",
	language: "zh",
	prompt:
		"针对用户的输入内容，构思一句俏皮的夸赞话语，像朋友一样称赞用户。表达对用户的仰慕、敬佩。文案可以夸张，但要贴合内容。要求：纯文本、一句话、不超过60字、不要引号、不要markdown。",
	voiceSpeeds: {},
	voiceId: "cyy",
};

// ── theme-aware primitives (colors via var(--rf-*) set on the view root) ────
/** Larger section heading for spacing-based layout (no card borders). */
const blockTitle: React.CSSProperties = {
	fontSize: 18,
	fontWeight: 700,
	color: "var(--rf-ink)",
	margin: "0 0 4px",
};
/** Section wrapper: no card border, separated by generous spacing only. */
const blockSection: React.CSSProperties = {
	marginTop: 44,
};
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
const row: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	gap: 12,
};

function Toggle(props: { checked: boolean; onChange: (v: boolean) => void }) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={props.checked}
			onClick={() => props.onChange(!props.checked)}
			className={props.checked ? rainbow.background : undefined}
			style={{
				width: 42,
				height: 24,
				borderRadius: 999,
				border: "none",
				cursor: "pointer",
				background: props.checked ? undefined : "var(--rf-border-strong)",
				position: "relative",
				flexShrink: 0,
			}}
		>
			<span
				style={{
					position: "absolute",
					top: 3,
					left: props.checked ? 21 : 3,
					width: 18,
					height: 18,
					borderRadius: "50%",
					background: "#ffffff",
					transition: "left .2s ease",
					boxShadow: "0 1px 2px rgba(0,0,0,.25)",
				}}
			/>
		</button>
	);
}

function Badge(props: { text: string }) {
	return (
		<span
			className={rainbow.secondaryBackground}
			style={{
				fontSize: 11,
				padding: "2px 8px",
				borderRadius: 999,
				color: "var(--rf-label)",
			}}
		>
			{props.text}
		</span>
	);
}

export function ConfigView() {
	const colors = useAppColors();
	const [cfg, setCfg] = useState<Config>(DEFAULT_CONFIG);
	const [status, setStatus] = useState<Status | null>(null);
	const [loaded, setLoaded] = useState(false);
	const [testing, setTesting] = useState(false);
	const [msg, setMsg] = useState("");
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const hydrated = useRef(false);
	const [creating, setCreating] = useState(false);
	const [editingVoice, setEditingVoice] = useState<VoiceInfo | null>(null);
	const [importing, setImporting] = useState(false);
	const [savingCreate, setSavingCreate] = useState(false);
	const [busyVoice, setBusyVoice] = useState<string | null>(null);
	const [testingVoice, setTestingVoice] = useState<string | null>(null);
	const [samplingVoice, setSamplingVoice] = useState<string | null>(null);
	const [formMsg, setFormMsg] = useState("");
	const importRef = useRef<HTMLInputElement | null>(null);
	const [voiceRevision, setVoiceRevision] = useState(0);
	const [models, setModels] = useState<ModelOption[]>([]);

	const refreshStatus = useCallback(async () => {
		try {
			const s = (await fetch("/rainbow-fart/status", { cache: "no-store" }).then((r) =>
				r.json(),
			)) as Status;
			setStatus(s);
			return true;
		} catch {
			/* keep last status */
			return false;
		}
	}, []);

	const refreshVoices = useCallback(async () => {
		if (await refreshStatus()) {
			setVoiceRevision((revision) => revision + 1);
		}
	}, [refreshStatus]);

	useEffect(() => {
		void (async () => {
			try {
				const [c, s, modelResponse] = await Promise.all([
					fetch("/rainbow-fart/config").then((r) => r.json()),
					fetch("/rainbow-fart/status", { cache: "no-store" }).then((r) => r.json()),
					fetch("/rainbow-fart/models", { cache: "no-store" }).then((r) => r.json()),
				]);
				setCfg({ ...DEFAULT_CONFIG, ...c });
				setStatus(s);
				setModels(Array.isArray(modelResponse.models) ? modelResponse.models : []);
			} catch (error) {
				setMsg(`加载失败：${String(error)}`);
			} finally {
				setLoaded(true);
				hydrated.current = true;
			}
		})();
	}, []);

	// Auto-save: any config change is persisted (debounced 500ms), no save button.
	useEffect(() => {
		if (!hydrated.current) return;
		if (saveTimer.current) clearTimeout(saveTimer.current);
		saveTimer.current = setTimeout(() => {
			void (async () => {
				try {
					const res = await fetch("/rainbow-fart/config", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(cfg),
					});
					const json = await res.json();
					if (!res.ok) throw new Error(json.error ?? "保存失败");
					// Reflect a server-side fallback (e.g., blank prompt -> default).
					if (json.prompt !== cfg.prompt) {
						setCfg((prev) => ({ ...prev, prompt: json.prompt }));
					}
				} catch (error) {
					setMsg(`保存失败：${String(error)}`);
				}
			})();
		}, 500);
	}, [cfg]);

	const testSound = async () => {
		setTesting(true);
		setMsg("");
		try {
			const res = await fetch("/rainbow-fart/test", { method: "POST" });
			const json = await res.json();
			if (!res.ok || !json.ok) throw new Error(json.error ?? "测试失败");
			setMsg("已播放测试声音");
		} catch (error) {
			setMsg(`测试失败：${String(error)}`);
		} finally {
			setTesting(false);
			await refreshStatus(); // engine becomes ready after first synthesis
		}
	};

	const downloadLast = () => {
		const a = document.createElement("a");
		a.href = "/rainbow-fart/last-audio.wav";
		a.download = "rainbow-fart.wav";
		document.body.appendChild(a);
		a.click();
		a.remove();
	};

	const selectVoice = (id: string) => {
		setCfg((prev) => ({ ...prev, voiceId: id }));
		// Optimistically reflect the new current voice so the card highlights
		// immediately (status refresh arrives async via /status).
		setStatus((prev) => (prev ? { ...prev, currentVoiceId: id } : prev));
	};

	const testVoice = async (id: string) => {
		setTestingVoice(id);
		try {
			const res = await fetch(`/rainbow-fart/voices/${id}/test`, { method: "POST" });
			const json = await res.json();
			if (!res.ok || !json.ok) throw new Error(json.error ?? "试听失败");
		} catch (error) {
			alert(`试听失败：${String(error)}`);
		} finally {
			setTestingVoice(null);
			await refreshStatus();
		}
	};

	const sampleVoice = async (id: string) => {
		setSamplingVoice(id);
		try {
			const res = await fetch(`/rainbow-fart/voices/${id}/sample`);
			if (!res.ok) throw new Error(`试听样本失败（${res.status}）`);
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const audio = new Audio(url);
			audio.onended = () => URL.revokeObjectURL(url);
			await audio.play();
		} catch (error) {
			alert(`试听样本失败：${String(error)}`);
		} finally {
			setSamplingVoice(null);
		}
	};

	const exportVoice = (id: string) => {
		const a = document.createElement("a");
		a.href = `/rainbow-fart/voices/${id}/export`;
		a.download = `${id}.zip`;
		document.body.appendChild(a);
		a.click();
		a.remove();
	};

	const deleteVoice = async (id: string) => {
		if (!confirm(`删除音色「${id}」？`)) return;
		setBusyVoice(id);
		try {
			const res = await fetch(`/rainbow-fart/voices/${id}`, { method: "DELETE" });
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? "删除失败");
			await refreshVoices();
		} catch (error) {
			alert(`删除失败：${String(error)}`);
		} finally {
			setBusyVoice(null);
		}
	};

	const submitPreviewFd = async (fd: FormData, testText: string) => {
		if (!testText) {
			setFormMsg("请输入测试文字");
			return;
		}
		fd.append("text", testText);
		setTesting(true);
		setFormMsg("");
		try {
			const res = await fetch("/rainbow-fart/voices/synthesize", {
				method: "POST",
				body: fd,
			});
			const json = await res.json();
			if (!res.ok || !json.ok) throw new Error(json.error ?? "测试失败");
			setFormMsg("已播放测试合成");
		} catch (error) {
			setFormMsg(`测试失败：${String(error)}`);
		} finally {
			setTesting(false);
			await refreshStatus();
		}
	};

	const submitCreateFd = async (fd: FormData) => {
		setSavingCreate(true);
		try {
			const res = await fetch("/rainbow-fart/voices", { method: "POST", body: fd });
			const json = await res.json();
			if (!res.ok || !json.ok) throw new Error(json.error ?? "创建失败");
			setCreating(false);
			setFormMsg("已创建音色");
			await refreshVoices();
		} catch (error) {
			setFormMsg(`创建失败：${String(error)}`);
		} finally {
			setSavingCreate(false);
		}
	};

	const setVoiceSpeed = (id: string, v: number) => {
		setCfg((prev) => ({ ...prev, voiceSpeeds: { ...prev.voiceSpeeds, [id]: v } }));
	};

	const resetVoiceSpeed = (id: string) => {
		// Use null as a "delete" marker so the config POST carries the removal
		// to the server (a plain delete wouldn't survive server merge).
		setCfg((prev) => ({
			...prev,
			voiceSpeeds: { ...prev.voiceSpeeds, [id]: null },
		}));
		// Persist immediately — the debounced auto-save may not fire before a
		// refresh, which would leave the stale override on the server.
		void (async () => {
			try {
				await fetch("/rainbow-fart/config", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ voiceSpeeds: { [id]: null } }),
				});
			} catch {
				/* auto-save fallback will retry */
			}
		})();
	};

	const submitEditFd = async (fd: FormData) => {
		if (!editingVoice) return;
		const id = editingVoice.id;
		setBusyVoice(id);
		setFormMsg("");
		try {
			const res = await fetch(`/rainbow-fart/voices/${id}/update`, {
				method: "POST",
				body: fd,
			});
			const json = await res.json();
			if (!res.ok || !json.ok) throw new Error(json.error ?? "更新失败");
			setEditingVoice(null);
			setFormMsg("已更新音色");
			await refreshVoices();
		} catch (error) {
			setFormMsg(`更新失败：${String(error)}`);
		} finally {
			setBusyVoice(null);
		}
	};

	const submitImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		setImporting(true);
		try {
			const res = await fetch("/rainbow-fart/voices/import", {
				method: "POST",
				headers: { "Content-Type": "application/zip" },
				body: file,
			});
			const json = await res.json();
			if (!res.ok || !json.ok) throw new Error(json.error ?? "导入失败");
			await refreshVoices();
		} catch (error) {
			alert(`导入失败：${String(error)}`);
		} finally {
			setImporting(false);
			if (e.target) e.target.value = "";
		}
	};

	const sortedVoices = status?.voices
		? status.voices
				.slice()
				.sort(
					(a, b) =>
						(a.id === status.currentVoiceId ? -1 : 0) -
							(b.id === status.currentVoiceId ? -1 : 0) ||
						b.importedAt - a.importedAt,
				)
		: [];

	if (!loaded) {
		return (
			<div style={{ padding: 32, color: colors.muted, fontSize: 13 }}>加载中…</div>
		);
	}

	return (
		<div
			style={{
				...colorsToCssVars(colors),
				padding: "24px 28px 40px",
				maxWidth: 760,
				margin: "0 auto",
				color: "var(--rf-ink)",
				// No background here on purpose: let the harness surface show
				// through so the config page blends with the surrounding shell.
				fontFamily:
					"system-ui, -apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					marginBottom: 20,
				}}
			>
				<h2
					className={rainbow.text}
					style={{ fontSize: 24, margin: 0, fontWeight: 700 }}
				>
					DeepSeek Rainbow Fart
				</h2>
				<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
					<span
						className={rainbow.background}
						style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0 }}
					/>
					<span style={{ fontSize: 12, color: "var(--rf-muted)" }}>
						{status?.engineReady
							? "TTS 引擎就绪"
							: "TTS 引擎未就绪（首次合成后自动加载）"}
					</span>
				</div>
			</div>

			{status?.engineError && (
				<div
					style={{
						fontSize: 12,
						color: "var(--rf-danger)",
						background: "var(--rf-danger-bg)",
						border: "1px solid var(--rf-danger-border)",
						borderRadius: 8,
						padding: "8px 12px",
						marginBottom: 16,
					}}
				>
					{status.engineError}
				</div>
			)}

{/* ── 音色 ─────────────────────────────────────────────────────── */}
		<div style={{ ...blockSection, marginTop: 0 }}>
			<div style={{ ...row, marginBottom: 12 }}>
				<div style={blockTitle}>音色</div>
				<div style={{ display: "flex", gap: 8 }}>
					<button
						type="button"
						onClick={() => importRef.current?.click()}
						disabled={importing}
						style={{
							padding: "6px 12px",
							borderRadius: 8,
							border: "1px solid var(--rf-border-strong)",
							cursor: "pointer",
							fontSize: 12,
							color: "var(--rf-label)",
							background: "var(--rf-surface)",
						}}
					>
							{importing ? "导入中…" : (
								<span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
									<PackageOpen size={12} /> 导入音色包
								</span>
							)}
						</button>
						<button
							type="button"
							onClick={() => {
								setCreating(true);
							}}
							className={rainbow.background}
							style={{
								padding: "6px 12px",
								borderRadius: 8,
								border: "none",
								cursor: "pointer",
								color: "#ffffff",
								fontSize: 12,
								fontWeight: 600,
							}}
						>
							<span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
								<Plus size={12} /> 创建音色
							</span>
						</button>
					</div>
				</div>
				<input
					ref={importRef}
					type="file"
					accept=".zip"
					style={{ display: "none" }}
					onChange={(e) => void submitImport(e)}
				/>
{sortedVoices.length > 0 ? (
				<div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
					{sortedVoices.map((voice) => {
						const selected = voice.id === status?.currentVoiceId;
						const hasSpeedOverride =
							cfg.voiceSpeeds[voice.id] !== undefined &&
							cfg.voiceSpeeds[voice.id] !== null;

						const effectiveSpeed = cfg.voiceSpeeds[voice.id] ?? voice.speed ?? 1.0;
						return (
						<div
							key={voice.id}
							className={selected ? rainbow.background : undefined}
							style={{
								borderRadius: 10,
								overflow: "hidden",
								transition: "box-shadow .15s ease",
								boxShadow: selected
									? "0 3px 14px rgba(99,102,241,.25)"
									: "0 0 0 1px var(--rf-border)",
								padding: selected ? 2 : 0,
							}}
						>
							<div
								style={{
									background: selected
										? "var(--rf-surface-alt)"
										: "var(--rf-surface)",
									borderRadius: selected ? 8 : 9,
									overflow: "hidden",
								}}
							>
								<div style={{ display: "flex", alignItems: "center", gap: 18, padding: "16px 16px 12px" }}>
									{voice.avatar ? (
										<div style={{ position: "relative", flexShrink: 0 }}>
											<img
												src={`/rainbow-fart/voices/${voice.id}/avatar?v=${voiceRevision}`}
												alt={voice.name ?? "avatar"}
												style={{
													width: 64,
													height: 64,
													borderRadius: "50%",
													objectFit: "cover",
													background: "var(--rf-bubble)",
												}}
											/>
											{selected && (
												<span
													style={{
														position: "absolute",
														bottom: -2,
														right: -2,
														width: 18,
														height: 18,
														borderRadius: "50%",
														background: "var(--rf-success)",
														color: "#ffffff",
														fontSize: 11,
														fontWeight: 700,
														display: "flex",
														alignItems: "center",
														justifyContent: "center",
														boxShadow: "0 0 0 2px var(--rf-surface)",
													}}
												>
													<Check size={12} strokeWidth={3} />
												</span>
											)}
										</div>
									) : (
										<div
											style={{
												width: 64,
												height: 64,
												borderRadius: "50%",
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
												fontSize: 18,
												color: "var(--rf-muted)",
												fontWeight: 700,
												flexShrink: 0,
												background: "var(--rf-bubble)",
												position: "relative",
											}}
										>
											{(voice.name ?? "未").slice(0, 1).toUpperCase()}
											{selected && (
												<span
													style={{
														position: "absolute",
														bottom: -2,
														right: -2,
														width: 18,
														height: 18,
														borderRadius: "50%",
														background: "var(--rf-success)",
														color: "#ffffff",
														fontSize: 11,
														fontWeight: 700,
														display: "flex",
														alignItems: "center",
														justifyContent: "center",
														boxShadow: "0 0 0 2px var(--rf-surface)",
													}}
												>
													<Check size={12} strokeWidth={3} />
												</span>
											)}
										</div>
									)}
<div style={{ flex: 1, minWidth: 0 }}>
									<div style={{ fontSize: 15, fontWeight: 600, color: "var(--rf-ink)" }}>
										{voice.name ??
											`未命名 · ${new Date(voice.importedAt).toLocaleString()}`}
									</div>
									{voice.description && (
										<div
											style={{
												fontSize: 12,
												color: "var(--rf-muted)",
												marginTop: 4,
												maxWidth: "80%",
												overflowWrap: "break-word",
											}}
										>
											{voice.description}
										</div>
									)}
								</div>
									<div
										style={{
											display: "flex",
											gap: 6,
											flexShrink: 0,
											flexWrap: "wrap",
											justifyContent: "flex-end",
										}}
									>
										{voice.builtIn && <Badge text="内置" />}
										{voice.gender && <Badge text={voice.gender} />}
										{voice.language && <Badge text={voice.language} />}
									</div>
								</div>
								<div
									style={{
										borderTop: "1px solid var(--rf-border)",
										overflow: "hidden",
									}}
								>
									<div
										style={{
											display: "flex",
											alignItems: "stretch",
										}}
									>
										{!selected && (
											<button
												type="button"
												onClick={() => selectVoice(voice.id)}
												className={rainbow.background}
												style={{
													flex: 1,
													padding: "12px 0",
													border: "none",
													cursor: "pointer",
													fontSize: 12,
													fontWeight: 600,
													color: "#ffffff",
													boxShadow: "0 1px 4px rgba(99,102,241,.25)",
												}}
											>
												<span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, width: "100%" }}>
													<Check size={12} /> 选用
												</span>
											</button>
										)}
										{!voice.builtIn && (
											<button
												type="button"
												onClick={() => setEditingVoice(voice)}
												style={{
													flex: 1,
													padding: "12px 0",
													border: "none",
													cursor: "pointer",
													fontSize: 12,
													fontWeight: 600,
													color: "var(--rf-accent)",
													background: "var(--rf-surface)",
													borderLeft: "1px solid var(--rf-border)",
												}}
											>
												<span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, width: "100%" }}>
													<Pencil size={12} /> 编辑
												</span>
											</button>
										)}
										{!voice.builtIn && (
											<button
												type="button"
												disabled={busyVoice === voice.id}
												onClick={() => void deleteVoice(voice.id)}
												style={{
													flex: 1,
													padding: "12px 0",
													border: "none",
													cursor: "pointer",
													fontSize: 12,
													fontWeight: 600,
													color: "var(--rf-danger)",
													background: "var(--rf-surface)",
													borderLeft: "1px solid var(--rf-border)",
												}}
											>
												<span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, width: "100%" }}>
													<Trash2 size={12} /> 删除
												</span>
											</button>
										)}
									</div>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											gap: 6,
											padding: "10px 12px",
											flexWrap: "wrap",
											background: "var(--rf-bubble)",
											borderTop: "1px solid var(--rf-border)",
										}}
									>
										<button
										type="button"
										disabled={testingVoice === voice.id}
										onClick={() => void testVoice(voice.id)}
									style={{
										padding: "6px 12px",
										borderRadius: 7,
										border: "1px solid var(--rf-border-strong)",
										cursor: "pointer",
										fontSize: 12,
										color: "var(--rf-label)",
										background: "var(--rf-surface)",
										opacity: testingVoice === voice.id ? 0.7 : undefined,
										}}
									>
										<span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
											<Play size={12} /> {testingVoice === voice.id ? "合成中…" : "试听合成"}
										</span>
									</button>
									<button
										type="button"
										disabled={samplingVoice === voice.id}
										onClick={() => void sampleVoice(voice.id)}
										style={{
											padding: "6px 12px",
											borderRadius: 7,
											border: "1px solid var(--rf-border-strong)",
											cursor: "pointer",
											fontSize: 12,
											color: "var(--rf-label)",
											background: "var(--rf-surface)",
											opacity: samplingVoice === voice.id ? 0.7 : undefined,
										}}
									>
										<span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
											<Music size={12} /> {samplingVoice === voice.id ? "播放中…" : "试听样本"}
										</span>
									</button>
									<button
										type="button"
										onClick={() => exportVoice(voice.id)}
										style={{
											padding: "6px 12px",
											borderRadius: 7,
											border: "1px solid var(--rf-border-strong)",
											cursor: "pointer",
											fontSize: 12,
											color: "var(--rf-label)",
											background: "var(--rf-surface)",
										}}
									>
										<span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
											<Download size={12} /> 导出
										</span>
									</button>
										<div
											style={{
												display: "flex",
												alignItems: "center",
												gap: 6,
												marginLeft: "auto",
												paddingLeft: 8,
											}}
										>
											<span style={{ fontSize: 12, color: "var(--rf-muted)", flexShrink: 0 }}>
												语速
											</span>
											{hasSpeedOverride && (
												<button
													type="button"
													title="重置为默认语速"
													onClick={() => resetVoiceSpeed(voice.id)}
													style={{
														display: "inline-flex",
														alignItems: "center",
														padding: "4px 6px",
														borderRadius: 6,
														border: "1px solid var(--rf-border-strong)",
														cursor: "pointer",
														background: "var(--rf-surface)",
														flexShrink: 0,
													}}
												>
													<RotateCcw size={11} color="var(--rf-label)" />
												</button>
											)}
											<input
												type="range"
												min={0.5}
												max={1.5}
												step={0.05}
												value={effectiveSpeed}
												onChange={(e) => setVoiceSpeed(voice.id, Number(e.target.value))}
												style={{ width: 90, accentColor: "var(--rf-accent)", flexShrink: 0 }}
											/>
											<span
												style={{
													fontSize: 12,
													color: "var(--rf-label)",
													flexShrink: 0,
													minWidth: 40,
													textAlign: "right",
												}}
											>
												{effectiveSpeed.toFixed(2)}×
											</span>
										</div>
									</div>
								</div>
								</div>
							</div>
							);
						})}
					</div>
				) : (
					<div style={hint}>暂无可用音色</div>
				)}
			</div>

			{/* ── 行为 ─────────────────────────────────────────────────────── */}
			<div style={blockSection}>
				<div style={blockTitle}>行为</div>

				<div style={{ ...row, padding: "8px 0" }}>
					<div>
						<div style={label}>启用</div>
						<div style={hint}>开启后，每次发送消息自动生成语音总结</div>
					</div>
					<Toggle
						checked={cfg.enabled}
						onChange={(v) => setCfg({ ...cfg, enabled: v })}
					/>
				</div>

				<div style={{ padding: "8px 0" }}>
					<div style={label}>播放模式</div>
					<div style={{ display: "flex", gap: 8 }}>
						{(
							[
								{ value: "web-audio", text: "浏览器 Web Audio" },
								{ value: "local", text: "本地 Speaker 库" },
							] as const
						).map((opt) => {
							const active = cfg.playbackMode === opt.value;
							return (
								<button
									key={opt.value}
									type="button"
									onClick={() => setCfg({ ...cfg, playbackMode: opt.value })}
									className={active ? rainbow.background : undefined}
									style={{
										flex: 1,
										padding: "9px 12px",
										borderRadius: 8,
										border: active ? "none" : "1px solid var(--rf-border-strong)",
										cursor: "pointer",
										fontSize: 13,
										fontWeight: active ? 600 : undefined,
										color: active ? "#ffffff" : "var(--rf-label)",
										background: active ? undefined : "var(--rf-surface)",
										boxShadow: active ? "0 1px 4px rgba(99,102,241,.25)" : undefined,
									}}
								>
									{opt.text}
								</button>
							);
						})}
					</div>
					{cfg.playbackMode === "local" && (
						<div style={{ ...hint, color: "var(--rf-warning)" }}>
							需要本地安装 Speaker
						</div>
					)}
				</div>
			</div>

			{/* ── 模型 ─────────────────────────────────────────────────────── */}
			<div style={blockSection}>
				<div style={blockTitle}>模型</div>

				<div style={{ padding: "8px 0 18px" }}>
					<label style={label} htmlFor="rainbow-generation-model">生成</label>
					<select
						id="rainbow-generation-model"
						style={{ ...textInput, appearance: "auto" }}
						value={cfg.generationModel
							? JSON.stringify(cfg.generationModel)
							: ""}
						onChange={(event) => {
							const value = event.currentTarget.value;
							if (!value) {
								setCfg({ ...cfg, generationModel: null });
								return;
							}
							setCfg({ ...cfg, generationModel: JSON.parse(value) as ModelSelection });
						}}
					>
						<option value="">继承当前聊天</option>
						{models.map((model) => (
							<option
								key={JSON.stringify(model)}
								value={JSON.stringify({ provider: model.provider, model: model.model })}
							>
								{model.providerName} / {model.name}
							</option>
						))}
					</select>
					<div style={hint}>
						继承时使用当前聊天配置的模型；新会话尚未生成回复时使用 Harness 默认模型。
					</div>
				</div>

				<label style={label} htmlFor="rainbow-prompt">彩虹屁提示词</label>
				<textarea
					id="rainbow-prompt"
					style={{
											...textInput,
											minHeight: 92,
													resize: "vertical",
													lineHeight: 1.5,
										}}
					value={cfg.prompt}
					onChange={(e) => setCfg({ ...cfg, prompt: e.target.value })}
				/>
				<div style={hint}>
					支持 2000
					字以内的用户输入（超出自动截断）；每次只基于当次输入生成彩虹屁，不保留历史上下文。
				</div>
				<div style={hint}>
					支持在提示词中插入
<code
														style={{
															background: "var(--rf-bubble)",
															borderRadius: 4,
															padding: "1px 5px",
															fontSize: 11,
															color: "var(--rf-ink)",
														}}
													>
														{"${voice_prompts}"}
													</code>
					，生成时会替换为当前所选音色的「音色提示词」（未设置则替换为空）。
				</div>
			</div>

			{/* ── 调试 ─────────────────────────────────────────────────────── */}
			<div style={blockSection}>
				<div style={blockTitle}>调试</div>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 12,
						flexWrap: "wrap",
					}}
				>
					<button
						onClick={() => void testSound()}
						disabled={testing}
						className={rainbow.background}
						style={{
							padding: "10px 20px",
							borderRadius: 8,
							border: "none",
							cursor: "pointer",
							fontSize: 14,
							fontWeight: 600,
							color: "#ffffff",
							boxShadow: "0 2px 8px rgba(99,102,241,.25)",
						}}
					>
						{testing ? "合成中…" : (
							<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
								<Sparkles size={14} /> 测试声音
							</span>
						)}
					</button>
					<button
						onClick={() => downloadLast()}
						disabled={!status?.lastAudio}
						title={
							status?.lastAudio ? "下载最近一次合成的 WAV" : "还没有合成过音频"
						}
						className={status?.lastAudio ? rainbow.border : undefined}
style={{
														padding: "10px 20px",
														borderRadius: 8,
														border: status?.lastAudio ? undefined : "1px solid var(--rf-border-strong)",
														cursor: status?.lastAudio ? "pointer" : "not-allowed",
														fontSize: 14,
														fontWeight: 600,
														color: status?.lastAudio ? "var(--rf-label)" : "var(--rf-faint)",
														background: status?.lastAudio ? undefined : "var(--rf-bubble)",
													}}
					>
						<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
							<Download size={14} /> 下载最近音频
						</span>
					</button>
					{msg && (
						<span
							style={{
								fontSize: 13,
								color: msg.startsWith("已") ? "var(--rf-success)" : "var(--rf-danger)",
							}}
						>
							{msg}
						</span>
					)}
				</div>
				{status?.lastAudio && (
					<div style={hint}>
						最近音频：{status.lastAudio.text}（
						{Math.round(status.lastAudio.bytes / 1024)} KB）
					</div>
				)}
			</div>

			{creating && (
				<VoiceFormModal
					mode="create"
					busy={savingCreate}
					testing={testing}
					msg={formMsg}
					onSubmit={(fd) => void submitCreateFd(fd)}
					onTest={(fd, testText) => void submitPreviewFd(fd, testText)}
					onClose={() => {
						setCreating(false);
					}}
				/>
			)}
			{editingVoice && (
				<VoiceFormModal
					mode="edit"
					initial={editingVoice}
					avatarVersion={voiceRevision}
					busy={busyVoice === editingVoice.id}
					testing={testing}
					msg={formMsg}
					onSubmit={(fd) => void submitEditFd(fd)}
					onTest={(fd, testText) => void submitPreviewFd(fd, testText)}
					onClose={() => setEditingVoice(null)}
				/>
			)}
		</div>
	);
}
