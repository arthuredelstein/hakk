const http = require('node:http');
const { WebSocket, WebSocketServer } = require('ws');
const { promisify } = require('node:util');
const execAsync = promisify(require('node:child_process').exec);
const fs = require('node:fs/promises')
const path = require('node:path');

const HTTP_PORT = 8000;
const WEBSOCKET_PORT = 8001;

const scriptToInject = `
  <script>
    var module = {};
  </script>
  <script src="${path.join(__dirname, "evaluator.js")}"></script>
  <script>
    const evalFunction = module.exports.scopedEvaluator();
    const socket = new WebSocket("ws://localhost:${WEBSOCKET_PORT}/ws-hakk");
    socket.addEventListener("message", e => {
      const data = JSON.parse(e.data);
      console.log(data);
      if (data.command === "eval") {
        const { code } = data;
        const result = evalFunction({code});
        socket.send(JSON.stringify({result}));
      }
    });
  </script>
`;

const wss = new WebSocketServer({
  port: WEBSOCKET_PORT
});

export const broadcastMessage = (message) => {
  wss.clients.forEach(client => {
    if (client.readyState = WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  })
}

const handleData = (data) => {
  console.log(`received ${data}`);
};

wss.on('connection', (ws) => {
  ws.on('error', console.error);
  ws.on('message', (data) => handleData(data));
});

var lastRequest;

const respond = async (req, res) => {
  console.log(req.url, req.rawHeaders);
  lastRequest = req;
  const pathname = req.url;
  let contentType = "";
  if (pathname.endsWith("html") || pathname.endsWith("htm")) {
    contentType = "text/html";
  } else if (pathname.endsWith("js") || pathname.endsWith("jsm")) {
    contentType = 'application/js';
  } else if (pathname.endsWith("json")) {
    contentType = 'application/json';
  }
  try {
    let fileContents = await fs.readFile(pathname);
    if (contentType === 'text/html') {
      fileContents = scriptToInject + fileContents;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(fileContents);
  } catch (e) {
    res.writeHead(404);
    res.end("");
  }
};

const server = http.createServer((...args) => respond(...args));

server.listen(HTTP_PORT);

const openUrlInBrowser = url => execAsync(`open '${url}'`);

const openLocalfileInBrowser = file =>
  openUrlInBrowser(`http://localhost:${HTTP_PORT}${path.resolve(file)}`);

attachHtml = async (file) => {
  await openLocalfileInBrowser(file);
  return ({code}) => broadcastMessage({command:"eval", code});
}