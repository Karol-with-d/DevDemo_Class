const { spawn } = require("child_process");
const net = require("net");
const path = require("path");
const fs = require("fs");

const PORT = 8000;
const HOST = "127.0.0.1";

function checkPort(port, host = HOST) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

function findProjectRoot() {
  const candidates = [
    path.resolve(__dirname, ".."),
    process.cwd(),
    path.resolve(process.cwd(), ".."),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "main.py"))) return dir;
  }
  return path.resolve(__dirname, "..");
}

function findPython(rootDir) {
  const candidates = [
    path.join(rootDir, "mediaPipeEnv", "Scripts", "python.exe"),
    path.join(rootDir, ".venv", "Scripts", "python.exe"),
    "python",
    "py",
  ];
  for (const candidate of candidates) {
    if (candidate === "python" || candidate === "py" || fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return "python";
}

let startup = null;

function ensureBackend() {
  if (!startup) startup = startBackend();
  return startup;
}

async function startBackend() {
  if (await checkPort(PORT)) {
    console.log(`\x1b[36m[Backend]\x1b[0m Already listening on ${HOST}:${PORT}.`);
    return null;
  }

  const rootDir = findProjectRoot();
  const pythonExe = findPython(rootDir);
  const mainPy = path.join(rootDir, "main.py");
  console.log(`\x1b[36m[Backend]\x1b[0m Starting FastAPI with ${pythonExe}`);

  const child = spawn(pythonExe, [mainPy], {
    cwd: rootDir,
    stdio: "inherit",
    shell: false,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });

  let settled = false;
  let timer = null;
  const ready = new Promise((resolve) => {
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearInterval(timer);
      resolve(value);
    };

    child.once("error", (err) => {
      console.error("\x1b[31m[Backend Error]\x1b[0m", err.message);
      finish(null);
    });

    child.once("exit", (code) => {
      if (!settled) {
        console.warn(`\x1b[33m[Backend]\x1b[0m Exited before it was ready (code ${code}).`);
        finish(null);
      }
    });

    const startedAt = Date.now();
    timer = setInterval(async () => {
      if (await checkPort(PORT)) {
        console.log(`\x1b[32m[Backend]\x1b[0m Ready at http://${HOST}:${PORT}`);
        finish(child);
        return;
      }
      if (Date.now() - startedAt > 90000) {
        console.error("\x1b[31m[Backend]\x1b[0m Timed out waiting for port 8000.");
        finish(child);
      }
    }, 500);
  });

  return ready;
}

module.exports = { ensureBackend, checkPort, PORT, HOST };

if (require.main === module) {
  ensureBackend().then((child) => {
    if (!child) return;
    const keepAlive = setInterval(() => {}, 60000);
    child.on("exit", (code) => {
      clearInterval(keepAlive);
      process.exit(code ?? 0);
    });
  });
}
