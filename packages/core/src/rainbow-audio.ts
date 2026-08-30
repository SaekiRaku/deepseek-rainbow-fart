export type RainbowAudioLoadingEventData = {
	status: "loading";
	cardId: string;
	turn: number;
	anchorSeq: number;
	createdAt: number;
};

export type RainbowAudioReadyEventData = {
	status: "ready";
	cardId: string;
	audioId: string;
	turn: number;
	anchorSeq: number;
	text: string;
	voiceId: string;
	durationMs: number;
	createdAt: number;
};

export type RainbowAudioErrorEventData = {
	status: "error";
	cardId: string;
	turn: number;
	anchorSeq: number;
	createdAt: number;
};

export type RainbowAudioEventData =
	| RainbowAudioLoadingEventData
	| RainbowAudioReadyEventData
	| RainbowAudioErrorEventData;
