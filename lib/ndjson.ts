/**
 * Read a newline-delimited JSON body, calling `onEvent` for each complete line.
 *
 * A chunk from the network is not a line: it can carry half of one, several, or
 * a line split through the middle of a multi-byte character. The decoder is
 * built with `{ stream: true }` for exactly that last case — Hebrew and Arabic
 * spans are three bytes a character and a claim will land across a chunk
 * boundary sooner rather than later.
 *
 * A line that does not parse is skipped rather than thrown. The last line of a
 * comparison carries the whole result, so surviving a garbled progress line and
 * still delivering the answer is worth more than strictness.
 */
export async function readNdjson<T>(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: T) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const flush = (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let parsed: T;
      try {
        parsed = JSON.parse(line) as T;
      } catch {
        continue;
      }
      onEvent(parsed);
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      flush(decoder.decode(value, { stream: true }));
    }
    // A final line with no trailing newline, plus whatever the decoder held back.
    flush(decoder.decode());
    const rest = buffer.trim();
    if (rest) {
      try {
        onEvent(JSON.parse(rest) as T);
      } catch {
        // Truncated tail; the caller's missing-result check reports it.
      }
    }
  } finally {
    reader.releaseLock();
  }
}
