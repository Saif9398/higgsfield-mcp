export type ErrorCode = 'INVALID_CREDENTIALS' | 'INSUFFICIENT_BALANCE' | 'UNSUPPORTED_MODEL' |
  'INVALID_PROMPT' | 'INVALID_INPUT' | 'GENERATION_FAILED' | 'CONTENT_REJECTED' |
  'GENERATION_CANCELED' | 'TIMEOUT' | 'RATE_LIMITED' | 'NOT_FOUND' |
  'UPSTREAM_UNAVAILABLE' | 'INVALID_RESPONSE' | 'INTERNAL_ERROR';

const messages: Record<ErrorCode, string> = {
  INVALID_CREDENTIALS: 'Set HF_CREDENTIALS to the full KEY_ID:KEY_SECRET credential documented by Higgsfield. Do not include the Key prefix. Standalone opaque keys are not verified by the current official documentation.',
  INSUFFICIENT_BALANCE: 'Higgsfield reports insufficient balance. Fund the API account.',
  UNSUPPORTED_MODEL: 'Model is unsupported or unavailable to this account. Use hf_list_models.',
  INVALID_PROMPT: 'Provide a non-empty prompt accepted by the model.',
  INVALID_INPUT: 'The input does not match the model schema or was rejected by Higgsfield.',
  GENERATION_FAILED: 'Generation failed. Check the request in the Higgsfield console.',
  CONTENT_REJECTED: 'Higgsfield rejected the generation through content moderation.',
  GENERATION_CANCELED: 'This generation was canceled.',
  TIMEOUT: 'The time limit was reached. Check an existing request ID later. Do not blindly repeat a generation submission: it may have been accepted.',
  RATE_LIMITED: 'Rate limited. Wait before trying again.',
  NOT_FOUND: 'The request was not found for this Higgsfield account.',
  UPSTREAM_UNAVAILABLE: 'Higgsfield is temporarily unavailable. A submission may have been accepted; check the console before resubmitting.',
  INVALID_RESPONSE: 'Higgsfield returned an unexpected response. A submission may have been accepted; check the console before resubmitting.',
  INTERNAL_ERROR: 'An internal error occurred.',
};

export class HiggsfieldError extends Error {
  constructor(public readonly code: ErrorCode, public readonly retryAfterSeconds?: number) {
    super(messages[code]);
    this.name = 'HiggsfieldError';
  }
}

export function safeError(error: unknown) {
  const known = error instanceof HiggsfieldError ? error : new HiggsfieldError('INTERNAL_ERROR');
  return { code: known.code, message: known.message, ...(known.retryAfterSeconds === undefined ? {} : { retry_after_seconds: known.retryAfterSeconds }) };
}
