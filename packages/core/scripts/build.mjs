// Build script for deepseek-rainbow-fart.
//
// Node half : ESM, Harness services and sherpa-onnx-node stay external. The
//             models package specifier is resolved to the bundle's models/
//             directory while esbuild constructs the output.
// Client half: bundled to CJS and wrapped in the harness's
//             `window.__ModuleLoader__.load({ id, factory })` skeleton (the
//             format dsh-client-modules materializes for the web shell).
import { build } from "esbuild";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";

const root = new URL("..", import.meta.url).pathname;
const CLIENT_ID = "deepseek-rainbow-fart";

const NODE_EXTERNAL = [
	"@deepseek-ai/*",
	"sherpa-onnx-node",
];
const CLIENT_EXTERNAL = ["@deepseek-ai/*", "react", "react/jsx-runtime"];
const bundleModelsImport = {
	name: "bundle-models-import",
	setup(build) {
		build.onResolve(
			{ filter: /^@deepseek-rainbow-fart\/models$/ },
			() => ({ path: "../models/index.js", external: true }),
		);
	},
};

async function main() {
	await mkdir(`${root}lib`, { recursive: true });
	await rm(`${root}lib`, { recursive: true, force: true });
	await mkdir(`${root}lib`, { recursive: true });

	// ---- Node half ----
	await build({
		entryPoints: [`${root}src/index.ts`],
		outfile: `${root}lib/index.js`,
		format: "esm",
		platform: "node",
		target: "node22",
		external: NODE_EXTERNAL,
		plugins: [bundleModelsImport],
		bundle: true, // bundle local files but keep externals external
		sourcemap: true,
	});

	// ---- Client half (raw CJS bundle) ----
	await build({
		entryPoints: [`${root}src/client/index.ts`],
		outfile: `${root}lib/client.raw.js`,
		format: "cjs",
		platform: "browser",
		external: CLIENT_EXTERNAL,
		bundle: true,
		jsx: "automatic",
		sourcemap: true,
	});

	// ---- Wrap in the harness module loader skeleton ----
	const raw = await readFile(`${root}lib/client.raw.js`, "utf8");
	const wrapped = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(CLIENT_ID)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${raw}
\t\treturn module.exports;
\t}
});
`;
	await writeFile(`${root}lib/client.js`, wrapped);
	await rm(`${root}lib/client.raw.js`, { force: true });
	await rm(`${root}lib/client.raw.js.map`, { force: true });

	console.log("BUILD_OK: lib/index.js + lib/client.js");
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
