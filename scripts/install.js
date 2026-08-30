// DeepSeek Rainbow Fart offline bundle installer.
// Unzip the release folder yourself (any method), then run:
//   node install.js [~/.dsh]
// Uninstall:
//   node install.js --uninstall [~/.dsh]
const { cpSync, existsSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { homedir } = require("node:os");
const { join, resolve } = require("node:path");

const BUNDLE = resolve(process.env.DSH_BUNDLE || join(__dirname, "bundle"));
const PACKAGE_NAME = "deepseek-rainbow-fart";

function readProfileManifest(profile) {
	const manifestPath = join(profile, "package.json");
	if (!existsSync(manifestPath)) return undefined;
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	} catch (error) {
		throw new Error(`Invalid profile manifest at ${manifestPath}`, { cause: error });
	}
	return Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest : undefined;
}

function resolveProfile(input) {
	const target = resolve(input ?? process.env.DSH_HOME ?? join(homedir(), ".dsh"));
	if (readProfileManifest(target)) return target;

	const profile = join(target, "profiles", "web");
	if (!readProfileManifest(profile)) {
		throw new Error(
			`DeepSeek Harness web profile not found at ${profile}. Start dsh once with \`npx @deepseek-ai/dsh web\`, then run this installer again.`,
		);
	}
	return profile;
}

function writeManifest(profile, manifest) {
	writeFileSync(join(profile, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function install(target) {
	const profile = resolveProfile(target);
	if (!existsSync(join(BUNDLE, "package.json"))) {
		throw new Error(`Offline bundle not found at ${BUNDLE}`);
	}

	const destination = join(profile, "node_modules", PACKAGE_NAME);
	rmSync(destination, { recursive: true, force: true });
	cpSync(BUNDLE, destination, { recursive: true });

	const manifest = readProfileManifest(profile);
	if (!manifest.dsh.profile.bundles.includes(PACKAGE_NAME)) {
		manifest.dsh.profile.bundles.push(PACKAGE_NAME);
		writeManifest(profile, manifest);
	}
	console.log(`Installed into ${profile}`);
}

function uninstall(target) {
	const profile = resolveProfile(target);
	const manifest = readProfileManifest(profile);
	const bundles = manifest.dsh.profile.bundles.filter(
		(packageName) => packageName !== PACKAGE_NAME,
	);
	if (bundles.length !== manifest.dsh.profile.bundles.length) {
		manifest.dsh.profile.bundles = bundles;
		writeManifest(profile, manifest);
	}
	rmSync(join(profile, "node_modules", PACKAGE_NAME), {
		recursive: true,
		force: true,
	});
	console.log(`Uninstalled from ${profile}`);
}

try {
	const [a, b] = process.argv.slice(2);
	if (a === "--uninstall") {
		uninstall(b);
	} else {
		install(a);
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
