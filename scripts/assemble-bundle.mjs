import { cp, mkdir, readdir, realpath, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const destination = process.argv[2]
	? resolve(process.argv[2])
	: join(repo, ".dsh-bundle");

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await Promise.all([
	cp(join(repo, "packages/core/lib"), join(destination, "lib"), {
		recursive: true,
	}),
	cp(join(repo, "packages/models"), join(destination, "models"), {
		recursive: true,
	}),
	cp(
		join(repo, "packages/bundle/package.json"),
		join(destination, "package.json"),
	),
	cp(
		join(repo, "packages/core/cordis.patch.yml"),
		join(destination, "cordis.patch.yml"),
	),
]);

const sherpaNode = await realpath(
	join(repo, "packages/core/node_modules/sherpa-onnx-node"),
);
const bunStore = dirname(dirname(dirname(sherpaNode)));
const nativeName = `sherpa-onnx-${process.platform}-${process.arch}`;
const nativeEntry = (await readdir(bunStore)).find((name) =>
	name.startsWith(`${nativeName}@`),
);
if (!nativeEntry) {
	throw new Error(`${nativeName} is not installed; run bun install first`);
}
await mkdir(join(destination, "node_modules"), { recursive: true });
await Promise.all([
	cp(sherpaNode, join(destination, "node_modules/sherpa-onnx-node"), {
		recursive: true,
	}),
	cp(
		join(bunStore, nativeEntry, "node_modules", nativeName),
		join(destination, "node_modules", nativeName),
		{ recursive: true },
	),
]);

console.log(`BUNDLE_OK: ${destination}`);
