import { createLineSplitter, LineTooLongError } from '../ndjson';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('createLineSplitter', () => {
  it('returns each complete line and holds the rest', () => {
    const split = createLineSplitter(1024);
    expect(split.push(bytes('{"a":1}\n{"b"'))).toEqual(['{"a":1}']);
    expect(split.holding).toBe(true);
    expect(split.push(bytes(':2}\n'))).toEqual(['{"b":2}']);
    expect(split.holding).toBe(false);
  });

  it('returns several lines from one chunk, in order', () => {
    const split = createLineSplitter(1024);
    expect(split.push(bytes('one\ntwo\nthree\n'))).toEqual(['one', 'two', 'three']);
  });

  it('skips empty lines and the carriage return of a CRLF', () => {
    const split = createLineSplitter(1024);
    expect(split.push(bytes('one\r\n\n\r\ntwo\n'))).toEqual(['one', 'two']);
  });

  it('keeps a letter whole when the network splits it between chunks', () => {
    const line = bytes('{"text":"Żółć ąę"}\n');
    // Cut inside every two-byte letter in turn.
    for (let cut = 1; cut < line.length; cut += 1) {
      const split = createLineSplitter(1024);
      const out = [...split.push(line.slice(0, cut)), ...split.push(line.slice(cut))];
      expect(out).toEqual(['{"text":"Żółć ąę"}']);
    }
  });

  it('copes with one byte at a time', () => {
    const split = createLineSplitter(1024);
    const out: string[] = [];
    for (const byte of bytes('zażółć\ngęślą\n')) out.push(...split.push(Uint8Array.of(byte)));
    expect(out).toEqual(['zażółć', 'gęślą']);
  });

  it('does not count trailing whitespace without a newline as an unfinished line', () => {
    const split = createLineSplitter(1024);
    split.push(bytes('done\n  \r'));
    expect(split.holding).toBe(false);
  });

  it('refuses to hold a line longer than allowed', () => {
    const split = createLineSplitter(10);
    expect(() => split.push(bytes('x'.repeat(11)))).toThrow(LineTooLongError);
    // A long line that does end is not a problem for the next one, only for the buffer.
    expect(() => createLineSplitter(10).push(bytes('x'.repeat(10)))).not.toThrow();
  });
});
