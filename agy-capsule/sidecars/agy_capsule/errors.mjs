// Classify the latest reported model-request error, never inferred from quota %.
export function classifyRequestError(value = '') {
  const text = String(value || '').trim();
  const diagnostic = text.replace(/https?:\/\/[^\s"'<>]+/g, '<API>').replace(/[\r\n\t]+/g, ' ').slice(0, 400);
  const result = (kind, retryAfterSec = null) => ({ kind, diagnostic, retryAfterSec });
  if (!text) return result('none');
  // Go context.Canceled (client aborted the stream) is always caller-side; deadlines are matched below.
  if (/\bcontext cancel(?:ed|led)\b|user cancel(?:led|ed)|cancel(?:led|ed) by user|request was aborted|AbortError/i.test(text)) return result('canceled');
  if (/\b(?:deadline[ _]exceeded|(?:idle|request|connect(?:ion)?|i\/o) timeout|timed out|ETIMEDOUT|TimeoutError)\b/i.test(text)) return result('request_timeout');
  if (/input token count(?:\s*\([^)]*\)|\s+[\d,]+)?\s+exceeds|context\s*(?:window|length|tokens?|limit|size|capacity)?.{0,35}(?:exceed|too long)|maximum context length|prompt exceeds maximum context length|prompt (?:is )?too long|max_tokens exceeded/i.test(text)) return result('context_overflow');
  if (/UNAUTHENTICATED|PERMISSION_DENIED|\b401\b|\b403\b|invalid api key|credentials expired|permission denied/i.test(text)) return result('auth_error');
  if (/UNAVAILABLE|\b50[234]\b|server overloaded|high demand|Bad Gateway|Service Unavailable/i.test(text)) return result('service_unavailable');
  if (/\bEOF\b|ECONNRESET|ECONNREFUSED|ENOTFOUND|connection reset|connection refused|socket hang up|fetch failed|NetworkError/i.test(text)) return result('network_error');
  if (/quota\s*(?:exceeded|reached|limit|exhausted)|out\s+of\s+quota|exhausted.*(?:capacity|quota)|resource_exhausted.*(?:quota|capacity|billing)|free\s+tier\s+quota|daily\s+quota|weekly\s+quota/i.test(text)) return result('quota_exhausted');
  if (/rate\s*limit|too\s+many\s+requests|\b429\b|RateLimitError|RESOURCE_EXHAUSTED.*rate/i.test(text)) {
    const wait = text.match(/(?:retry\s+in|retry-after|wait)\s*[:=]?\s*([\d.]+)\s*(?:s|sec|seconds)?/i);
    const seconds = wait ? Number(wait[1]) : null;
    return result('rate_limited', Number.isFinite(seconds) ? seconds : null);
  }
  return result('unknown');
}
