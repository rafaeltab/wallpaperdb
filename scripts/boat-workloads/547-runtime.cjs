// Fixed worker observations for the #547 replay. Ordinary Make owns transport.
function metadata() {
	const fs = require("node:fs"),
		path = require("node:path"),
		os = require("node:os"),
		crypto = require("node:crypto"),
		{ createRequire } = require("node:module");
	const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
	const root = process.cwd(),
		web = createRequire(path.join(root, "apps/web/package.json")),
		pwPath = web.resolve("playwright/package.json"),
		pwPkg = JSON.parse(fs.readFileSync(pwPath)),
		pw = web("playwright"),
		pwReq = createRequire(pwPath),
		corePath = pwReq.resolve("playwright-core/package.json"),
		browsersPath = path.join(path.dirname(corePath), "browsers.json"),
		browserBytes = fs.readFileSync(browsersPath),
		browsers = JSON.parse(browserBytes).browsers.filter((x) =>
			["chromium", "chromium-headless-shell"].includes(x.name),
		);
	if (
		pwPkg.version !== "1.59.1" ||
		browsers.length !== 2 ||
		browsers.some(
			(x) => x.revision !== "1217" || x.browserVersion !== "147.0.7727.15",
		)
	)
		throw Error("Playwright metadata mismatch");
	const asset = createRequire(path.join(root, "apps/asset/package.json")),
		natsPath = asset.resolve("nats/package.json"),
		natsRoot = path.dirname(natsPath);
	asset("nats");
	const protocol = path.join(natsRoot, "lib/nats-base-client/protocol.js"),
		transport = path.join(natsRoot, "lib/src/node_transport.js");
	const fp = {
		resolved: natsPath,
		patchSha256: sha(fs.readFileSync("patches/nats-2.29.3.patch")),
		protocolPath: protocol,
		protocolSha256: sha(fs.readFileSync(protocol)),
		transportPath: transport,
		transportSha256: sha(fs.readFileSync(transport)),
	};
	if (
		fp.protocolSha256 !==
			"5131b57e27718183bf5b34f5abceafdb47f7d62976e0a27a99e88b464edc3b7e" ||
		fp.transportSha256 !==
			"05598cade2b5722f0d623dffac040b92e81b349982872a565bdf4dfc052bb6da" ||
		fp.patchSha256 !==
			"6991af2bfc41fcaa937a824a006f1037640a92cc2767e53276acf52b624590fe"
	)
		throw Error("Installed SDK mismatch");
	const yamlEntry = fs
			.readdirSync("node_modules/.pnpm")
			.find((n) => n.startsWith("yaml@2.9.1")),
		YAML = require(
			path.resolve("node_modules/.pnpm", yamlEntry, "node_modules/yaml"),
		);
	const lockProof = (p) => {
		const b = fs.readFileSync(p),
			d = YAML.parse(b.toString("utf8"));
		return {
			path: p,
			sha256: sha(b),
			natsPatch: d.patchedDependencies["nats@2.29.3"],
			natsConsumers: Object.entries(d.importers).flatMap(([n, v]) =>
				Object.entries(v).flatMap(([g, x]) =>
					x?.nats ? [{ workspace: n, group: g, ...x.nats }] : [],
				),
			),
		};
	};
	const rootLock = lockProof("pnpm-lock.yaml"),
		installedLock = lockProof("node_modules/.pnpm/lock.yaml");
	if (
		JSON.stringify(rootLock.natsConsumers) !==
			JSON.stringify(installedLock.natsConsumers) ||
		rootLock.natsPatch.hash !== fp.patchSha256 ||
		installedLock.natsPatch.hash !== fp.patchSha256
	)
		throw Error("Installed lock resolution mismatch");
	const result = {
		osRelease: fs.readFileSync("/etc/os-release", "utf8"),
		platform: os.platform(),
		arch: os.arch(),
		kernel: os.release(),
		user: os.userInfo().username,
		home: os.homedir(),
		node: process.version,
		cwd: root,
		playwrightBrowsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH,
		playwrightPath: pwPath,
		playwrightVersion: pwPkg.version,
		browsersJsonPath: browsersPath,
		browsersJsonSha256: sha(browserBytes),
		browsers,
		chromiumExecutable: pw.chromium.executablePath(),
		sdk: fp,
		rootLock,
		installedLock,
	};
	console.log("BOAT547_WORKER_METADATA " + JSON.stringify(result));
}
function chromium() {
	const fs = require("node:fs"),
		path = require("node:path"),
		os = require("node:os"),
		{ createRequire } = require("node:module");
	const web = createRequire(path.join(process.cwd(), "apps/web/package.json")),
		pkgPath = web.resolve("playwright/package.json"),
		pkg = JSON.parse(fs.readFileSync(pkgPath)),
		{ chromium } = web("playwright");
	if (pkg.version !== "1.59.1") throw Error("Playwright mismatch");
	const executable = chromium.executablePath();
	if (!fs.statSync(executable).isFile()) throw Error("Browser is not regular");
	fs.accessSync(executable, fs.constants.X_OK);
	(async () => {
		const browser = await chromium.launch({ headless: true, timeout: 30000 });
		const version = browser.version();
		await browser.close();
		if (version !== "147.0.7727.15")
			throw Error("Chromium runtime version mismatch");
		console.log(
			"BOAT547_CHROMIUM_LAUNCH " +
				JSON.stringify({
					playwrightPath: pkgPath,
					playwrightVersion: pkg.version,
					executable,
					regular: true,
					executableAccess: true,
					headless: true,
					browserVersion: version,
					closed: true,
					user: os.userInfo().username,
					home: os.homedir(),
					playwrightBrowsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH,
				}),
		);
	})().catch((e) => {
		console.error(e);
		process.exitCode = 1;
	});
}

function application(mode) {
	const { execFileSync } = require("node:child_process");
	const args =
		mode === "application-ps"
			? [
					"compose",
					"-p",
					process.argv[3],
					"-f",
					"infra/docker-compose.apps.yml",
					"ps",
					"--all",
					"--format",
					"json",
				]
			: [
					"inspect",
					"--format",
					'{"id":{{json .Id}},"image":{{json .Image}},"state":{{json .State}},"restartCount":{{json .RestartCount}},"created":{{json .Created}},"labels":{{json .Config.Labels}},"ports":{{json .NetworkSettings.Ports}}}',
					...process.argv.slice(3),
				];
	const values = process.argv.slice(3);
	if (
		mode === "application-ps"
			? values.length !== 1 || !/^[A-Za-z0-9_-]+$/.test(values[0])
			: values.length !== 10 ||
				values.some((id) => !/^[a-f0-9]{12,64}$/.test(id))
	)
		throw new Error("Invalid application observation arguments");
	const bytes = execFileSync("docker", args, { maxBuffer: 16 * 1024 * 1024 });
	console.log(
		"BOAT547_APPLICATION " +
			JSON.stringify({ mode, nativeStdout: bytes.toString("base64") }),
	);
}

if (process.argv[2] === "metadata") metadata();
else if (process.argv[2] === "chromium") chromium();
else if (["application-ps", "application-inspect"].includes(process.argv[2]))
	application(process.argv[2]);
else throw new Error("Unknown #547 worker observation");
