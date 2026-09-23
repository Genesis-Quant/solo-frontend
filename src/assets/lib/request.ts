import axios, { type AxiosRequestConfig } from "axios";

import { apiUrl } from "@/assets/lib/settings";

const instance = axios.create({ baseURL: apiUrl, timeout: 15000 });

async function request<T>(config: AxiosRequestConfig): Promise<T> {
  try {
    return (await instance.request<T>(config)).data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const detail: unknown = error.response?.data?.detail;
      throw new Error(typeof detail === "string" ? detail : "无法连接 Solo 服务");
    }
    throw error;
  }
}

export const client = {
  get: <T>(url: string) => request<T>({ method: "GET", url })
};
