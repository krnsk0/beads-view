import { describe, expect, it } from 'bun:test';
import { parseBdList } from '../bd';

describe('parseBdList', () => {
  it('accepts a bare JSON array', () => {
    expect(parseBdList('[{"id":"a","status":"open"}]')).toEqual([{ id: 'a', status: 'open' }]);
  });

  it('accepts the v2 envelope', () => {
    const out = parseBdList('{"schema_version":1,"data":[{"id":"a","status":"open"}]}');
    expect(out).toEqual([{ id: 'a', status: 'open' }]);
  });

  it('accepts the legacy issues wrapper', () => {
    expect(parseBdList('{"issues":[{"id":"a","status":"open"}]}')).toEqual([
      { id: 'a', status: 'open' },
    ]);
  });

  it('rejects unknown shapes', () => {
    expect(() => parseBdList('{"nope":true}')).toThrow('unrecognized');
  });
});
