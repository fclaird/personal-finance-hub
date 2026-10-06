import fs from "node:fs";
import http from "node:http";
import https from "node:https";

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

function safeHandler(onRequest) {
  return (req, res) => {
    Promise.resolve(onRequest(req, res)).catch((err) => {
      console.error(err);
      if (!res.headersSent) res.statusCode = 500;
      res.end("Internal Server Error");
    });
  };
}

export function listenTls({ keyPath, certPath, host, port, onRequest }) {
  const server = https.createServer(
    {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    },
    safeHandler(onRequest),
  );
  return listen(server, port, host);
}

export function listenLoopbackHttp({ port, onRequest }) {
  const server = http.createServer(safeHandler(onRequest));
  return listen(server, port, "127.0.0.1");
}
