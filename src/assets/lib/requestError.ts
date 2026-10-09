import axios from "axios";

interface RequestFailure {
  status?: number;
  code?: string;
  reason?: string;
  deleted?: boolean;
  id?: string;
}

/** Safe API failure metadata only; never retain transport config, raw body or headers. */
export class RequestError extends Error implements RequestFailure {
  readonly status?: number;
  readonly code?: string;
  readonly reason?: string;
  readonly deleted?: boolean;
  readonly id?: string;

  constructor(message: string, failure: RequestFailure = {}) {
    super(message);
    this.name = "RequestError";
    this.status = failure.status;
    this.code = failure.code;
    this.reason = failure.reason;
    this.deleted = failure.deleted;
    this.id = failure.id;
  }
}

function getErrorDetail(data: unknown): unknown {
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      data = undefined;
    }
  }
  return data !== null && typeof data === "object" && "detail" in data
    ? data.detail
    : undefined;
}

function messageField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function normalizeRequestError(error: unknown): unknown {
  if (!axios.isAxiosError(error)) return error;

  if (!error.response) {
    if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
      return new RequestError("Solo 服务请求超时，请稍后重试");
    }
    if (error.code === "ERR_CANCELED") return new RequestError("Solo 服务请求已取消");
    return new RequestError(error.request || error.code === "ERR_NETWORK"
      ? "无法连接 Solo 服务"
      : "Solo 服务请求失败");
  }

  const status = error.response.status;
  const fallback = `Solo 服务请求失败（HTTP ${status}）`;
  const detail = getErrorDetail(error.response.data);
  if (typeof detail === "string" && detail.trim()) return new RequestError(detail, { status });
  if (Array.isArray(detail) && detail.length) {
    const messages = detail.map((item: unknown) => {
      const msg = item !== null && typeof item === "object" && "msg" in item
        ? item.msg
        : undefined;
      return messageField(msg) ?? "参数无效";
    });
    return new RequestError(messages.join("；"), { status });
  }
  if (detail !== null && typeof detail === "object" && !Array.isArray(detail)) {
    const fields = detail as Record<string, unknown>;
    const reason = messageField(fields.reason);
    return new RequestError(messageField(fields.message) ?? reason ?? fallback, {
      status,
      code: messageField(fields.code),
      reason,
      deleted: typeof fields.deleted === "boolean" ? fields.deleted : undefined,
      id: messageField(fields.id)
    });
  }
  return new RequestError(fallback, { status });
}
