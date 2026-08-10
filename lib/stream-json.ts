/**
 * Pull complete objects out of a JSON document that is still being written.
 *
 * The diff prompt asks for `{"claims":[{...},{...}]}`, and the model emits it a
 * few characters at a time. Waiting for the closing brace means waiting for the
 * whole answer — which on a preview is one call and the entire minute. Every
 * element of that array is independently useful the moment its own brace closes,
 * so this scans the buffer for balanced top-level objects inside the first array
 * it finds and hands each one over as soon as it is whole.
 *
 * Brace counting is only correct if strings are skipped, since a claim's own
 * text routinely contains braces and quotes — Arabic and Hebrew spans arrive as
 * `\uXXXX` escapes, so an escaped quote inside a span is the common case rather
 * than the exotic one. The scanner therefore tracks string state and honours the
 * backslash, and nothing else about JSON: it never validates, it only finds
 * boundaries and lets `JSON.parse` be the judge of what is between them.
 *
 * A trailing partial object stays in the buffer until it closes. If the stream
 * ends mid-object — the model hit max_tokens — that fragment is simply never
 * emitted, which is the same outcome the old whole-response parse had, minus the
 * claims that did complete before the cut.
 */
export class ClaimStream {
  private buffer = "";
  /** Where the next scan starts: everything before this is emitted or skipped. */
  private cursor = 0;
  /** False until the opening bracket of the claims array has been passed. */
  private entered = false;

  /**
   * Add a chunk of text and return whatever objects completed because of it.
   * Malformed objects are dropped rather than thrown: a single bad element must
   * not poison the elements after it.
   */
  push(chunk: string): unknown[] {
    this.buffer += chunk;
    const done: unknown[] = [];

    if (!this.entered) {
      const open = this.buffer.indexOf("[", this.cursor);
      if (open === -1) return done;
      this.cursor = open + 1;
      this.entered = true;
    }

    for (;;) {
      const start = this.buffer.indexOf("{", this.cursor);
      if (start === -1) return done;

      const end = this.endOfObject(start);
      if (end === -1) return done; // still being written

      try {
        done.push(JSON.parse(this.buffer.slice(start, end + 1)));
      } catch {
        // Not an object we can use. Skip past it and keep going.
      }
      this.cursor = end + 1;
    }
  }

  /** Index of the brace closing the object that opens at `start`, or -1 if the
   *  buffer does not yet contain it. */
  private endOfObject(start: number): number {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < this.buffer.length; i++) {
      const ch = this.buffer[i];

      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        // Only meaningful inside a string, and outside one it cannot appear in
        // valid JSON anyway, so treating it as an escape everywhere is safe.
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) return i;
    }
    return -1;
  }
}
