/**
 * Runs `worker` over `items` with at most `concurrency` calls in flight (REQ-DET-06).
 * Results keep the input order; `onDone` fires as each item completes, in completion order.
 * If a worker throws, no new items start and the first error is rethrown once in-flight work settles.
 */
export async function runPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onDone?: (result: R, index: number) => void,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError("concurrency must be an integer >= 1");
  const results = new Array<R>(items.length);
  let next = 0;
  let failure: { error: unknown } | null = null;

  const run = async () => {
    while (failure === null && next < items.length) {
      const index = next++;
      try {
        const result = await worker(items[index]!, index);
        results[index] = result;
        onDone?.(result, index);
      } catch (error) {
        failure ??= { error };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  if (failure !== null) throw (failure as { error: unknown }).error;
  return results;
}
