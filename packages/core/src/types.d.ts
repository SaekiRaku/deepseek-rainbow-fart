// Ambient types for runtime-only external dependencies that are provided by
// the DeepSeek Harness profile at runtime (never installed from npm by us).
// These keep the build self-contained; the real APIs are resolved at runtime.

declare module "@deepseek-ai/dsh-llm" {
	export class BlockAssembler {
		push(chunk: unknown): void;
		blocks(): Array<{ type: string; text?: string }>;
		finish:
			| { kind: string; failure?: { message?: string; code?: string } }
			| undefined;
	}
	export function createUserMessage(input: {
		content: Array<{ type: string; text: string }>;
		source: {
			kind: string;
			plugin: string;
			form?: string;
			summary?: string;
		} & Record<string, unknown>;
	}): unknown;
	export function createAssistantMessage(input: {
		content: Array<{ type: string; text: string }>;
		source: { provider: string; model: string };
	}): unknown;
	export function deepFreeze<T>(value: T): T;
}

// Optional user-installed local-playback library (intentionally NOT bundled).
declare module "speaker" {
	export default class Speaker {
		constructor(options: {
			channels?: number;
			bitDepth?: number;
			sampleRate?: number;
		});
		write(buffer: Uint8Array | Buffer): boolean;
		end(): void;
	}
}
