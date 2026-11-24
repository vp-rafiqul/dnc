import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

process.chdir(fileURLToPath(new URL("../", import.meta.url)))
if (existsSync(".env")) process.loadEnvFile(".env")

const command = process.argv[2]
const { HOST, PORT, API_ENDPOINT } = process.env
if (command !== "dev" && command !== "build" && command !== "start" && command !== "typegen") {
  throw new Error("Expected dev, build, start, or typegen")
}
if (!HOST || !API_ENDPOINT || !PORT || !/^\d+$/.test(PORT) || Number(PORT) < 1 || Number(PORT) > 65535) {
  throw new Error("Set HOST, a valid PORT, and API_ENDPOINT in frontend/.env")
}

const cli = createRequire(import.meta.url).resolve("next/dist/bin/next")
const options = command === "dev" || command === "start" ? ["--hostname", HOST, "--port", PORT] : []
const child = spawn(process.execPath, [cli, command, ...options], { stdio: "inherit" })
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1) })
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { if (!child.killed) child.kill(signal) })
}
