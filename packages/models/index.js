// Bundled offline TTS assets for deepseek-rainbow-fart.
// All shipped inside this package so a user never downloads anything.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the bundled ZipVoice model directory (zh-en, voice cloning). */
export const zipVoiceDir = join(here, "zipvoice");

/** sherpa-onnx OfflineTts model config for the bundled ZipVoice model. */
export const zipVoiceModelConfig = {
	model: {
		zipvoice: {
			tokens: join(zipVoiceDir, "tokens.txt"),
			encoder: join(zipVoiceDir, "encoder.int8.onnx"),
			decoder: join(zipVoiceDir, "decoder.int8.onnx"),
			vocoder: join(zipVoiceDir, "vocos_24khz.onnx"),
			dataDir: join(zipVoiceDir, "espeak-ng-data"),
			lexicon: join(zipVoiceDir, "lexicon.txt"),
		},
		debug: false,
		numThreads: 2,
		provider: "cpu",
	},
	maxNumSentences: 1,
};

/** Absolute path to the bundled built-in voices directory. */
export const builtInVoicesDir = join(here, "built-in-voices");

/** id of the single bundled built-in voice. */
export const builtInVoiceId = "cyy";

/** Absolute path to the bundled built-in voice pack zip. */
export const builtInVoiceZipPath = join(builtInVoicesDir, "cyy.zip");

export default {
	zipVoiceDir,
	zipVoiceModelConfig,
	builtInVoicesDir,
	builtInVoiceId,
	builtInVoiceZipPath,
};