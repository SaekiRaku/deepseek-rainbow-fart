// One browser audio controller shared by SSE autoplay and conversation cards.
import type { RainbowAudioEventData } from "../rainbow-audio";

type Listener = () => void;

export type AudioFrame = {
	kind: "play";
	seq: number;
	audioId: string;
	url: string;
	text: string;
	voiceId: string;
	durationMs: number;
};

type CardFrame = {
	kind: "card";
	sessionId: string;
	data: RainbowAudioEventData;
};

export type AudioPlaybackState = {
	audioId: string | null;
	playing: boolean;
	currentTime: number;
	duration: number;
	error: boolean;
};

const listeners = new Set<Listener>();
const cardListeners = new Set<Listener>();
const cards = new Map<string, RainbowAudioEventData>();
const pending: AudioFrame[] = [];
const audio = typeof Audio === "undefined" ? null : new Audio();

let activated = false;
let stream: EventSource | null = null;
let state: AudioPlaybackState = {
	audioId: null,
	playing: false,
	currentTime: 0,
	duration: 0,
	error: false,
};

function publish(next: Partial<AudioPlaybackState>): void {
	state = { ...state, ...next };
	listeners.forEach((listener) => listener());
}

function bindAudioEvents(): void {
	if (!audio) return;
	audio.addEventListener("play", () => publish({ playing: true, error: false }));
	audio.addEventListener("pause", () => publish({ playing: false }));
	audio.addEventListener("timeupdate", () =>
		publish({ currentTime: audio.currentTime }),
	);
	audio.addEventListener("durationchange", () =>
		publish({ duration: Number.isFinite(audio.duration) ? audio.duration : 0 }),
	);
	audio.addEventListener("ended", () =>
		publish({ playing: false, currentTime: audio.duration || 0 }),
	);
	audio.addEventListener("error", () => publish({ playing: false, error: true }));
}

bindAudioEvents();

export function audioUrl(audioId: string): string {
	return `/rainbow-fart/audios/${encodeURIComponent(audioId)}.wav`;
}

export function getPlaybackState(): AudioPlaybackState {
	return state;
}

export function subscribePlayback(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function cardKey(sessionId: string, turn: number): string {
	return `${sessionId}:${turn}`;
}

export function getRainbowCard(
	sessionId: string,
	turn: number,
): RainbowAudioEventData | null {
	return cards.get(cardKey(sessionId, turn)) ?? null;
}

export function hasRainbowCardForTurn(turn: number): boolean {
	for (const card of cards.values()) {
		if (card.turn === turn) return true;
	}
	return false;
}

export function subscribeRainbowCards(listener: Listener): () => void {
	cardListeners.add(listener);
	return () => cardListeners.delete(listener);
}

export function playAudio(audioId: string, restart = false): void {
	if (!audio) return;
	const changed = state.audioId !== audioId;
	if (changed) {
		audio.src = audioUrl(audioId);
		publish({ audioId, currentTime: 0, duration: 0, error: false });
	} else if (restart) {
		audio.currentTime = 0;
	}
	void audio.play().catch(() => publish({ playing: false, error: true }));
}

export function pauseAudio(): void {
	audio?.pause();
}

export function seekAudio(audioId: string, seconds: number): void {
	if (!audio || state.audioId !== audioId) return;
	audio.currentTime = Math.max(0, Math.min(seconds, audio.duration || seconds));
	publish({ currentTime: audio.currentTime });
}

export function ensureActivated(): void {
	if (activated) return;
	activated = true;
	listeners.forEach((listener) => listener());
	const next = pending.pop();
	pending.length = 0;
	if (next) playAudio(next.audioId, true);
}

export function isActivated(): boolean {
	return activated;
}

export function subscribeActivation(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function onFrame(frame: AudioFrame): void {
	if (!activated) {
		pending.push(frame);
		if (pending.length > 8) pending.shift();
		return;
	}
	playAudio(frame.audioId, true);
}

export function ensureStream(): void {
	if (stream) return;
	stream = new EventSource("/rainbow-fart/audio");
	stream.onmessage = (event) => {
		try {
			const frame = JSON.parse(event.data as string) as AudioFrame | CardFrame;
			if (frame.kind === "card") {
				cards.set(cardKey(frame.sessionId, frame.data.turn), frame.data);
				cardListeners.forEach((listener) => listener());
				return;
			}
			onFrame(frame);
		} catch {
			/* Ignore malformed frames. */
		}
	};
}

if (typeof document !== "undefined") {
	document.addEventListener("click", ensureActivated, {
		capture: true,
		once: true,
	});
}
