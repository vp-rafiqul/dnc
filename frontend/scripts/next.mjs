import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

process.chdir(fileURLToPath(new URL("../", import.meta.url)))
if (existsSync(".env")) process.loadEnvFile(".env")

const command = process.argv[2]
const { HOST, PORT, API_ENDPOINT } = process.env
if (!["dev", "build", "start"].includes(command)) throw new Error("Expected dev, build, or start")
if (!HOST || !API_ENDPOINT || !/^\d+$/.test(PORT || "") || Number(PORT) < 1 || Number(PORT) > 65535) {
  throw new Error("Set HOST, a valid PORT, and API_ENDPOINT in frontend/.env")
}

const cli = createRequire(import.meta.url).resolve("next/dist/bin/next")
const options = command === "build" ? [] : ["--hostname", HOST, "--port", PORT]
const child = spawn(process.execPath, [cli, command, ...options], { stdio: "inherit" })
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1) })
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => { if (!child.killed) child.kill(signal) })
}
