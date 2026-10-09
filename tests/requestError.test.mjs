import assert from "node:assert/strict";
import test from "node:test";

import { AxiosError, CanceledError } from "axios";
import { normalizeRequestError, RequestError } from "../src/assets/lib/requestError.ts";

function httpError(data, status = 502) {
  const config = {
    url: "/private?token=secret-query",
    headers: { Authorization: "Bearer secret-token" }
  };
  return new AxiosError("secret transport message", "ERR_BAD_RESPONSE", config, {
    body: "secret request body"
  }, {
    data,
    status,
    statusText: "secret status text",
    headers: { "x-private": "secret response header" },
    config
  });
}

for (const [format, encode] of [["JSON object", (data) => data], ["text JSON", JSON.stringify]]) {
  test(`${format} HTTP 502 preserves the DolphinScheduler log download error`, () => {
    const error = normalizeRequestError(httpError(encode({ detail: "DolphinScheduler 日志下载失败" })));
    assert.ok(error instanceof Error);
    assert.equal(error.message, "DolphinScheduler 日志下载失败");
  });

  test(`${format} FastAPI validation errors expose only their messages`, () => {
    const detail = [
      { loc: ["query", "task_instance_id"], msg: "Field required", type: "missing", input: "secret input" },
      { loc: ["query", "limit"], msg: "Input should be a valid integer", ctx: { secret: "private context" } }
    ];
    assert.equal(
      normalizeRequestError(httpError(encode({ detail }), 422)).message,
      "Field required；Input should be a valid integer"
    );
  });

  test(`${format} malformed validation entries safely fall back to an invalid parameter message`, () => {
    const detail = [null, "secret input", 42, {}, { msg: null }, { msg: {} }, { msg: "" }, { msg: " " }, { msg: "参数需要 task_instance_id" }];
    assert.equal(
      normalizeRequestError(httpError(encode({ detail }), 422)).message,
      [...Array(8).fill("参数无效"), "参数需要 task_instance_id"].join("；")
    );
  });
}

test("HTTP failures without a usable detail include status without exposing response or request data", () => {
  const payloads = [
    undefined,
    null,
    true,
    42,
    [],
    "",
    "   ",
    "secret plain text response",
    "<html><body>Bad Gateway: secret upstream information</body></html>",
    "{\"detail\":broken}",
    "\"secret JSON string\"",
    "null",
    "[]",
    "{\"error\":\"secret response body\"}",
    { error: "secret response body" }
  ];
  for (const detail of [undefined, null, "", " ", 42, false, {}, []]) {
    payloads.push({ detail }, JSON.stringify({ detail }));
  }
  for (const data of payloads) {
    assert.equal(normalizeRequestError(httpError(data)).message, "Solo 服务请求失败（HTTP 502）");
  }
});

test("HTTP fallback reports the actual response status", () => {
  for (const status of [400, 401, 404, 422, 502, 503]) {
    assert.equal(normalizeRequestError(httpError(null, status)).message, `Solo 服务请求失败（HTTP ${status}）`);
  }
});

test("an HTTP response is not mislabeled as a connection failure or timeout", () => {
  for (const code of ["ERR_NETWORK", "ECONNABORTED", "ETIMEDOUT"]) {
    const error = httpError(null);
    error.code = code;
    assert.equal(normalizeRequestError(error).message, "Solo 服务请求失败（HTTP 502）");
  }
});

test("network failures without an HTTP response use the connection error", () => {
  const errors = [
    new AxiosError("secret network message", "ERR_NETWORK"),
    new AxiosError("secret transport message", undefined, undefined, { body: "secret request" })
  ];
  for (const error of errors) {
    assert.equal(normalizeRequestError(error).message, "无法连接 Solo 服务");
  }
});

test("both Axios timeout codes report a timeout rather than a connection failure", () => {
  for (const code of ["ECONNABORTED", "ETIMEDOUT"]) {
    const error = new AxiosError("secret timeout message", code, undefined, { body: "secret request" });
    assert.equal(normalizeRequestError(error).message, "Solo 服务请求超时，请稍后重试");
  }
});

test("cancellation is not mislabeled as a network failure", () => {
  const error = new CanceledError("secret cancel message", undefined, { body: "secret request" });
  assert.equal(normalizeRequestError(error).message, "Solo 服务请求已取消");
});

test("Axios setup errors are not mislabeled as network failures or exposed verbatim", () => {
  const error = new AxiosError("secret configuration", "ERR_BAD_OPTION_VALUE", {
    headers: { Authorization: "Bearer secret-token" }
  });
  assert.equal(normalizeRequestError(error).message, "Solo 服务请求失败");
});

for (const [format, encode] of [["JSON object", (data) => data], ["text JSON", JSON.stringify]]) {
  test(`${format} lifecycle failures retain whitelisted metadata without raw secrets`, () => {
    const error = normalizeRequestError(httpError(encode({ detail: {
      code: "project_cleanup_incomplete", reason: "运行资源清理失败", deleted: true, id: "old-uuid",
      status: "secret server field", input: "secret input", config: { token: "secret token" },
      paths: ["secret private path"], headers: { Authorization: "secret authorization" }, arbitrary: "secret data"
    } }), 500));
    assert.ok(error instanceof RequestError);
    assert.equal(error.message, "运行资源清理失败");
    assert.equal(error.status, 500);
    assert.equal(error.code, "project_cleanup_incomplete");
    assert.equal(error.reason, "运行资源清理失败");
    assert.equal(error.deleted, true);
    assert.equal(error.id, "old-uuid");
    assert.equal(error.response, undefined);
    assert.equal(error.config, undefined);
    assert.equal(error.detail, undefined);
    assert.doesNotMatch(JSON.stringify(error), /secret|private|authorization/);
  });
}

test("structured publication conflict and busy-source errors preserve status/code/reason", () => {
  for (const code of ["artifact_release_conflict", "active_kernel", "active_task"]) {
    const error = normalizeRequestError(httpError({ detail: { code, reason: "请先完成当前操作", message: "无法完成请求" } }, 409));
    assert.equal(error.message, "无法完成请求");
    assert.equal(error.reason, "请先完成当前操作");
    assert.equal(error.code, code);
    assert.equal(error.status, 409);
  }
});

test("structured metadata rejects invalid field types without stringifying private data", () => {
  const error = normalizeRequestError(httpError({ detail: { message: {}, reason: [], code: {}, deleted: "true", id: { private: "secret" } } }, 422));
  assert.equal(error.message, "Solo 服务请求失败（HTTP 422）");
  for (const key of ["reason", "code", "deleted", "id"]) assert.equal(error[key], undefined);
  assert.doesNotMatch(JSON.stringify(error), /secret/);
});

test("non-Axios thrown values remain unchanged", () => {
  for (const error of [new Error("unchanged error"), new TypeError("unchanged type error"), { detail: "unchanged" }, "unchanged", null, undefined]) {
    assert.equal(normalizeRequestError(error), error);
  }
});
