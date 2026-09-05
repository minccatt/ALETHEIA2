"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
// 프로젝트 루트를 통째로 공개하지 않고 실제 웹 자산만 제공합니다.
const PUBLIC_FILES = new Map([["/", "index.html"], ["/index.html", "index.html"], ["/styles.css", "styles.css"], ["/app.js", "app.js"]]);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
function createServer() {
  return http.createServer((request, response) => {
    const send = (status, type, body) => { response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'none'" }); response.end(request.method === "HEAD" ? undefined : body); };
    if (!["GET", "HEAD"].includes(request.method)) { send(405, "text/plain", "Method Not Allowed"); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname); }
    catch { send(400, "text/plain", "Bad Request"); return; }
    const file = PUBLIC_FILES.get(pathname);
    if (!file) { send(404, "text/plain", "Not Found"); return; }
    fs.readFile(path.join(__dirname, file), (error, content) => {
      if (error) send(500, "text/plain", "Internal Server Error");
      else send(200, TYPES[path.extname(file)], content);
    });
  });
}
if (require.main === module) { const port = Number(process.env.PORT) || 3000; createServer().listen(port, "0.0.0.0", () => console.log(`ALETHEIA: http://localhost:${port}`)); }
module.exports = { createServer };
