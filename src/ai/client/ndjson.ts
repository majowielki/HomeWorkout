const NEWLINE = 0x0a;

export class LineTooLongError extends Error {}

/**
 * Splits a byte stream into lines, for newline-delimited JSON.
 *
 * It cuts on the newline *byte* and decodes each complete line on its own.
 * `0x0A` never occurs inside a multi-byte UTF-8 sequence, so a Polish letter
 * split between two network chunks is simply held until its line is whole.
 * The usual alternative, a streaming `TextDecoder`, depends on a runtime
 * that implements the `stream` option; this depends on nothing.
 *
 * A line longer than `maxLineBytes` is not buffered further: a server that
 * never sends a newline must not be able to fill the phone's memory.
 */
export function createLineSplitter(maxLineBytes: number) {
  const decoder = new TextDecoder('utf-8');
  let pending = new Uint8Array(0);

  return {
    /** The complete, non-empty lines the chunk finished. */
    push(chunk: Uint8Array): string[] {
      const merged = new Uint8Array(pending.length + chunk.length);
      merged.set(pending);
      merged.set(chunk, pending.length);

      const lines: string[] = [];
      let start = 0;
      for (let i = 0; i < merged.length; i += 1) {
        if (merged[i] !== NEWLINE) continue;
        const line = decoder.decode(merged.subarray(start, i)).trim();
        if (line !== '') lines.push(line);
        start = i + 1;
      }

      pending = merged.slice(start);
      if (pending.length > maxLineBytes) throw new LineTooLongError();
      return lines;
    },

    /** Whether bytes of an unfinished line are being held. A clean end of stream has none. */
    get holding(): boolean {
      return pending.some((byte) => byte !== 0x20 && byte !== 0x0d);
    },
  };
}
