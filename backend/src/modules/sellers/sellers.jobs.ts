import type { sellersRepository } from "./sellers.repository.ts"

const intervalMs = 5 * 60_000

// Delivers due renewal and review notices and expires entitlements at their verified end date.
// Coverage reads also compare valid_until with the current time, so access never outlives the end date between runs.
export function startSellerJobs(repository: ReturnType<typeof sellersRepository>) {
  let running = false
  async function run() {
    if (running) return
    running = true
    try {
      const result = await repository.runMaintenance()
      if (Object.values(result).some(Boolean)) console.log("Seller maintenance", result)
    } catch (error) {
      console.error("Seller maintenance failed", { name: error instanceof Error ? error.name : undefined })
    } finally {
      running = false
    }
  }
  void run()
  const timer = setInterval(run, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}
