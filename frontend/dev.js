const { spawn } = require("child_process");

async function main() {
  console.log("\x1b[32m[Frontend]\x1b[0m Starting Next.js dev server on port 3036...");
  console.log("\x1b[36m[Backend]\x1b[0m The API on 127.0.0.1:8000 starts with the Next.js server.");

  const nextCmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const frontendProc = spawn(nextCmd, ["next", "dev", "-p", "3036"], {
    cwd: __dirname,
    stdio: "inherit",
    shell: true,
  });

  frontendProc.on("error", (err) => {
    console.error("\x1b[31m[Frontend Error]\x1b[0m", err.message);
  });

  let isCleaningUp = false;
  const cleanup = () => {
    if (isCleaningUp) return;
    isCleaningUp = true;
    console.log("\n\x1b[33m[Dev]\x1b[0m Shutting down...");

    if (frontendProc && !frontendProc.killed && frontendProc.pid) {
      try {
        if (process.platform === "win32") {
          spawn("taskkill", ["/pid", frontendProc.pid.toString(), "/f", "/t"], { stdio: "ignore" });
        } else {
          frontendProc.kill("SIGTERM");
        }
      } catch (e) {}
    }

    setTimeout(() => process.exit(), 500);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  frontendProc.on("exit", cleanup);
}

main().catch(console.error);
