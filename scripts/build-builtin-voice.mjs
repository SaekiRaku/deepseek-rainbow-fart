// Build packages/models/built-in-voices/cyy.zip from the cyy_zh source files.
// Idempotent; run with `bun scripts/build-builtin-voice.mjs`.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
// fflate is hoisted under packages/core (bun workspace); resolve it from there.
const require = createRequire(fileURLToPath(new URL("../packages/core/package.json", import.meta.url)));
const { zipSync, strToU8, unzipSync, strFromU8 } = require("fflate");

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "../packages/models/built-in-voices");
// Reference text comes from the previously built cyy.zip (cyy_zh.txt was
// folded into meta.json when the pack format changed).
let prevText = "";
try {
	const prev = unzipSync(
		new Uint8Array(readFileSync(join(dir, "cyy.zip")).buffer),
	);
	prevText = JSON.parse(strFromU8(prev["meta.json"])).meta.text ?? "";
} catch {
	/* first build before any cyy.zip exists */
}
const meta = {
	meta: {
		name: "cyy",
		gender: "女",
		language: "中文",
		text: prevText,
		audio: "./audio.wav",
		speed: 1.2,
		avatar: "./avatar.svg",
		prompts: "请用温柔甜美的语气，营造温暖治愈的氛围。",
	},
	description: "音色源自我最好的朋友",
};
const wav = readFileSync(join(dir, "cyy_zh.wav"));
// Simple generated avatar: gradient circle with the initial letter.
const avatarSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f472b6"/>
      <stop offset="1" stop-color="#8b5cf6"/>
    </linearGradient>
  </defs>
  <rect width="96" height="96" rx="24" fill="url(#g)"/>
  <text x="48" y="60" font-family="system-ui, sans-serif" font-size="44" font-weight="700" fill="#ffffff" text-anchor="middle">c</text>
</svg>`;
const zipped = zipSync(
	{
		"meta.json": strToU8(JSON.stringify(meta, null, 2)),
		"audio.wav": new Uint8Array(wav.buffer, wav.byteOffset, wav.length),
		"avatar.svg": strToU8(avatarSvg),
	},
	{ level: 6 },
);
writeFileSync(join(dir, "cyy.zip"), zipped);
console.log("BUILD_OK: cyy.zip", zipped.byteLength, "bytes");
