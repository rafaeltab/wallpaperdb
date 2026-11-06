// Executed inside the current Web container by the maintained worker adapter.
const fs = require("node:fs"),
	crypto = require("node:crypto"),
	os = require("node:os");
const source = process.argv[1];
const files = {
	heading: "/app/apps/web/src/routes/upload.tsx",
	presence: "/app/apps/web/src/boat-547-presence.txt",
};
if (!Object.hasOwn(files, source)) throw Error("Unknown #547 Web source");
const file = files[source];
const observation = {
	source,
	path: file,
	at: new Date().toISOString(),
	epochMilliseconds: Date.now(),
	monotonicSeconds: Number(process.hrtime.bigint()) / 1e9,
	hostname: os.hostname(),
	cwd: process.cwd(),
	pid: process.pid,
};
let fd;
try {
	fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
} catch (error) {
	if (error.code !== "ENOENT") throw error;
	observation.lstat = "ENOENT";
}
if (fd !== undefined) {
	try {
		const stat = fs.fstatSync(fd);
		if (!stat.isFile() || stat.size > 32768)
			throw Error("Unsupported Web source");
		const bytes = fs.readFileSync(fd);
		if (bytes.length !== stat.size)
			throw Error("Web source changed during read");
		Object.assign(observation, {
			regular: true,
			symlink: false,
			bytes: bytes.length,
			byteValues: Array.from(bytes),
			sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
		});
	} finally {
		fs.closeSync(fd);
	}
}
console.log("BOAT547_WEB_SOURCE " + JSON.stringify(observation));
