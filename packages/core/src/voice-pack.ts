// Voice-pack handling: zip parse/validate + filesystem persistence.
// Security: every entry path and meta.audio must be a safe flat relative path.
// Compatibility: a zip whose files all live under one root folder is flattened
// on import (e.g. "my-voice/meta.json" is read as "meta.json").
import { join, dirname, sep } from "node:path";
import { mkdir, writeFile, readFile, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";

export const BUILTIN_MARKER = ".builtin";
export const MAX_ZIP_BYTES = 50 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
export const MAX_ENTRIES = 64;

export interface VoiceMeta {
	name?: string;
	gender?: string;
	language?: string;
	text: string;
	audio: string;
	/** Default playback speed multiplier (optional). */
	speed?: number;
	/** Optional avatar image path inside the pack (e.g. "./avatar.png"). */
	avatar?: string;
	/** Optional extra "rainbow fart" prompt appended via ${voice_prompts}. */
	prompts?: string;
}
export interface VoiceInfo extends VoiceMeta {
	id: string;
	description?: string;
	builtIn: boolean;
	importedAt: number;
}
export interface VoicePack extends VoiceInfo {
	dir: string;
	audioPath: string;
	audioRelName: string;
	avatarPath?: string;
	avatarRelName?: string;
}

/** True when a zip entry name is a safe flat relative path (no drive, no .., no separators). */
export function isSafeEntryPath(name: string): boolean {
	if (typeof name !== "string" || name.length === 0) return false;
	if (name.startsWith("/") || name.startsWith("\\")) return false;
	if (/^[a-zA-Z]:/.test(name)) return false;
	if (name.includes("\\")) return false;
	if (name.includes("..")) return false;
	if (name.includes("/")) return false;
	return true;
}

/**
 * 兼容整包被一个顶层文件夹包裹的 zip（如压缩工具产生的
 * "my-voice/meta.json" 结构）：当所有文件条目的第一段路径相同时，
 * 剥掉该前缀，按根目录平铺结构解析。目录条目（"root/"）被丢弃。
 * 混合结构（部分在根、部分在文件夹下）或多层嵌套不剥离，
 * 交由后续 isSafeEntryPath 安全检查拒绝。
 */
export function flattenSingleRootFolder(
	files: Record<string, Uint8Array>,
): Record<string, Uint8Array> {
	const fileNames = Object.keys(files).filter((name) => !name.endsWith("/"));
	if (fileNames.length === 0) return files;
	const roots = new Set(fileNames.map((name) => name.split("/")[0]));
	if (roots.size !== 1) return files;
	const [root] = roots;
	// 存在与顶层文件夹同名的文件条目时不剥离，避免丢失该文件。
	if (!root || Object.hasOwn(files, root)) return files;
	const prefix = `${root}/`;
	const out: Record<string, Uint8Array> = {};
	for (const [name, data] of Object.entries(files)) {
		if (!name.startsWith(prefix)) continue;
		const rel = name.slice(prefix.length);
		if (rel === "") continue; // 顶层目录条目 "root/"
		out[rel] = data;
	}
	return out;
}

/** Normalize "./audio.wav" -> "audio.wav"; reject anything unsafe. */
export function normalizeRelPath(rel: string): string {
	if (typeof rel !== "string" || rel.length === 0) throw new Error("空音频路径");
	let r = rel.replace(/^\.\/+/, "");
	if (r.startsWith("/") || r.includes("..") || r.includes("\\") || r.includes("/"))
		throw new Error(`不安全的音频路径: ${rel}`);
	if (!r) throw new Error(`不安全的音频路径: ${rel}`);
	return r;
}

export function slugifyId(name: string): string {
	return (name ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** Parse + validate a voice pack zip. Throws on any security/format violation. */
export function parseVoicePack(zipBuffer: Buffer): {
	meta: VoiceMeta;
	description?: string;
	audioRel: string;
	audioData: Uint8Array;
	avatarRel?: string;
	avatarData?: Uint8Array;
} {
	if (zipBuffer.byteLength > MAX_ZIP_BYTES) throw new Error("音色包超过大小上限 (50MB)");
	const files = flattenSingleRootFolder(
		unzipSync(new Uint8Array(zipBuffer.buffer, zipBuffer.byteOffset, zipBuffer.byteLength)),
	);
	const names = Object.keys(files);
	if (names.length > MAX_ENTRIES) throw new Error(`音色包条目过多 (${names.length})`);
	for (const name of names) {
		if (!isSafeEntryPath(name)) throw new Error(`不安全的音色包条目: ${name}`);
	}
	const metaRaw = files["meta.json"];
	if (!metaRaw) throw new Error("音色包缺少 meta.json");
	let parsed: { meta?: Record<string, unknown>; description?: unknown };
	try {
		parsed = JSON.parse(strFromU8(metaRaw));
	} catch {
		throw new Error("meta.json 不是合法 JSON");
	}
	const m = parsed.meta;
	if (!m || typeof m !== "object") throw new Error("meta.json 缺少 meta 字段");
	const text = m.text;
	const audio = m.audio;
	if (typeof text !== "string" || text.trim() === "") throw new Error("meta.text 必填");
	if (typeof audio !== "string" || audio.trim() === "") throw new Error("meta.audio 必填");
	const audioRel = normalizeRelPath(audio);
	const audioData = files[audioRel];
	if (!audioData) throw new Error(`meta.audio 指向的文件不存在: ${audio}`);
	if (audioData.byteLength > MAX_AUDIO_BYTES) throw new Error("音频文件超过大小上限 (20MB)");
	const meta: VoiceMeta = { text: text.trim(), audio };
	if (typeof m.name === "string" && m.name.trim() !== "") meta.name = m.name.trim();
	if (typeof m.gender === "string" && m.gender.trim() !== "") meta.gender = m.gender.trim();
	if (typeof m.language === "string" && m.language.trim() !== "") meta.language = m.language.trim();
	if (typeof m.speed === "number" && Number.isFinite(m.speed)) meta.speed = m.speed;
	if (typeof m.prompts === "string" && m.prompts.trim() !== "") meta.prompts = m.prompts.trim();
	const description =
		typeof parsed.description === "string" && parsed.description.trim() !== ""
			? parsed.description.trim()
			: undefined;
	// Optional avatar: must reference an existing file inside the pack.
	let avatarRel: string | undefined;
	let avatarData: Uint8Array | undefined;
	if (typeof m.avatar === "string" && m.avatar.trim() !== "") {
		avatarRel = normalizeRelPath(m.avatar);
		avatarData = files[avatarRel];
		if (!avatarData) throw new Error(`meta.avatar 指向的文件不存在: ${m.avatar}`);
		if (avatarData.byteLength > MAX_AUDIO_BYTES) throw new Error("头像文件超过大小上限 (20MB)");
		meta.avatar = m.avatar.trim();
	}
	return { meta, description, audioRel, audioData, avatarRel, avatarData };
}

export function findFreeId(base: string, voicesDir: string, preferred?: string): string {
	const start = preferred && isSafeEntryPath(preferred) ? preferred : base;
	if (!existsSync(join(voicesDir, start))) return start;
	for (let n = 2; n <= 999; n++) {
		const candidate = `${start}-${n}`;
		if (!existsSync(join(voicesDir, candidate))) return candidate;
	}
	throw new Error("音色目录名冲突过多");
}

export async function installVoicePack(
	zipBuffer: Buffer,
	voicesDir: string,
	opts?: { id?: string; builtIn?: boolean; overwrite?: boolean },
): Promise<VoicePack> {
	const { meta, description, audioRel, audioData, avatarRel, avatarData } =
		parseVoicePack(zipBuffer);
	await mkdir(voicesDir, { recursive: true });
	const preferred = opts?.id && isSafeEntryPath(opts.id) ? opts.id : undefined;
	const base = (preferred ?? slugifyId(meta.name ?? "")) || `voice-${Date.now()}`;
	const id = opts?.overwrite && preferred ? preferred : findFreeId(base, voicesDir, preferred);
	const dir = join(voicesDir, id);
	if (opts?.overwrite && existsSync(dir)) {
		await rm(dir, { recursive: true, force: true });
	}
	await mkdir(dir, { recursive: true });
	await writeFile(
		join(dir, "meta.json"),
		JSON.stringify({ meta, ...(description ? { description } : {}) }, null, 2),
		"utf8",
	);
	// preserve the audio file at its relative path inside the pack dir
	const audioDir = dirname(join(dir, audioRel));
	if (audioDir !== dir) await mkdir(audioDir, { recursive: true });
	await writeFile(join(dir, audioRel), audioData);
	// optional avatar file
	if (avatarRel && avatarData) {
		const avatarDir = dirname(join(dir, avatarRel));
		if (avatarDir !== dir) await mkdir(avatarDir, { recursive: true });
		await writeFile(join(dir, avatarRel), avatarData);
	}
	if (opts?.builtIn) await writeFile(join(dir, BUILTIN_MARKER), "", "utf8");
	return {
		id,
		...meta,
		description,
		builtIn: Boolean(opts?.builtIn),
		importedAt: Date.now(),
		dir,
		audioPath: join(dir, audioRel),
		audioRelName: audioRel,
		...(avatarRel ? { avatarPath: join(dir, avatarRel), avatarRelName: avatarRel } : {}),
	};
}

export async function exportVoicePack(dir: string): Promise<Buffer> {
	const vp = await readVoicePack(dir);
	if (!vp) throw new Error("音色包不存在");
	const wav = await readFile(vp.audioPath);
	const clean = {
		name: vp.name,
		gender: vp.gender,
		language: vp.language,
		text: vp.text,
		audio: vp.audio,
		...(vp.speed !== undefined ? { speed: vp.speed } : {}),
		...(vp.avatar ? { avatar: vp.avatar } : {}),
		...(vp.prompts ? { prompts: vp.prompts } : {}),
	};
	const json = { meta: clean, ...(vp.description ? { description: vp.description } : {}) };
	const entries: Record<string, Uint8Array> = {
		"meta.json": strToU8(JSON.stringify(json, null, 2)),
		[vp.audioRelName]: new Uint8Array(wav.buffer, wav.byteOffset, wav.length),
	};
	if (vp.avatarPath && vp.avatarRelName) {
		const avatarBuf = await readFile(vp.avatarPath);
		entries[vp.avatarRelName] = new Uint8Array(
			avatarBuf.buffer,
			avatarBuf.byteOffset,
			avatarBuf.length,
		);
	}
	return Buffer.from(zipSync(entries, { level: 6 }));
}

export async function readVoicePack(dir: string): Promise<VoicePack | null> {
	try {
		const metaRaw = await readFile(join(dir, "meta.json"), "utf8");
		const parsed = JSON.parse(metaRaw) as { meta?: VoiceMeta; description?: string };
		if (
			!parsed.meta ||
			typeof parsed.meta.text !== "string" ||
			typeof parsed.meta.audio !== "string"
		)
			return null;
		const audioRel = normalizeRelPath(parsed.meta.audio);
		const builtIn = await stat(join(dir, BUILTIN_MARKER))
			.then(() => true)
			.catch(() => false);
		const s = await stat(dir);
		return {
			id: dir.split(sep).pop()!,
			name: parsed.meta.name,
			gender: parsed.meta.gender,
			language: parsed.meta.language,
			text: parsed.meta.text,
			audio: parsed.meta.audio,
			speed:
				typeof parsed.meta.speed === "number" && Number.isFinite(parsed.meta.speed)
					? parsed.meta.speed
					: undefined,
			description: parsed.description,
			builtIn,
			importedAt: s.mtimeMs,
			dir,
			audioPath: join(dir, audioRel),
			audioRelName: audioRel,
			...(parsed.meta.prompts ? { prompts: parsed.meta.prompts } : {}),
			...(parsed.meta.avatar
				? {
						avatar: parsed.meta.avatar,
						avatarPath: join(dir, normalizeRelPath(parsed.meta.avatar)),
						avatarRelName: normalizeRelPath(parsed.meta.avatar),
					}
				: {}),
		};
	} catch {
		return null;
	}
}

export async function listVoicePacks(voicesDir: string): Promise<VoicePack[]> {
	let entries: string[];
	try {
		entries = await readdir(voicesDir);
	} catch {
		return [];
	}
	const packs: VoicePack[] = [];
	for (const name of entries) {
		if (name.startsWith(".")) continue; // skip dotfiles / .builtin dirs
		const vp = await readVoicePack(join(voicesDir, name));
		if (vp) packs.push(vp);
	}
	return packs;
}

export async function removeVoicePack(dir: string, builtIn: boolean): Promise<void> {
	if (builtIn) throw new Error("内置音色不可删除");
	await rm(dir, { recursive: true, force: true });
}

/**
 * Overwrite a voice pack's meta and optionally replace its audio/avatar
 * files in place. Keeps the same id and directory. Built-ins are rejected.
 */
export async function updateVoicePack(
	dir: string,
	builtIn: boolean,
	meta: VoiceMeta,
	description?: string,
	opts?: { audioData?: Uint8Array; avatarData?: Uint8Array; removeAvatar?: boolean },
): Promise<VoicePack> {
	if (builtIn) throw new Error("内置音色不可编辑");
	const existing = await readVoicePack(dir);
	if (!existing) throw new Error("音色包不存在");
	const audioRel = normalizeRelPath(meta.audio);
	const pack: VoiceMeta = {
		...meta,
		audio: meta.audio,
		...(meta.avatar ? { avatar: meta.avatar } : {}),
		...(meta.prompts ? { prompts: meta.prompts } : {}),
	};
	const writeJson = { meta: pack, ...(description ? { description } : {}) };
	await writeFile(join(dir, "meta.json"), JSON.stringify(writeJson, null, 2), "utf8");
	if (opts?.audioData) {
		const audioDir = dirname(join(dir, audioRel));
		if (audioDir !== dir) await mkdir(audioDir, { recursive: true });
		await writeFile(join(dir, audioRel), opts.audioData);
	}
	if (opts?.avatarData) {
		const avatarRel = normalizeRelPath(meta.avatar ?? "");
		const avatarDir = dirname(join(dir, avatarRel));
		if (avatarDir !== dir) await mkdir(avatarDir, { recursive: true });
		await writeFile(join(dir, avatarRel), opts.avatarData);
	}
	if (opts?.removeAvatar && existing.avatarRelName) {
		await rm(join(dir, existing.avatarRelName), { force: true });
	}
	const updated = await readVoicePack(dir);
	if (!updated) throw new Error("音色包更新失败");
	return updated;
}

/**
 * Install the built-in voice pack into voicesDir, always overwriting the
 * pinned id so pack updates (speed/avatar/prompts) take effect on every boot.
 * Then remove any other builtIn pack dirs (stale duplicates from earlier
 * buggy versions). Safe to call on every boot.
 */
export async function ensureBuiltInVoicePack(
	zipBuffer: Buffer,
	voicesDir: string,
	id: string,
): Promise<void> {
	await installVoicePack(zipBuffer, voicesDir, { id, builtIn: true, overwrite: true });
	const voices = await listVoicePacks(voicesDir);
	for (const v of voices) {
		if (v.builtIn && v.id !== id) {
			await rm(v.dir, { recursive: true, force: true });
		}
	}
}

/** Minimal multipart/form-data parser: extracts named parts by field name. */
export function parseMultipart(
	body: Buffer,
	contentType: string,
): Record<string, Buffer> {
	const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
	const boundary = m?.[1] ?? m?.[2];
	if (!boundary) return {};
	const b = `--${boundary}`;
	const out: Record<string, Buffer> = {};
	let off = 0;
	while (true) {
		const idx = body.indexOf(b, off);
		if (idx === -1) break;
		// `--boundary--` signals the closing marker — end of parts.
		if (
			idx + b.length < body.length &&
			body[idx + b.length] === 0x2d &&
			body[idx + b.length + 1] === 0x2d
		) {
			break;
		}
		// Step past the boundary line's CRLF.
		let pos = idx + b.length;
		if (body[pos] === 0x0d && body[pos + 1] === 0x0a) pos += 2;
		const hEnd = body.indexOf(Buffer.from("\r\n\r\n"), pos);
		if (hEnd === -1) break;
		const header = body.slice(pos, hEnd).toString("utf8");
		const nameM = /name="([^"]+)"/.exec(header);
		const dataStart = hEnd + 4;
		const dEnd = body.indexOf(Buffer.from(`\r\n${b}`), dataStart);
		const dataEnd = dEnd === -1 ? body.length : dEnd;
		if (nameM) out[nameM[1]] = body.slice(dataStart, dataEnd);
		if (dEnd === -1) break;
		off = dEnd + 2;
	}
	return out;
}