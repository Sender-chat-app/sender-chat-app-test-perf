/**
 * Map `items` with at most `concurrency` in-flight async workers.
 * Results keep input order.
 */
export async function mapPool(items, concurrency, mapper) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("concurrency must be an integer >= 1")
  }
  const list = [...items]
  if (list.length === 0) return []

  const results = new Array(list.length)
  let next = 0

  async function worker() {
    for (;;) {
      const index = next++
      if (index >= list.length) return
      results[index] = await mapper(list[index], index)
    }
  }

  const workers = Math.min(concurrency, list.length)
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return results
}
