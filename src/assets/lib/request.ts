import axios, { type AxiosRequestConfig } from "axios";

import { normalizeRequestError } from "@/assets/lib/requestError";
import { apiUrl } from "@/assets/lib/settings";

const instance = axios.create({ baseURL: apiUrl, timeout: 15000 });

async function request<T>(config: AxiosRequestConfig): Promise<T> {
  try {
    return (await instance.request<T>(config)).data;
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export const client = {
  getText: (url: string) => request<string>({ method: "GET", url, responseType: "text", timeout: 60000 }),
  get: <T>(url: string) => request<T>({ method: "GET", url, timeout: 60000 }),
  post: <T>(url: string, data: unknown) => request<T>({ method: "POST", url, data, timeout: 660000 }),
  patch: <T>(url: string, data: unknown) => request<T>({ method: "PATCH", url, data, timeout: 660000 }),
  delete: (url: string) => request<void>({ method: "DELETE", url, timeout: 120000 })
};
