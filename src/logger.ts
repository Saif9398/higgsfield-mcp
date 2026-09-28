import pino from 'pino';

export function createRedactor(secrets: string[]) {
  const values = secrets.filter(Boolean).flatMap(s => [s, encodeURIComponent(s)]);
  function redact(value: unknown): unknown {
    if (typeof value === 'string') {
      let result = value.replace(/\b(?:Key|Bearer)\s+[^\s"\\]+/gi, '[REDACTED]');
      for (const secret of values) result = result.split(secret).join('[REDACTED]');
      return result;
    }
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [
        k, /credential|secret|authorization|cookie|password|api.?key|token/i.test(k) ? '[REDACTED]' : redact(v),
      ]));
    }
    return value;
  }
  return redact;
}

export function createLogger(secrets: string[], level = 'info') {
  const redact = createRedactor(secrets);
  return pino({ level, base: undefined, hooks: {
    logMethod(args, method) {
      // Only small, allowlisted operational objects are logged by the application.
      const clean = args.map(a => redact(a));
      method.apply(this, clean as Parameters<typeof method>);
    },
  } });
}
