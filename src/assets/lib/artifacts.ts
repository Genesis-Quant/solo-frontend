import { apiUrl } from "@/assets/lib/settings";

export function artifactWheelUrl(id: string): string {
  return `${apiUrl}/artifacts/${encodeURIComponent(id)}/wheel`;
}

export function artifactSize(size: number | null | undefined): string {
  if (size === null || size === undefined || !Number.isFinite(size) || size < 0) return "大小未记录";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
