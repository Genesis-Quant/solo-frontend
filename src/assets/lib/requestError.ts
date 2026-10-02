import axios from "axios";

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

export function normalizeRequestError(error: unknown): unknown {
  if (!axios.isAxiosError(error)) return error;

  if (!error.response) {
    if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
      return new Error("Solo 服务请求超时，请稍后重试");
    }
    if (error.code === "ERR_CANCELED") return new Error("Solo 服务请求已取消");
    return new Error(error.request || error.code === "ERR_NETWORK"
      ? "无法连接 Solo 服务"
      : "Solo 服务请求失败");
  }

  const detail = getErrorDetail(error.response.data);
  if (typeof detail === "string" && detail.trim()) return new Error(detail);
  if (Array.isArray(detail) && detail.length) {
    const messages = detail.map((item: unknown) => {
      const msg = item !== null && typeof item === "object" && "msg" in item
        ? item.msg
        : undefined;
      return typeof msg === "string" && msg.trim()
        ? msg
        : "参数无效";
    });
    return new Error(messages.join("；"));
  }

  return new Error(`Solo 服务请求失败（HTTP ${error.response.status}）`);
}
