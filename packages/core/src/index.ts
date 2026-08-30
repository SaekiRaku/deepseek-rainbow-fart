// deepseek-rainbow-fart · Node half (host plugin).
//
// When the user sends a message in the webui, this plugin reads it, calls the
// user's LLM to produce a short "rainbow fart" quip, synthesizes
// speech offline with sherpa-onnx + the bundled zh-ll model, and plays it
// (web-audio: pushed over SSE to the browser; local: played in-process via a
// user-installed audio lib). Optionally appends the quip into the session
// as an assistant message.
//
// All execution happens in this host plugin process — no separate node process.
import { join, dirname } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
	BlockAssembler,
	createUserMessage,
	deepFreeze,
} from "@deepseek-ai/dsh-llm";
import {
	installVoicePack,
	exportVoicePack,
	listVoicePacks,
	readVoicePack,
	removeVoicePack,
	ensureBuiltInVoicePack,
	parseVoicePack,
	parseMultipart,
	updateVoicePack,
} from "./voice-pack";
import type { VoiceMeta } from "./voice-pack";
import type { RainbowAudioEventData } from "./rainbow-audio";

export const name = "rainbow-fart";
export const inject = ["webServer", "llm", "agentDefaultModel"];

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), ".dsh");
const CONFIG_FILE = join(DSH_HOME, "rainbow-fart.json");
const VOICES_DIR = join(DSH_HOME, "rainbow-fart-voices");
const TEST_TEXT = "欢迎使用 Deepseek Rainbow Fart 让智能体协作更具氛围!";
const NO_THINKING_PROMPT =
	"不要进行或输出思考过程，不要输出 <think>、<reasoning> 等标签，只输出最终文案。";
/** Max user-input length we rainbow-fart over (chars, not tokens). Longer input is truncated. */
const MAX_INPUT_CHARS = 2000;

type ModelSelection = {
	provider: string;
	model: string;
};

interface ConfigShape {
	enabled: boolean;
	/** Null inherits the model configured for the current conversation. */
	generationModel: ModelSelection | null;
	playbackMode: "web-audio" | "local";
	language: string;
	prompt: string;
	/** Per-voice user speed overrides (voiceId -> multiplier; null = reset to pack default). */
	voiceSpeeds: Record<string, number | null>;
	voiceId: string;
}

interface AudioAsset {
	audioId: string;
	wav: Buffer;
	text: string;
	voiceId: string;
	durationMs: number;
	createdAt: number;
}

interface RainbowTask {
	session: unknown;
	cardId: string;
	text: string;
	turn: number;
	anchorSeq: number;
}

interface PendingTurn {
	turn: number;
}

function sessionIdOf(session: unknown): string | null {
	const id = (session as { id?: unknown })?.id;
	return typeof id === "string" ? id : null;
}

const DEFAULT_CONFIG: ConfigShape = {
	enabled: true,
	generationModel: null,
	playbackMode: "web-audio", // 'web-audio' | 'local'
	language: "zh",
	prompt:
		"针对用户的输入内容，构思一句俏皮的夸赞话语。像朋友一样称赞用户，表达对用户的仰慕、敬佩。文案可以夸张，但要贴合内容。\n要求：纯文本、一句话、不超过60字、不要引号、不要markdown。${voice_prompts}",
	voiceSpeeds: {},
	voiceId: "cyy",
};

/** Clamp a speed multiplier into a range ZipVoice copes with. */
const MIN_SPEED = 0.5;
const MAX_SPEED = 1.5;
function clampSpeed(v: number): number {
	if (!Number.isFinite(v)) return 1.0;
	return Math.min(MAX_SPEED, Math.max(MIN_SPEED, v));
}

interface LlmFinish {
	kind: string;
	failure?: { message?: string; code?: string };
}

/** Translate an LLM stream terminal finish into an error (undefined = success). */
function finishError(finish: LlmFinish | undefined): Error | undefined {
	switch (finish?.kind) {
		case undefined:
		case "stop":
			return undefined;
		case "error":
		case "aborted": {
			const error = new Error(
				finish.failure?.message ?? "llm stream failed",
			) as Error & {
				code?: string;
			};
			error.code = finish.failure?.code;
			return error;
		}
		case "max-tokens":
			// Truncated output is still usable (stripMarkdown caps at 200 chars);
			// an empty result is silently skipped by handleMessage.
			return undefined;
		case "tool-calls":
			return new Error(
				"rainbow-fart: model unexpectedly requested a tool",
			);
		default:
			return new Error(
				`rainbow-fart: unsupported finish reason "${String(finish.kind)}"`,
			);
	}
}

function messageOf(value: unknown): string {
	return value instanceof Error ? value.message : String(value);
}

function sendJson(res: ServerResponse, code: number, obj: unknown): void {
	res.writeHead(code, {
		"Content-Type": "application/json",
		"Cache-Control": "no-store",
	});
	res.end(JSON.stringify(obj));
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let data = "";
		req.on("data", (chunk) => (data += chunk));
		req.on("end", () => resolve(data));
		req.on("error", reject);
	});
}

function readBodyBuffer(req: IncomingMessage): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}

function f32ToInt16(samples: Float32Array): Buffer {
	const out = new Int16Array(samples.length);
	for (let i = 0; i < samples.length; i++) {
		const s = Math.max(-1, Math.min(1, samples[i]));
		out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
	}
	return Buffer.from(out.buffer);
}

/** Decode a 16-bit PCM WAV buffer into Float32 mono samples + sample rate. */
function wavToFloat32(wav: Buffer): { samples: Float32Array; sampleRate: number } {
	if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF")
		throw new Error("不是合法 WAV 文件");
	const fmt = wav.readUInt16LE(20);
	if (fmt !== 1) throw new Error("仅支持 PCM WAV");
	const channels = wav.readUInt16LE(22);
	if (channels !== 1) throw new Error("仅支持单声道 WAV");
	const sampleRate = wav.readUInt32LE(24);
	const bits = wav.readUInt16LE(34);
	if (bits !== 16) throw new Error("仅支持 16-bit WAV");
	// Locate the data chunk.
	let dataStart = 12;
	let pcm: Buffer | null = null;
	while (dataStart + 8 <= wav.length) {
		const id = wav.toString("ascii", dataStart, dataStart + 4);
		const size = wav.readUInt32LE(dataStart + 4);
		if (id === "data") {
			pcm = wav.subarray(dataStart + 8, dataStart + 8 + size);
			break;
		}
		dataStart += 8 + size + (size % 2);
	}
	if (!pcm) throw new Error("WAV 缺少 data 块");
	const count = Math.floor(pcm.length / 2);
	const samples = new Float32Array(count);
	for (let i = 0; i < count; i++) {
		samples[i] = pcm.readInt16LE(i * 2) / 32768;
	}
	return { samples, sampleRate };
}

/** Encode Float32 mono PCM as a 16-bit PCM WAV file (in-memory buffer). */
function f32ToWav(samples: Float32Array, sampleRate: number): Buffer {
	const pcm = f32ToInt16(samples);
	const header = Buffer.alloc(44);
	header.write("RIFF", 0, "ascii");
	header.writeUInt32LE(36 + pcm.length, 4);
	header.write("WAVE", 8, "ascii");
	header.write("fmt ", 12, "ascii");
	header.writeUInt32LE(16, 16); // fmt chunk size
	header.writeUInt16LE(1, 20); // PCM
	header.writeUInt16LE(1, 22); // mono
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(sampleRate * 2, 28); // byte rate (16-bit mono)
	header.writeUInt16LE(2, 32); // block align
	header.writeUInt16LE(16, 34); // bits per sample
	header.write("data", 36, "ascii");
	header.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([header, pcm]);
}

function stripMarkdown(text: string): string {
	return text
		.replace(/<(think|reasoning)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
		.replace(/<(?:think|reasoning)\b[^>]*>[\s\S]*$/gi, " ")
		.replace(/<\/?(?:think|reasoning)\b[^>]*>/gi, " ")
		.replace(/[#>*_`~|]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 200);
}

class RainbowFartRuntime {
	ctx: unknown & {
		on: (name: string, cb: (session: unknown, event: unknown) => void) => void;
		webServer: {
			register: (route: {
				kind: string;
				path: string;
				handler: (req: IncomingMessage, res: ServerResponse) => void;
			}) => () => void;
		};
		llm: {
			stream: (options: unknown) => AsyncIterable<unknown>;
			listProviders?: () => Array<{ id: string; name: string }>;
			listModels?: (
				provider: string,
			) => Promise<Array<{ provider: string; id: string; name: string }>>;
			/** Adapter-declared reasoning levels for one exact model (nil = none exposed). */
			resolveModelInfo?: (
				provider: string,
				model: string,
				signal?: AbortSignal,
			) => Promise<{
				reasoning?: {
					efforts: Array<{ id: string; name: string }>;
					defaultEffort?: string;
				};
			}>;
		};
		agentDefaultModel?: {
			currentSelection?: () => { provider: string; model: string };
		};
	};

	/** SSE audio clients (response streams held open). */
	clients = new Set<{ res: ServerResponse }>();
	queue: RainbowTask[] = [];
	busy = false;
	engine: unknown = null;
	engineReady = false;
	engineError: string | null = null;
	config: ConfigShape = { ...DEFAULT_CONFIG };
	configLoaded: Promise<void> | null = null;
	seq = 0;
	speaker: { end: () => void; write: (buf: Buffer) => void } | null = null;
	/** Cached reference audio per voiceId (loaded once from each voice pack's wav). */
	referenceCache = new Map<string, { samples: Float32Array; sampleRate: number; text: string }>();
	/** Most recent synthesized audio (as a WAV buffer) for the download endpoint. */
	lastAudio: { wav: Buffer; text: string; at: number } | null = null;
	/** Runtime-only audio assets. Session cards survive reloads, assets do not survive process restarts. */
	audioAssets = new Map<string, AudioAsset>();
	pendingTurns = new Map<unknown, PendingTurn>();
	disposers: Array<() => void> = [];

	constructor(ctx: RainbowFartRuntime["ctx"]) {
		this.ctx = ctx;
	}

	start(): void {
		this.configLoaded = this.loadConfig().catch((error) => {
			this.config = { ...DEFAULT_CONFIG };
			this.engineError = `config load failed: ${messageOf(error)}`;
		});
		void this.registerBuiltInVoice();
		this.ctx.on("session/event", (session, event) =>
			this.onSessionEvent(session, event),
		);
		const ws = this.ctx.webServer;
		this.disposers.push(
			ws.register({
				kind: "exact",
				path: "/rainbow-fart/status",
				handler: (req, res) => void this.handleStatus(req, res),
			}),
			ws.register({
				kind: "exact",
				path: "/rainbow-fart/config",
				handler: (req, res) => void this.handleConfig(req, res),
			}),
			ws.register({
				kind: "exact",
				path: "/rainbow-fart/models",
				handler: (req, res) => void this.handleModels(req, res),
			}),
			ws.register({
				kind: "exact",
				path: "/rainbow-fart/audio",
				handler: (req, res) => void this.handleAudio(req, res),
			}),
			ws.register({
				kind: "exact",
				path: "/rainbow-fart/test",
				handler: (req, res) => void this.handleTest(req, res),
			}),
			ws.register({
				kind: "exact",
				path: "/rainbow-fart/last-audio.wav",
				handler: (req, res) => void this.handleLastAudio(req, res),
			}),
			ws.register({
				kind: "prefix",
				path: "/rainbow-fart/audios",
				handler: (req, res) => void this.handleAudioAsset(req, res),
			}),
			ws.register({
				kind: "prefix",
				path: "/rainbow-fart/voices",
				handler: (req, res) => void this.handleVoices(req, res),
			}),
		);
	}

	dispose(): void {
		for (const disposer of this.disposers) {
			try {
				disposer();
			} catch {
				/* ignore */
			}
		}
		this.disposers.length = 0;
		for (const client of this.clients) {
			try {
				client.res.end();
			} catch {
				/* ignore */
			}
		}
		this.clients.clear();
		if (this.speaker) {
			try {
				this.speaker.end();
			} catch {
				/* ignore */
			}
		}
	}

	/** Register the bundled built-in voice pack into the local voices dir (idempotent). */
	async registerBuiltInVoice(): Promise<void> {
		try {
			const models = await import("@deepseek-rainbow-fart/models");
			const zip = await readFile(models.builtInVoiceZipPath);
			await ensureBuiltInVoicePack(zip, VOICES_DIR, models.builtInVoiceId);
		} catch (error) {
			this.engineError = `内置音色注册失败: ${messageOf(error)}`;
		}
	}

	async loadConfig(): Promise<void> {
		try {
			const raw = await readFile(CONFIG_FILE, "utf8");
			this.config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
		} catch (error) {
			if ((error as { code?: string })?.code !== "ENOENT") {
				this.engineError = `config load failed: ${messageOf(error)}`;
			}
		}
	}

	async saveConfig(next: Partial<ConfigShape>): Promise<void> {
		await this.configLoaded;
		// Blank/whitespace prompt falls back to the built-in default on save.
		const sanitized: Partial<ConfigShape> = { ...next };
		if (
			typeof sanitized.prompt === "string" &&
			sanitized.prompt.trim() === ""
		) {
			sanitized.prompt = DEFAULT_CONFIG.prompt;
		}
		if ("generationModel" in sanitized) {
			const model = sanitized.generationModel;
			if (
				model !== null &&
				(typeof model !== "object" ||
					typeof model.provider !== "string" ||
					!model.provider.trim() ||
					typeof model.model !== "string" ||
					!model.model.trim())
			) {
				throw new Error("生成模型配置无效");
			}
		}
		// Merge per-voice speed overrides instead of wholesale replacement so
		// adjusting one voice never drops another voice's override. A `null`
		// value signals deletion (reset to pack default).
		if (sanitized.voiceSpeeds) {
			const merged = { ...this.config.voiceSpeeds };
			for (const [k, v] of Object.entries(sanitized.voiceSpeeds)) {
				if (v === null || v === undefined) delete merged[k];
				else if (typeof v === "number" && Number.isFinite(v)) merged[k] = v;
			}
			this.config.voiceSpeeds = merged;
			delete sanitized.voiceSpeeds;
		}
		this.config = { ...this.config, ...sanitized };
		// Drop the legacy global `speed` field if a v0.1-era config carries it.
		if ("speed" in this.config) {
			delete (this.config as unknown as Record<string, unknown>).speed;
		}
		await mkdir(dirname(CONFIG_FILE), { recursive: true });
		await writeFile(CONFIG_FILE, JSON.stringify(this.config, null, 2), "utf8");
	}

	defaultModel(): { provider: string; model: string } | null {
		return this.ctx.agentDefaultModel?.currentSelection?.() ?? null;
	}

	generationModel(session: unknown): ModelSelection | null {
		if (this.config.generationModel) return this.config.generationModel;
		const header = (session as {
			requestHeader?: () => { config?: ModelSelection } | undefined;
		})?.requestHeader?.();
		return header?.config ?? this.defaultModel();
	}

	async handleModels(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		if (req.method !== "GET") {
			sendJson(res, 405, { error: "method not allowed" });
			return;
		}
		const providers = this.ctx.llm.listProviders?.() ?? [];
		const models = await Promise.all(
			providers.map(async (provider) => {
				try {
					const entries = (await this.ctx.llm.listModels?.(provider.id)) ?? [];
					return entries.map((model) => ({
						provider: provider.id,
						providerName: provider.name,
						model: model.id,
						name: model.name,
					}));
				} catch {
					return [];
				}
			}),
		);
		sendJson(res, 200, { models: models.flat() });
	}

	async handleStatus(
		_req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		await this.configLoaded;
		const voices = await listVoicePacks(VOICES_DIR);
		const current =
			voices.find((v) => v.id === this.config.voiceId) ??
			voices.find((v) => v.builtIn);
		sendJson(res, 200, {
			enabled: this.config.enabled,
			playbackMode: this.config.playbackMode,
			engineReady: this.engineReady,
			engineError: this.engineError,
			voices,
			currentVoiceId: current?.id ?? null,
			model: this.defaultModel(),
			lastAudio: this.lastAudio
				? {
						at: this.lastAudio.at,
						bytes: this.lastAudio.wav.length,
						text: this.lastAudio.text,
					}
				: null,
		});
	}

	async handleConfig(req: IncomingMessage, res: ServerResponse): Promise<void> {
		await this.configLoaded;
		if (req.method === "GET") {
			sendJson(res, 200, this.config);
			return;
		}
		if (req.method === "POST" || req.method === "PUT") {
			try {
				const next = JSON.parse(await readBody(req)) as Partial<ConfigShape>;
				await this.saveConfig(next);
				sendJson(res, 200, this.config);
			} catch (error) {
				sendJson(res, 400, { error: messageOf(error) });
			}
			return;
		}
		sendJson(res, 405, { error: "method not allowed" });
	}

	async handleAudio(req: IncomingMessage, res: ServerResponse): Promise<void> {
		await this.configLoaded;
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});
		res.write("retry: 2000\n\n");
		const client = { res };
		this.clients.add(client);
		req.on("close", () => this.clients.delete(client));
	}

	/** Test-sound endpoint: synthesize a fixed sentence and play it (uses current default voice). */
	async handleTest(_req: IncomingMessage, res: ServerResponse): Promise<void> {
		await this.configLoaded;
		try {
			await this.speak(TEST_TEXT);
			sendJson(res, 200, { ok: true, text: TEST_TEXT });
		} catch (error) {
			sendJson(res, 500, { ok: false, error: messageOf(error) });
		}
	}

	/** Download the most recent synthesized audio as a WAV file. */
	async handleLastAudio(
		_req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		await this.configLoaded;
		if (!this.lastAudio) {
			sendJson(res, 404, { error: "还没有合成过音频" });
			return;
		}
		const filename = `rainbow-fart-${this.lastAudio.at}.wav`;
		res.writeHead(200, {
			"Content-Type": "audio/wav",
			"Content-Length": this.lastAudio.wav.length,
			"Content-Disposition": `attachment; filename="${filename}"`,
		});
		res.end(this.lastAudio.wav);
	}

	async handleAudioAsset(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		if (req.method !== "GET" && req.method !== "HEAD") {
			sendJson(res, 405, { error: "method not allowed" });
			return;
		}
		const url = new URL(req.url ?? "/", "http://localhost");
		const match = /^\/rainbow-fart\/audios\/([a-zA-Z0-9_-]+)\.wav$/.exec(
			url.pathname,
		);
		const asset = match ? this.audioAssets.get(match[1]) : undefined;
		if (!asset) {
			sendJson(res, 404, { error: "语音已失效" });
			return;
		}
		res.writeHead(200, {
			"Content-Type": "audio/wav",
			"Content-Length": asset.wav.length,
			"Cache-Control": "no-store",
			"Accept-Ranges": "none",
		});
		if (req.method === "HEAD") res.end();
		else res.end(asset.wav);
	}

	/** Voice management router (prefix /rainbow-fart/voices). */
	async handleVoices(req: IncomingMessage, res: ServerResponse): Promise<void> {
		await this.configLoaded;
		const url = new URL(req.url ?? "/", "http://localhost");
		const path = url.pathname;
		const rest = path.slice("/rainbow-fart/voices".length).replace(/^\/+/, "");
		const segments = rest ? rest.split("/") : [];

		try {
			if (req.method === "GET" && segments.length === 0) {
				const voices = await listVoicePacks(VOICES_DIR);
				// strip runtime-only fields (dir/audioPath/audioRelName) before responding
				const infos = voices.map(
					({ dir: _d, audioPath: _ap, audioRelName: _an, ...rest }) => rest,
				);
				sendJson(res, 200, { voices: infos });
				return;
			}
			if (req.method === "POST" && segments.length === 1 && segments[0] === "synthesize") {
				// 预览合成：multipart meta + audio + text（不落盘，直接试听）
				const body = await readBodyBuffer(req);
				const parts = parseMultipart(body, req.headers["content-type"] ?? "");
				if (!parts.meta || !parts.audio) {
					sendJson(res, 400, { error: "需要 meta.json 与 audio.wav" });
					return;
				}
				const { zipSync, strToU8 } = await import("fflate");
				const entries: Record<string, Uint8Array> = {
					"meta.json": strToU8(parts.meta.toString("utf8")),
					"audio.wav": new Uint8Array(
						parts.audio.buffer,
						parts.audio.byteOffset,
						parts.audio.length,
					),
				};
				if (parts.avatar) {
					entries["avatar.png"] = new Uint8Array(
						parts.avatar.buffer,
						parts.avatar.byteOffset,
						parts.avatar.length,
					);
				}
				const zipBuf = Buffer.from(zipSync(entries, { level: 6 }));
				const parsed = parseVoicePack(zipBuf);
				const audio = wavToFloat32(Buffer.from(parsed.audioData));
				const text = (parts.text?.toString("utf8") ?? "").trim() || TEST_TEXT;
				const speed = clampSpeed(parsed.meta.speed ?? 1.0);
				await this.synthesize(text, { ...audio, text: parsed.meta.text }, speed);
				sendJson(res, 200, { ok: true, text });
				return;
			}
			if (req.method === "POST" && segments.length === 0) {
				// 自制：multipart meta.json + audio.wav (+ 可选 avatar)
				const body = await readBodyBuffer(req);
				const parts = parseMultipart(body, req.headers["content-type"] ?? "");
				if (!parts.meta || !parts.audio) {
					sendJson(res, 400, { error: "需要 meta.json 与 audio.wav" });
					return;
				}
				// 后端在内存打包成 zip 走统一校验
				const { zipSync, strToU8 } = await import("fflate");
				const entries: Record<string, Uint8Array> = {
					"meta.json": strToU8(parts.meta.toString("utf8")),
					"audio.wav": new Uint8Array(
						parts.audio.buffer,
						parts.audio.byteOffset,
						parts.audio.length,
					),
				};
				if (parts.avatar) {
					entries["avatar.png"] = new Uint8Array(
						parts.avatar.buffer,
						parts.avatar.byteOffset,
						parts.avatar.length,
					);
				}
				const zipBuf = Buffer.from(zipSync(entries, { level: 6 }));
				const vp = await installVoicePack(zipBuf, VOICES_DIR);
				sendJson(res, 200, { ok: true, voice: vp });
				return;
			}
			if (req.method === "POST" && segments[0] === "import") {
				const zipBuf = await readBodyBuffer(req);
				const vp = await installVoicePack(zipBuf, VOICES_DIR);
				sendJson(res, 200, { ok: true, voice: vp });
				return;
			}
			if (req.method === "GET" && segments.length === 2 && segments[1] === "export") {
				const id = segments[0];
				if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
					sendJson(res, 400, { error: "非法音色 id" });
					return;
				}
				const vp = await readVoicePack(join(VOICES_DIR, id));
				if (!vp) {
					sendJson(res, 404, { error: "音色不存在" });
					return;
				}
				const zip = await exportVoicePack(vp.dir);
				res.writeHead(200, {
					"Content-Type": "application/zip",
					"Content-Disposition": `attachment; filename="${id}.zip"`,
					"Content-Length": zip.length,
				});
				res.end(zip);
				return;
			}
			if (req.method === "POST" && segments.length === 2 && segments[1] === "test") {
				const id = segments[0];
				if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
					sendJson(res, 400, { error: "非法音色 id" });
					return;
				}
				const vp = await readVoicePack(join(VOICES_DIR, id));
				if (!vp) {
					sendJson(res, 404, { error: "音色不存在" });
					return;
				}
				await this.speak(TEST_TEXT, vp.id);
				sendJson(res, 200, { ok: true, text: TEST_TEXT });
				return;
			}
			if (req.method === "GET" && segments.length === 2 && segments[1] === "sample") {
				const id = segments[0];
				if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
					sendJson(res, 400, { error: "非法音色 id" });
					return;
				}
				const vp = await readVoicePack(join(VOICES_DIR, id));
				if (!vp) {
					sendJson(res, 404, { error: "音色不存在" });
					return;
				}
				const sample = await readFile(vp.audioPath);
				res.writeHead(200, {
					"Content-Type": "audio/wav",
					"Content-Length": sample.length,
					"Cache-Control": "no-store",
				});
				res.end(sample);
				return;
			}
			if (req.method === "GET" && segments.length === 2 && segments[1] === "avatar") {
				const id = segments[0];
				if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
					sendJson(res, 400, { error: "非法音色 id" });
					return;
				}
				const vp = await readVoicePack(join(VOICES_DIR, id));
				if (!vp || !vp.avatarPath) {
					sendJson(res, 404, { error: "音色无头像" });
					return;
				}
				const avatar = await readFile(vp.avatarPath);
				const ext = vp.avatarPath.split(".").pop()?.toLowerCase();
				const mime =
					ext === "svg"
						? "image/svg+xml"
						: ext === "jpg" || ext === "jpeg"
							? "image/jpeg"
							: ext === "webp"
								? "image/webp"
								: "image/png";
				res.writeHead(200, {
					"Content-Type": mime,
					"Content-Length": avatar.length,
					"Cache-Control": "no-store",
				});
				res.end(avatar);
				return;
			}
			if (
				(req.method === "PUT" || req.method === "POST") &&
				segments.length === 2 &&
				segments[1] === "update"
			) {
				const id = segments[0];
				if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
					sendJson(res, 400, { error: "非法音色 id" });
					return;
				}
				const vp = await readVoicePack(join(VOICES_DIR, id));
				if (!vp) {
					sendJson(res, 404, { error: "音色不存在" });
					return;
				}
				const body = await readBodyBuffer(req);
				const parts = parseMultipart(body, req.headers["content-type"] ?? "");
				if (!parts.meta) {
					sendJson(res, 400, { error: "需要 meta.json" });
					return;
				}
				const parsedMeta = JSON.parse(parts.meta.toString("utf8")) as {
					meta?: Record<string, unknown>;
					description?: unknown;
				};
				const m = parsedMeta.meta;
				if (!m || typeof m.text !== "string" || typeof m.audio !== "string") {
					sendJson(res, 400, { error: "meta 缺少必填字段" });
					return;
				}
				const meta: VoiceMeta = {
					text: m.text,
					audio: m.audio,
					...(typeof m.name === "string" && m.name.trim() ? { name: m.name.trim() } : {}),
					...(typeof m.gender === "string" && m.gender.trim() ? { gender: m.gender.trim() } : {}),
					...(typeof m.language === "string" && m.language.trim() ? { language: m.language.trim() } : {}),
					...(typeof m.speed === "number" && Number.isFinite(m.speed) ? { speed: m.speed } : {}),
					...(typeof m.prompts === "string" && m.prompts.trim() ? { prompts: m.prompts.trim() } : {}),
					...(typeof m.avatar === "string" && m.avatar.trim() ? { avatar: m.avatar.trim() } : {}),
				};
				const description =
					typeof parsedMeta.description === "string" && parsedMeta.description.trim()
						? parsedMeta.description.trim()
						: undefined;
				const updated = await updateVoicePack(vp.dir, vp.builtIn, meta, description, {
					...(parts.audio ? { audioData: new Uint8Array(parts.audio.buffer, parts.audio.byteOffset, parts.audio.length) } : {}),
					...(parts.avatar ? { avatarData: new Uint8Array(parts.avatar.buffer, parts.avatar.byteOffset, parts.avatar.length) } : {}),
					removeAvatar: m.avatar === "" || m.avatar === undefined,
				});
				sendJson(res, 200, { ok: true, voice: updated });
				return;
			}
			if (req.method === "DELETE" && segments.length === 1) {
				const id = segments[0];
				if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
					sendJson(res, 400, { error: "非法音色 id" });
					return;
				}
				const vp = await readVoicePack(join(VOICES_DIR, id));
				if (!vp) {
					sendJson(res, 404, { error: "音色不存在" });
					return;
				}
				await removeVoicePack(vp.dir, vp.builtIn);
				if (this.config.voiceId === vp.id) {
					this.config.voiceId = DEFAULT_CONFIG.voiceId;
					await this.saveConfig({ voiceId: DEFAULT_CONFIG.voiceId });
				}
				sendJson(res, 200, { ok: true });
				return;
			}
			sendJson(res, 405, { error: "method not allowed" });
		} catch (error) {
			sendJson(res, 400, { error: messageOf(error) });
		}
	}

	emitAudio(frame: Record<string, unknown>): void {
		const line = `data: ${JSON.stringify(frame)}\n\n`;
		for (const client of this.clients) {
			try {
				client.res.write(line);
			} catch {
				/* drop slow client */
			}
		}
	}

	onSessionEvent(session: unknown, event: unknown): void {
		if (typeof event !== "object" || event === null) return;
		const ev = event as { type?: string; seq?: number; data?: unknown };
		switch (ev.type) {
			case "turn/start": {
				const turn = (ev.data as { turn?: unknown } | null)?.turn;
				if (typeof turn === "number") {
					this.pendingTurns.set(session, { turn });
				}
				return;
			}
			case "user/message": {
				if (!this.config.enabled) return;
				const message = ev.data as {
					source?: { kind?: string };
					content?: Array<{ type?: string; text?: string }>;
				} | null;
				if (message?.source?.kind !== "user") return;
				const text = (message.content ?? [])
					.filter((block) => block.type === "text")
					.map((block) => block.text ?? "")
					.join(" ")
					.trim();
				const pending = this.pendingTurns.get(session);
				if (!text || !pending || typeof ev.seq !== "number") return;
				const createdAt = Date.now();
				const cardId = `turn-${pending.turn}-${ev.seq}`;
				const sessionId = sessionIdOf(session);
				if (sessionId) {
					this.emitAudio({
						kind: "card",
						sessionId,
						data: {
							status: "loading",
							cardId,
							turn: pending.turn,
							anchorSeq: ev.seq,
							createdAt,
						} satisfies RainbowAudioEventData,
					});
				}
				this.enqueue({
					session,
					cardId,
					text,
					turn: pending.turn,
					anchorSeq: ev.seq,
				});
				return;
			}
			case "turn/end": {
				const data = ev.data as {
					turn?: unknown;
					reason?: { kind?: string };
				} | null;
				const pending = this.pendingTurns.get(session);
				this.pendingTurns.delete(session);
				if (
					!pending ||
					data?.turn !== pending.turn ||
					(data.reason?.kind !== "completed" &&
						data.reason?.kind !== "max-tokens")
				) {
					return;
				}
				return;
			}
			default:
				return;
		}
	}

	enqueue(item: RainbowTask): void {
		this.queue.push(item);
		if (!this.busy) void this.drain();
	}

	async drain(): Promise<void> {
		this.busy = true;
		try {
			while (this.queue.length > 0) {
				const item = this.queue.shift();
				if (!item) continue;
				try {
					await this.handleMessage(item);
				} catch (error) {
					this.engineError = messageOf(error);
					console.error("[rainbow-fart]", messageOf(error));
					const sessionId = sessionIdOf(item.session);
					if (sessionId) {
						this.emitAudio({
							kind: "card",
							sessionId,
							data: {
							status: "error",
							cardId: item.cardId,
							turn: item.turn,
							anchorSeq: item.anchorSeq,
							createdAt: Date.now(),
							} satisfies RainbowAudioEventData,
						});
					}
				}
			}
		} finally {
			this.busy = false;
		}
	}

	async handleMessage({
		session,
		text,
		turn,
		cardId,
		anchorSeq,
	}: RainbowTask): Promise<void> {
		if (!this.config.enabled) return;
		const rainbowFart = await this.rainbowFart(session, text);
		if (!rainbowFart) return;
		const audio = await this.speak(rainbowFart);
		const data: RainbowAudioEventData = {
			status: "ready",
			cardId,
			audioId: audio.audioId,
			turn,
			anchorSeq,
			text: audio.text,
			voiceId: audio.voiceId,
			durationMs: audio.durationMs,
			createdAt: audio.createdAt,
		};
		const sessionId = sessionIdOf(session);
		if (sessionId) {
			this.emitAudio({ kind: "card", sessionId, data });
		}
	}

	async rainbowFart(session: unknown, text: string): Promise<string> {
		const model = this.generationModel(session);
		if (!model?.provider || !model?.model) {
			throw new Error(
				"no model configured for rainbow-fart (set a model override or a default agent model)",
			);
		}
		// Truncate very long inputs (user messages up to ~2000 chars) so the
		// rainbow-fart request stays small; the cap does not affect the output.
		const safeText = text.slice(0, MAX_INPUT_CHARS);
		const messages = [
			createUserMessage({
				content: [{ type: "text", text: `用户消息：${safeText}` }],
				source: { kind: "plugin", plugin: "deepseek-rainbow-fart" },
			}),
		];
		// Fresh context every call: only the current user input + the system
		// prompt — no session history is sent, so nothing is retained across
		// messages. maxTokens is intentionally not set so each provider's own
		// output cap applies, and thinking is disabled when the adapter exposes
		// an off level; either way a truncated reply stays usable.
		const voicePrompts = await this.currentVoicePrompts();
		const system = `${this.config.prompt.replace(
			"${voice_prompts}",
			voicePrompts ?? "",
		)}\n${NO_THINKING_PROMPT}`;
		const thinkingOff = await this.thinkingOffEffortId(
			model.provider,
			model.model,
		);
		const options = deepFreeze({
			provider: model.provider,
			model: model.model,
			messages,
			system,
			...(thinkingOff ? { reasoningEffort: thinkingOff } : {}),
			purpose: "rainbow-fart",
			sessionId: (session as { id?: unknown })?.id,
			signal: AbortSignal.timeout(30000),
		});
		const assembler = new BlockAssembler();
		for await (const chunk of this.ctx.llm.stream(options))
			assembler.push(chunk);
		const error = finishError(assembler.finish);
		if (error) throw error;
		const textOut = assembler
			.blocks()
			.filter((block) => block.type === "text")
			.map((block) => block.text ?? "")
			.join(" ")
			.trim();
		const result = stripMarkdown(textOut);
		if (!result) {
			throw new Error("rainbow-fart: model returned no final text");
		}
		return result;
	}

	/**
	 * Best-effort reasoning-effort id that disables thinking for a model,
	 * picked from that model's adapter-declared efforts (undefined when none
	 * exists). Failures degrade to no override.
	 */
	async thinkingOffEffortId(
		provider: string,
		model: string,
	): Promise<string | undefined> {
		try {
			const info = await this.ctx.llm.resolveModelInfo?.(provider, model);
			const efforts = info?.reasoning?.efforts ?? [];
			const disabling = efforts.find((effort) => effort.id === "off") ??
				efforts.find((effort) =>
					/^(off|none|disabled|no[ -]?thinking)$/i.test(effort.id) ||
					/^(off|none|disabled|no[ -]?thinking)$/i.test(effort.name),
				);
			return disabling?.id;
		} catch {
			return undefined;
		}
	}

	async ensureEngine(): Promise<unknown> {
		if (this.engine) return this.engine;
		try {
			const sherpa = (await import("sherpa-onnx-node")).default;
			const models = await import("@deepseek-rainbow-fart/models");
			this.engine = await sherpa.OfflineTts.createAsync(
				models.zipVoiceModelConfig,
			);
			this.engineReady = true;
			this.engineError = null;
			return this.engine;
		} catch (error) {
			this.engineReady = false;
			this.engineError = `TTS engine unavailable: ${messageOf(error)}`;
			throw error;
		}
	}

	/** Extra prompts of the current voice, for ${voice_prompts} substitution. */
	async currentVoicePrompts(): Promise<string | undefined> {
		const id = this.config.voiceId || DEFAULT_CONFIG.voiceId;
		const vp = await readVoicePack(join(VOICES_DIR, id));
		return vp?.prompts;
	}

	async resolveReference(voiceId?: string): Promise<{
		samples: Float32Array;
		sampleRate: number;
		text: string;
		/** Default speed from the voice pack (undefined = 1.0). */
		defaultSpeed?: number;
	}> {
		const id = voiceId || this.config.voiceId || DEFAULT_CONFIG.voiceId;
		const cached = this.referenceCache.get(id);
		if (cached) return cached;
		const sherpa = (await import("sherpa-onnx-node")).default as {
			readWave: (path: string) => { samples: Float32Array; sampleRate: number };
		};
		let vp = await readVoicePack(join(VOICES_DIR, id));
		if (!vp) {
			// Fallback: re-register the built-in voice, then read it.
			await this.registerBuiltInVoice();
			vp = await readVoicePack(join(VOICES_DIR, DEFAULT_CONFIG.voiceId));
		}
		if (!vp) throw new Error(`音色不存在: ${id}`);
		const wave = sherpa.readWave(vp.audioPath);
		const ref = {
			samples: wave.samples,
			sampleRate: wave.sampleRate,
			text: vp.text ?? "",
			defaultSpeed: vp.speed,
		};
		this.referenceCache.set(vp.id, ref);
		return ref;
	}

	async speak(text: string, voiceId?: string): Promise<AudioAsset> {
		const id = voiceId || this.config.voiceId || DEFAULT_CONFIG.voiceId;
		const ref = await this.resolveReference(id);
		const speed = clampSpeed(
			this.config.voiceSpeeds?.[id] ?? ref.defaultSpeed ?? 1.0,
		);
		return this.synthesize(text, ref, speed, id);
	}

	/** Generate speech from a reference and play it (web-audio SSE or local). */
	async synthesize(
		text: string,
		ref: {
			samples: Float32Array;
			sampleRate: number;
			text: string;
			defaultSpeed?: number;
		},
		speed: number,
		voiceId = this.config.voiceId || DEFAULT_CONFIG.voiceId,
	): Promise<AudioAsset> {
		const engine = (await this.ensureEngine()) as {
			generateAsync: (opts: Record<string, unknown>) => Promise<{
				samples: Float32Array;
				sampleRate: number;
			}>;
		};
		const sherpa = (await import("sherpa-onnx-node")).default as {
			GenerationConfig: new (opts: Record<string, unknown>) => unknown;
		};
		const generationConfig = new sherpa.GenerationConfig({
			speed: clampSpeed(speed),
			referenceAudio: ref.samples,
			referenceSampleRate: ref.sampleRate,
			referenceText: ref.text,
			numSteps: 4,
			extra: { min_char_in_sentence: 10 },
		});
		const audio = await engine.generateAsync({
			text,
			enableExternalBuffer: true,
			generationConfig,
		});
		const sampleRate = audio.sampleRate || 24000;

		// Cache the latest audio for the download endpoint (works for both the
		// normal workflow and the /test endpoint since both go through speak()).
		const wav = f32ToWav(audio.samples, sampleRate);
		this.lastAudio = {
			wav,
			text,
			at: Date.now(),
		};
		const createdAt = Date.now();
		const audioSeq = this.seq++;
		const audioId = `${createdAt.toString(36)}-${audioSeq.toString(36)}`;
		const asset: AudioAsset = {
			audioId,
			wav,
			text,
			voiceId,
			durationMs: Math.round((audio.samples.length / sampleRate) * 1000),
			createdAt,
		};
		this.audioAssets.set(audioId, asset);

		if (this.config.playbackMode === "local") {
			await this.playLocal(audio.samples, sampleRate);
			return asset;
		}

		// web-audio: notify browser clients; they fetch the runtime WAV by id.
		this.emitAudio({
			kind: "play",
			seq: audioSeq,
			audioId,
			url: `/rainbow-fart/audios/${audioId}.wav`,
			text,
			voiceId,
			durationMs: asset.durationMs,
		});
		return asset;
	}

	async playLocal(samples: Float32Array, sampleRate: number): Promise<void> {
		const Speaker = await this.loadSpeaker();
		if (!this.speaker) {
			this.speaker = new Speaker({ channels: 1, bitDepth: 16, sampleRate }) as {
				end: () => void;
				write: (buf: Buffer) => void;
			};
		}
		this.speaker.write(f32ToInt16(samples));
	}

	async loadSpeaker(): Promise<{
		new (opts: Record<string, unknown>): unknown;
	}> {
		try {
			const mod = await import("speaker");
			return (mod.default ?? mod) as {
				new (opts: Record<string, unknown>): unknown;
			};
		} catch {
			throw new Error(
				"local playback requires the 'speaker' package (npm i speaker) — it is intentionally NOT bundled. " +
					"Install it once, or switch playbackMode back to 'web-audio'.",
			);
		}
	}
}

export function apply(ctx: ApplyContext): void {
	const runtime = new RainbowFartRuntime(
		ctx as unknown as RainbowFartRuntime["ctx"],
	);
	ctx.effect(() => {
		runtime.start();
		return () => runtime.dispose();
	}, "rainbow-fart: runtime");
}

interface ApplyContext {
	effect(cb: () => (() => void) | void, label?: string): void;
}

export { DEFAULT_CONFIG, RainbowFartRuntime };
