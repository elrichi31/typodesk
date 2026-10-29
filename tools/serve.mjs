/**
 * Servidor estático mínimo para probar typodesk en local.
 *   node tools/serve.mjs        -> http://localhost:5173
 *   node tools/serve.mjs 8080   -> otro puerto
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const port = Number(process.argv[2]) || 5173;

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith("/")) path += "index.html";

    const file = normalize(join(root, path));
    if (!file.startsWith(root)) {
      res.writeHead(403).end("forbidden");
      return;
    }

    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": types[extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404");
  }
}).listen(port, () => {
  console.log(`typodesk en http://localhost:${port}`);
});
