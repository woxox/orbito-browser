/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * How the OpenAI-compatible and ChatGPT backends run the tool calls of one
 * model response.
 */

/** The most calls that run at once. */
export const MAX_CONCURRENT_CALLS = 6;

/**
 * Runs one response's calls: those before the first call that may not run
 * concurrently start together, at most MAX_CONCURRENT_CALLS at once and the
 * next as one ends; from that call on, one at a time. Calls start in their
 * order, so the core counts them against the ToolLimits, and asks to approve
 * them, in that order. If a call throws, the rest of its batch still runs,
 * then the first error is thrown and no later call starts.
 *
 * @param {object[]} calls
 * @param {function(object): boolean} concurrent Whether a call's tool may run
 *   alongside others.
 * @param {function(object): Promise} run Runs a call.
 * @returns {Promise<Array>} What run resolved to, in the calls' order.
 */
export async function runToolCalls(calls, concurrent, run) {
  let results = new Array(calls.length);
  // The first call that runs one at a time, ending the batch.
  let batchEnd = calls.findIndex(call => !concurrent(call));
  if (batchEnd == -1) {
    batchEnd = calls.length;
  }
  let next = 0;
  let failure = null;
  let worker = async () => {
    while (next < batchEnd) {
      let i = next++;
      try {
        results[i] = await run(calls[i]);
      } catch (e) {
        failure ??= { error: e };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(batchEnd, MAX_CONCURRENT_CALLS) }, worker)
  );
  if (failure) {
    throw failure.error;
  }
  for (let i = batchEnd; i < calls.length; i++) {
    results[i] = await run(calls[i]);
  }
  return results;
}
