import { describe, expect, it } from "bun:test";
import { zipSync, strToU8 } from "fflate";
import {
	parseVoicePack,
	slugifyId,
	MAX_ZIP_BYTES,
	MAX_ENTRIES,
	installVoicePack,
	exportVoicePack,
	listVoicePacks,
	readVoicePack,
	removeVoicePack,
	ensureBuiltInVoicePack,
	updateVoicePack,
	parseMultipart,
	BUILTIN_MARKER,
} from "./voice-pack";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WAV = new Uint8Array(1024).fill(7); // 合法占位 wav 字节
const validMeta = { meta: { name: "x", gender: "女", language: "中文", text: "你好", audio: "./audio.wav" } };

function pack(files: Record<string, string | Uint8Array>): Buffer {
	return Buffer.from(
		zipSync(
			Object.fromEntries(
				Object.entries(files).map(([k, v]) => [
					k,
					typeof v === "string" ? strToU8(v) : v,
				]),
			),
			{ level: 0 },
		),
	);
}

describe("parseVoicePack", () => {
	it("解析合法 zip", () => {
		const z = pack({ "meta.json": JSON.stringify(validMeta), "audio.wav": WAV });
		const r = parseVoicePack(z);
		expect(r.meta.text).toBe("你好");
		expect(r.meta.audio).toBe("./audio.wav");
		expect(r.audioRel).toBe("audio.wav");
		expect(r.audioData.byteLength).toBe(WAV.byteLength);
	});

	it("解析可选 speed 字段", () => {
		const z = pack({
			"meta.json": JSON.stringify({
				meta: { text: "t", audio: "./a.wav", speed: 1.2 },
			}),
			"a.wav": WAV,
		});
		expect(parseVoicePack(z).meta.speed).toBe(1.2);
	});

	it("speed 非数字则忽略", () => {
		const z = pack({
			"meta.json": JSON.stringify({
				meta: { text: "t", audio: "./a.wav", speed: "fast" },
			}),
			"a.wav": WAV,
		});
		expect(parseVoicePack(z).meta.speed).toBeUndefined();
	});

	it("解析可选 avatar/prompts，并返回 avatar 数据", () => {
		const avatar = new Uint8Array(64).fill(1);
		const z = pack({
			"meta.json": JSON.stringify({
				meta: { text: "t", audio: "./a.wav", avatar: "./a.png", prompts: "温柔语气" },
			}),
			"a.wav": WAV,
			"a.png": avatar,
		});
		const r = parseVoicePack(z);
		expect(r.meta.avatar).toBe("./a.png");
		expect(r.meta.prompts).toBe("温柔语气");
		expect(r.avatarRel).toBe("a.png");
		expect(r.avatarData?.byteLength).toBe(64);
	});

	it("meta.avatar 指向文件不存在则拒绝", () => {
		const z = pack({
			"meta.json": JSON.stringify({
				meta: { text: "t", audio: "./a.wav", avatar: "./missing.png" },
			}),
			"a.wav": WAV,
		});
		expect(() => parseVoicePack(z)).toThrow();
	});

	it("拒绝路径穿越条目 ../evil.wav", () => {
		const z = pack({
			"meta.json": JSON.stringify(validMeta),
			"../evil.wav": WAV,
		});
		expect(() => parseVoicePack(z)).toThrow();
	});

	it("拒绝绝对路径条目", () => {
		const z = pack({
			"meta.json": JSON.stringify(validMeta),
			"/etc/passwd": WAV,
		});
		expect(() => parseVoicePack(z)).toThrow();
	});

	it("拒绝 meta.audio 指向逃逸路径", () => {
		const z = pack({
			"meta.json": JSON.stringify({
				meta: { text: "t", audio: "../../etc/passwd" },
			}),
			"../../etc/passwd": WAV,
		});
		expect(() => parseVoicePack(z)).toThrow();
	});

	it("拒绝缺失必填 text", () => {
		const z = pack({
			"meta.json": JSON.stringify({ meta: { audio: "./a.wav" } }),
			"a.wav": WAV,
		});
		expect(() => parseVoicePack(z)).toThrow();
	});

	it("拒绝缺失必填 audio", () => {
		const z = pack({
			"meta.json": JSON.stringify({ meta: { text: "t" } }),
			"a.wav": WAV,
		});
		expect(() => parseVoicePack(z)).toThrow();
	});

	it("拒绝 meta.audio 指向的文件不存在", () => {
		const z = pack({ "meta.json": JSON.stringify(validMeta) });
		expect(() => parseVoicePack(z)).toThrow();
	});

	it("可选字段缺失宽松通过（name/gender/language/description）", () => {
		const z = pack({
			"meta.json": JSON.stringify({ meta: { text: "t", audio: "./a.wav" } }),
			"a.wav": WAV,
		});
		const r = parseVoicePack(z);
		expect(r.meta.name).toBeUndefined();
	});

	it("拒绝超限 zip", () => {
		const big = new Uint8Array(MAX_ZIP_BYTES + 1);
		expect(() => parseVoicePack(Buffer.from(big))).toThrow();
	});

	it("拒绝超多条目 zip", () => {
		const files: Record<string, Uint8Array> = {
			"meta.json": strToU8(JSON.stringify(validMeta)),
		};
		for (let i = 0; i < MAX_ENTRIES + 1; i++) files[`f${i}.bin`] = new Uint8Array(1);
		expect(() => parseVoicePack(pack(files))).toThrow();
	});

	it("兼容单顶层文件夹包裹的 zip（自动读取文件夹内内容）", () => {
		const z = pack({
			"my-voice/meta.json": JSON.stringify(validMeta),
			"my-voice/audio.wav": WAV,
		});
		const r = parseVoicePack(z);
		expect(r.meta.text).toBe("你好");
		expect(r.audioRel).toBe("audio.wav");
		expect(r.audioData.byteLength).toBe(WAV.byteLength);
	});

	it("文件夹包裹 + 目录条目 + 头像也能解析", () => {
		const avatar = new Uint8Array(64).fill(1);
		const z = pack({
			"my-voice/": new Uint8Array(0),
			"my-voice/meta.json": JSON.stringify({
				meta: { text: "t", audio: "./a.wav", avatar: "./a.png" },
			}),
			"my-voice/a.wav": WAV,
			"my-voice/a.png": avatar,
		});
		const r = parseVoicePack(z);
		expect(r.audioRel).toBe("a.wav");
		expect(r.avatarRel).toBe("a.png");
		expect(r.avatarData?.byteLength).toBe(64);
	});

	it("文件夹内嵌套子目录仍拒绝", () => {
		const z = pack({
			"my-voice/meta.json": JSON.stringify({
				meta: { text: "t", audio: "./sub/a.wav" },
			}),
			"my-voice/sub/a.wav": WAV,
		});
		expect(() => parseVoicePack(z)).toThrow();
	});

	it("根目录与文件夹混合的结构仍拒绝", () => {
		const z = pack({
			"meta.json": JSON.stringify(validMeta),
			"my-voice/audio.wav": WAV,
		});
		expect(() => parseVoicePack(z)).toThrow();
	});
});

describe("slugifyId", () => {
	it("中文名 -> 空则回退", () => {
		expect(slugifyId("小美")).toBe("");
	});
	it("ASCII 规范", () => {
		expect(slugifyId("My Voice 2")).toBe("my-voice-2");
	});
});

async function tmpDir() {
	return mkdtemp(join(tmpdir(), "vp-"));
}

describe("install/list/export/remove", () => {
	it("安装后 list 可见、导出 zip round-trip、删除成功", async () => {
		const dir = await tmpDir();
		try {
			const z = pack({
				"meta.json": JSON.stringify({
					meta: { name: "x", text: "你好", audio: "./audio.wav", speed: 1.3 },
				}),
				"audio.wav": WAV,
			});
			const vp = await installVoicePack(z, dir);
			expect(vp.id).toBe("x");
			expect(vp.builtIn).toBe(false);
			expect(vp.speed).toBe(1.3);
			expect(vp.dir.startsWith(dir)).toBe(true);

			const listed = await listVoicePacks(dir);
			expect(listed).toHaveLength(1);
			expect(listed[0].id).toBe("x");
			expect(listed[0].speed).toBe(1.3);

			const exp = await exportVoicePack(vp.dir);
			const again = parseVoicePack(exp);
			expect(again.meta.audio).toBe("./audio.wav");
			expect(again.meta.speed).toBe(1.3);
			expect(again.audioData.byteLength).toBe(WAV.byteLength);

			await removeVoicePack(vp.dir, false);
			expect(await listVoicePacks(dir)).toHaveLength(0);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("内置安装带 .builtin 标记且不可删除", async () => {
		const dir = await tmpDir();
		try {
			const z = pack({ "meta.json": JSON.stringify(validMeta), "audio.wav": WAV });
			const vp = await installVoicePack(z, dir, { id: "cyy", builtIn: true });
			expect(vp.id).toBe("cyy");
			expect(vp.builtIn).toBe(true);
			const marker = join(vp.dir, BUILTIN_MARKER);
			expect((await readFile(marker)).length).toBe(0);
			await expect(removeVoicePack(vp.dir, true)).rejects.toThrow();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("id 冲突自动追加后缀", async () => {
		const dir = await tmpDir();
		try {
			const z = pack({ "meta.json": JSON.stringify(validMeta), "audio.wav": WAV });
			const a = await installVoicePack(z, dir);
			const b = await installVoicePack(z, dir);
			expect(a.id).toBe("x");
			expect(b.id).toBe("x-2");
			expect((await listVoicePacks(dir)).map((v) => v.id).sort()).toEqual([
				"x",
				"x-2",
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("readVoicePack 对不完整目录返回 null", async () => {
		const dir = await tmpDir();
		try {
			expect(await readVoicePack(dir)).toBeNull();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("文件夹包裹 zip 安装后按平铺布局落盘", async () => {
		const dir = await tmpDir();
		try {
			const z = pack({
				"my-voice/meta.json": JSON.stringify({
					meta: { name: "wrapped", text: "你好", audio: "./audio.wav" },
				}),
				"my-voice/audio.wav": WAV,
			});
			const vp = await installVoicePack(z, dir);
			expect(vp.id).toBe("wrapped");
			expect(vp.audioRelName).toBe("audio.wav");
			expect(vp.audioPath).toBe(join(vp.dir, "audio.wav"));
			const listed = await listVoicePacks(dir);
			expect(listed).toHaveLength(1);
			expect(listed[0].id).toBe("wrapped");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("ensureBuiltInVoicePack", () => {
	const z = () => pack({ "meta.json": JSON.stringify(validMeta), "audio.wav": WAV });

	it("重复调用只保留一个内置音色（回归：重启不增加 cyy-2/cyy-3）", async () => {
		const dir = await tmpDir();
		try {
			// simulate the old buggy state: a stale builtin cyy-2 exists
			const stale = await installVoicePack(z(), dir, { id: "cyy-2", builtIn: true });
			expect(stale.id).toBe("cyy-2");

			// two boots, each calling ensure
			await ensureBuiltInVoicePack(z(), dir, "cyy");
			await ensureBuiltInVoicePack(z(), dir, "cyy");

			const voices = await listVoicePacks(dir);
			expect(voices.map((v) => v.id).sort()).toEqual(["cyy"]);
			expect(voices.every((v) => v.builtIn)).toBe(true);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("parseMultipart", () => {
	it("解析浏览器风格的三段 multipart（meta + audio + text）", () => {
		const boundary = "----FormBoundaryTest123";
		const meta = JSON.stringify(validMeta);
		const audio = Buffer.alloc(100, 7);
		const body = Buffer.concat([
			Buffer.from(`--${boundary}\r\n`),
			Buffer.from(`Content-Disposition: form-data; name="meta"; filename="meta.json"\r\nContent-Type: application/json\r\n\r\n`),
			Buffer.from(meta),
			Buffer.from(`\r\n--${boundary}\r\n`),
			Buffer.from(`Content-Disposition: form-data; name="audio"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`),
			audio,
			Buffer.from(`\r\n--${boundary}\r\n`),
			Buffer.from(`Content-Disposition: form-data; name="text"\r\n\r\n`),
			Buffer.from("测试文案"),
			Buffer.from(`\r\n--${boundary}--\r\n`),
		]);
		const out = parseMultipart(body, `multipart/form-data; boundary=${boundary}`);
		expect(JSON.parse(out.meta!.toString()).meta.name).toBe("x");
		expect(out.audio!.byteLength).toBe(100);
		expect(out.text!.toString()).toBe("测试文案");
	});

	it("无 boundary 返回空对象", () => {
		expect(parseMultipart(Buffer.from("x"), "text/plain")).toEqual({});
	});

	it("boundary 用引号包裹也能解析", () => {
		const boundary = "Bnd123";
		const body = Buffer.concat([
			Buffer.from(`--${boundary}\r\n`),
			Buffer.from(`Content-Disposition: form-data; name="text"\r\n\r\n`),
			Buffer.from("hi"),
			Buffer.from(`\r\n--${boundary}--\r\n`),
		]);
		const out = parseMultipart(body, `multipart/form-data; boundary="${boundary}"`);
		expect(out.text!.toString()).toBe("hi");
	});
});

describe("内置音色覆盖安装", () => {
	const makeZip = (speed: number) =>
		pack({
			"meta.json": JSON.stringify({
				meta: { text: "你好", audio: "./audio.wav", speed, prompts: `p${speed}` },
			}),
			"audio.wav": WAV,
		});

	it("ensureBuiltInVoicePack 重新安装更新已有内置（speed/prompts 变化生效）", async () => {
		const dir = await tmpDir();
		try {
			// first boot: speed 1.2
			await ensureBuiltInVoicePack(makeZip(1.2), dir, "cyy");
			expect(await readVoicePack(join(dir, "cyy"))).not.toBeNull();

			// second boot with a different pack version: must overwrite (not skip)
			await ensureBuiltInVoicePack(makeZip(1.5), dir, "cyy");
			const updated = await readVoicePack(join(dir, "cyy"));
			expect(updated?.speed).toBe(1.5);
			expect(updated?.prompts).toBe("p1.5");
			expect((await listVoicePacks(dir)).filter((v) => v.builtIn).length).toBe(1);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("updateVoicePack", () => {
	it("更新 meta 且替换音频，内置被拒", async () => {
		const dir = await tmpDir();
		try {
			const z = pack({
				"meta.json": JSON.stringify({
					meta: { text: "旧文本", audio: "./audio.wav", speed: 1.0 },
				}),
				"audio.wav": WAV,
			});
			const vp = await installVoicePack(z, dir);
			const newAudio = new Uint8Array(2048).fill(9);
			const updated = await updateVoicePack(
				vp.dir,
				false,
				{ text: "新文本", audio: "./audio.wav", speed: 1.3, prompts: "酷酷风" },
				"新描述",
				{ audioData: newAudio },
			);
			expect(updated.text).toBe("新文本");
			expect(updated.speed).toBe(1.3);
			expect(updated.prompts).toBe("酷酷风");
			expect(updated.description).toBe("新描述");
			expect(updated.audioPath).toBe(vp.audioPath);

			// built-in forbidden
			const bi = await installVoicePack(z, dir, { id: "cyy", builtIn: true });
			await expect(
				updateVoicePack(bi.dir, true, { text: "x", audio: "./audio.wav" }),
			).rejects.toThrow();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("未修改头像时保留，明确移除时删除", async () => {
		const dir = await tmpDir();
		try {
			const z = pack({
				"meta.json": JSON.stringify({
					meta: { text: "旧文本", audio: "./audio.wav", avatar: "./avatar.png" },
				}),
				"audio.wav": WAV,
				"avatar.png": new Uint8Array(64).fill(3),
			});
			const vp = await installVoicePack(z, dir);

			const preserved = await updateVoicePack(vp.dir, false, {
				text: "新文本",
				audio: "./audio.wav",
				avatar: "./avatar.png",
			});
			expect(preserved.avatar).toBe("./avatar.png");
			expect((await readFile(preserved.avatarPath!)).byteLength).toBe(64);

			const removed = await updateVoicePack(
				vp.dir,
				false,
				{ text: "新文本", audio: "./audio.wav" },
				undefined,
				{ removeAvatar: true },
			);
			expect(removed.avatar).toBeUndefined();
			expect(removed.avatarPath).toBeUndefined();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
