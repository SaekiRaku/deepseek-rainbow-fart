// Browser half (dsh.client) of deepseek-rainbow-fart.
// Registers the activation tag + the Rainbow Fart config view, and consumes
// the PCM stream served by the Node half over SSE.
import { ActivationTag } from "./activation-tag";
import { ConfigView } from "./config-view";
import { ensureStream, hasRainbowCardForTurn } from "./audio";
import { RainbowAudioTurnTail } from "./rainbow-audio-card";

// Minimal client context surface we use (type-only; provided by the harness).
interface SlotsService {
	inject(name: string, cb: () => void): void;
	register(options: Record<string, unknown>, component: unknown): void;
}
interface ClientContext {
	slots: SlotsService;
}

/** Services this plugin's apply body needs (injected by the client runtime). */
export const inject = ["slots"];

export function apply(ctx: ClientContext): void {
	ensureStream();

	ctx.slots.inject("conversation.chat.turnTail", () =>
		ctx.slots.register(
			{
				name: "conversation.chat.turnTail",
				id: "rainbow-fart-audio",
				select: (owner: { turn?: { turn?: number } }) => {
					const turn = owner.turn?.turn;
					return typeof turn === "number" && hasRainbowCardForTurn(turn)
						? true
						: null;
				},
			},
			RainbowAudioTurnTail,
		),
	);

	ctx.slots.inject("conversation.session.header.utilities", () =>
		ctx.slots.register(
			{
				name: "conversation.session.header.utilities",
				id: "rainbow-fart-activation",
				order: 90,
			},
			ActivationTag,
		),
	);

	ctx.slots.inject("conversation.view", () =>
		ctx.slots.register(
			{
				name: "conversation.view",
				id: "rainbow-fart",
				order: 90,
				label: () => "🌈 Rainbow Fart",
			},
			ConfigView,
		),
	);
}
