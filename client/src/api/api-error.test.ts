import { apiErrorMessage } from './hamlog-api';

describe('apiErrorMessage', () => {
  it('extracts the server-provided error message from an axios error', () => {
    const err = {
      isAxiosError: true,
      response: { data: { error: 'ADIF file has 60000 records, exceeding the import limit of 50000.' } },
    };
    expect(apiErrorMessage(err)).toContain('exceeding the import limit');
  });

  it('returns null when the axios error has no server message', () => {
    expect(apiErrorMessage({ isAxiosError: true, response: { data: {} } })).toBeNull();
    expect(apiErrorMessage({ isAxiosError: true })).toBeNull();
  });

  it('returns null for non-axios errors', () => {
    expect(apiErrorMessage(new Error('network down'))).toBeNull();
    expect(apiErrorMessage(undefined)).toBeNull();
  });

  it('returns null when the server message is not a string', () => {
    expect(apiErrorMessage({ isAxiosError: true, response: { data: { error: { nested: true } } } })).toBeNull();
  });
});
