export function ok(data: unknown = {}): object {
  return { status: 'ok', retcode: 0, data, message: '' };
}

export function failed(retcode: number, message: string): object {
  return { status: 'failed', retcode, data: null, message };
}
