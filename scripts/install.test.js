const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const installer = join(__dirname, "install.js");

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "rainbow-fart-install-"));
	const profile = join(root, "profiles", "web");
	const bundle = join(root, "bundle");
	mkdirSync(profile, { recursive: true });
	mkdirSync(bundle, { recursive: true });
	writeFileSync(
		join(profile, "package.json"),
		JSON.stringify({
			name: "dsh-profile-web",
			dependencies: { "another-plugin": "1.0.0" },
			dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "another-plugin"] } },
		}),
	);
	writeFileSync(
		join(bundle, "package.json"),
		JSON.stringify({ name: "deepseek-rainbow-fart", version: "0.1.0" }),
	);
	writeFileSync(join(bundle, "index.js"), "module.exports = {};\n");
	return { root, profile, bundle };
}

function run(args, bundle) {
	return spawnSync(process.execPath, [installer, ...args], {
		env: { PATH: "", DSH_BUNDLE: bundle },
		encoding: "utf8",
	});
}

function manifest(profile) {
	return JSON.parse(readFileSync(join(profile, "package.json"), "utf8"));
}

test("installs and registers the offline bundle without external commands", () => {
	const { root, profile, bundle } = fixture();
	const result = run([root], bundle);

	assert.equal(result.status, 0, result.stderr);
	assert.equal(
		JSON.parse(readFileSync(join(profile, "node_modules/deepseek-rainbow-fart/package.json"), "utf8")).name,
		"deepseek-rainbow-fart",
	);
	assert.deepEqual(manifest(profile).dsh.profile.bundles, [
		"@deepseek-ai/dsh-base",
		"another-plugin",
		"deepseek-rainbow-fart",
	]);
	assert.deepEqual(manifest(profile).dependencies, { "another-plugin": "1.0.0" });
});

test("reinstall stays idempotent", () => {
	const { root, profile, bundle } = fixture();
	assert.equal(run([root], bundle).status, 0);
	assert.equal(run([root], bundle).status, 0);
	assert.equal(
		manifest(profile).dsh.profile.bundles.filter((name) => name === "deepseek-rainbow-fart").length,
		1,
	);
});

test("uninstall removes only this bundle", () => {
	const { root, profile, bundle } = fixture();
	assert.equal(run([root], bundle).status, 0);
	const result = run(["--uninstall", root], bundle);

	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(manifest(profile).dsh.profile.bundles, [
		"@deepseek-ai/dsh-base",
		"another-plugin",
	]);
	assert.deepEqual(manifest(profile).dependencies, { "another-plugin": "1.0.0" });
	assert.throws(() => readFileSync(join(profile, "node_modules/deepseek-rainbow-fart/package.json")));
});

test("uninstall is idempotent", () => {
	const { root, profile, bundle } = fixture();
	const result = run(["--uninstall", root], bundle);

	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(manifest(profile).dsh.profile.bundles, [
		"@deepseek-ai/dsh-base",
		"another-plugin",
	]);
});

test("a missing offline bundle leaves the profile unchanged", () => {
	const { root, profile } = fixture();
	const before = readFileSync(join(profile, "package.json"), "utf8");
	const result = run([root], join(root, "missing"));

	assert.equal(result.status, 1);
	assert.match(result.stderr, /Offline bundle not found/);
	assert.equal(readFileSync(join(profile, "package.json"), "utf8"), before);
});
