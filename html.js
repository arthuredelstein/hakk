const http = require('node:http');
const { WebSocket, WebSocketServer } = require('ws');
const { promisify } = require('node:util');
const execAsync = promisify(require('node:child_process').exec);
const fs = require('node:fs/promises');
const path = require('node:path');

const HTTP_PORT = 8000;
const WEBSOCKET_PORT = 8001;

const openUrlInBrowser = url => execAsync(`open '${url}'`);

const openLocalfileInBrowser = file =>
  openUrlInBrowser(`http://localhost:${HTTP_PORT}${path.resolve(file)}`);

const scriptToInject = `
  <script>
    var module = {};
  </script>
  <script src="${path.join(__dirname, 'evaluator.js')}"></script>
  <script>
    const evalFunction = module.exports.scopedEvaluator();
    const socket = new WebSocket("ws://localhost:${WEBSOCKET_PORT}/ws-hakk");
    socket.addEventListener("message", e => {
      const data = JSON.parse(e.data);
      if (data.command === "eval") {
        const { code, id } = data;
        try {
          const result = evalFunction({code});
          console.log({data, result})
          socket.send(JSON.stringify({id, result}));
        } catch (e) {
          console.log({data, e})
          socket.send(JSON.stringify({id, error: e.toString()}));
        }
      }
    });
  </script>
`;

const respond = async (req, res) => {
  console.log(req.url, req.rawHeaders);
  const pathname = req.url;
  let contentType = '';
  if (pathname.endsWith('html') || pathname.endsWith('htm')) {
    contentType = 'text/html';
  } else if (pathname.endsWith('js') || pathname.endsWith('jsm')) {
    contentType = 'application/js';
  } else if (pathname.endsWith('json')) {
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
    res.end('');
  }
};

const webEvaluator = () => {
  const server = http.createServer((...args) => respond(...args));
  server.listen(HTTP_PORT);

  console.log('about to create new WebSocketServer');
  const wss = new WebSocketServer({
    port: WEBSOCKET_PORT
  });

  const broadcastMessage = (message) => {
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  };

  const pendingResults = new Map();

  const handleData = (data) => {
    const message = JSON.parse(data);
    const pending = pendingResults.get(message.id);
    if (!pending) {
      return;
    }
    pendingResults.delete(message.id);
    if (message.error) {
      pending.reject(message.error);
    } else {
      pending.resolve(message.result);
    }
  };

  wss.on('connection', (ws) => {
    ws.on('error', console.error);
    ws.on('message', (data) => handleData(data));
  });

  let counter = 0;

  const evaluate = async ({ code, sourceURL }) => {
    ++counter;
    const id = counter.toString();
    const receiveMessagePromise = new Promise((resolve, reject) => {
      pendingResults.set(id, { resolve, reject });
    });
    broadcastMessage({ command: 'eval', code, sourceURL, id });
    return receiveMessagePromise;
  };

  return evaluate;
};

module.exports = { openLocalfileInBrowser, webEvaluator };
