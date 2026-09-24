/** Scheme 大版本决定业务接口；未知版本不能套用现有报告。 */
export function schemeMajor(version: string | null | undefined): number | null {
  const match = /^(?:v)?(\d+)\.\d+\.\d+(?:(?:a|b|rc)\d+|[.+-][\w.-]+)?$/.exec(version ?? "");
  return match ? Number(match[1]) : null;
}

export const supportedSchemeMajors = [1] as const;

export function supportsScheme(version: string | null | undefined): boolean {
  return supportedSchemeMajors.some((major) => major === schemeMajor(version));
}
