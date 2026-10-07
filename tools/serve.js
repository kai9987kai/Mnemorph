import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { computeSourceMetadata } from "../src/core/receipt.js";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const ALLOWED_MOUNTS = ["src/ui", "src/core", "src/worker"];
const MIME_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
});

function send(response, status, text, headers = {}, requestMethod = "GET") {
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; worker-src 'self'; connect-src 'self'; img-src 'self' data:",
    ...headers,
  });
  if (requestMethod === "HEAD") response.end();
  else response.end(text);
}

function parsePath(requestUrl) {
  if (typeof requestUrl !== "string" || !requestUrl.startsWith("/")) return { error: "bad_request" };
  const rawPath = requestUrl.split("?", 1)[0];
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return { error: "bad_request" };
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return { error: "bad_request" };
  const segments = decoded.split("/");
  if (segments.some((segment) => segment === "..")) return { error: "forbidden" };
  return { pathname: decoded };
}

function inside(parent, child) {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

async function containedRead(projectRoot, relativePath) {
  const absolute = resolve(projectRoot, relativePath);
  if (!inside(projectRoot, absolute)) return null;
  try {
    const resolvedRoot = await realpath(projectRoot);
    const resolvedFile = await realpath(absolute);
    if (!inside(resolvedRoot, resolvedFile)) return null;
    const content = await readFile(resolvedFile);
    return { content, path: resolvedFile };
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  }
}

async function routeFile(pathname, projectRoot) {
  if (pathname === "/__mnemorph-smoke.json") return containedRead(projectRoot, "configs/benchmark-smoke.json");
  if (pathname === "/__mnemorph-build.json") {
    const metadata = await computeSourceMetadata();
    return { content: Buffer.from(JSON.stringify(metadata)), path: "virtual:build" };
  }
  const mount = ALLOWED_MOUNTS.find((candidate) => pathname === `/${candidate}` || pathname.startsWith(`/${candidate}/`));
  if (!mount) return null;
  let relativePath = pathname.slice(1);
  if (relativePath === mount || relativePath.endsWith("/")) relativePath += "/index.html";
  const extension = extname(relativePath).toLowerCase();
  if (!Object.hasOwn(MIME_TYPES, extension)) return null;
  return containedRead(projectRoot, relativePath);
}

async function handleRequest(request, response, projectRoot) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    send(response, 405, "Method not allowed", { allow: "GET, HEAD" }, request.method);
    return;
  }
  const parsed = parsePath(request.url);
  if (parsed.error === "bad_request") {
    send(response, 400, "Bad request", {}, request.method);
    return;
  }
  if (parsed.error === "forbidden") {
    send(response, 403, "Forbidden", {}, request.method);
    return;
  }
  try {
    const file = await routeFile(parsed.pathname === "/" ? "/src/ui/index.html" : parsed.pathname, projectRoot);
    if (!file) {
      send(response, 404, "Not found", {}, request.method);
      return;
    }
    const mimeType = file.path === "virtual:build" ? MIME_TYPES[".json"] : MIME_TYPES[extname(file.path).toLowerCase()];
    response.writeHead(200, {
      "content-type": mimeType,
      "content-length": file.content.byteLength,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; worker-src 'self'; connect-src 'self'; img-src 'self' data:",
      "referrer-policy": "no-referrer",
    });
    if (request.method === "HEAD") response.end();
    else response.end(file.content);
  } catch {
    send(response, 500, "Local server error", {}, request.method);
  }
}

export function createMnemorphServer({ projectRoot = PROJECT_ROOT } = {}) {
  const root = resolve(projectRoot);
  return createServer((request, response) => {
    void handleRequest(request, response, root);
  });
}

export async function startMnemorphServer({ host = "127.0.0.1", port = 4173, projectRoot = PROJECT_ROOT } = {}) {
  if (host !== "127.0.0.1") throw new TypeError("Mnemorph server may bind only to the loopback address 127.0.0.1");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError("port must be an integer in [0, 65535]");
  const server = createMnemorphServer({ projectRoot });
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolvePromise);
  });
  return server;
}

export function parseServeArgs(args) {
  const options = { host: "127.0.0.1", port: 4173, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument !== "--port" && argument !== "--host") throw new TypeError(`unknown option ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new TypeError(`${argument} requires a value`);
    index += 1;
    if (argument === "--host") options.host = value;
    else {
      if (!/^\d+$/.test(value)) throw new TypeError("--port must be an integer");
      options.port = Number(value);
    }
  }
  return options;
}

async function main() {
  try {
    const options = parseServeArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write("Usage: npm run serve -- [--host 127.0.0.1] [--port 4173]\n");
      return;
    }
    const server = await startMnemorphServer(options);
    const address = server.address();
    process.stdout.write(`Mnemorph local UI: http://127.0.0.1:${address.port}/\n`);
    server.on("error", (error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) void main();
