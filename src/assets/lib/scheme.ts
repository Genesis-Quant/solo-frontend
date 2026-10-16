const versionPattern = /^(\d+)(?:\.(\d+))?(?:\.\d+)?(?![\s\S])/;

/** 报告仅按主版本分派，项目互调另按主、次版本校验。 */
export function schemeMajor(version: string | null | undefined): number | null {
  const match = versionPattern.exec(version ?? "");
  return match ? Number(match[1]) : null;
}

export function sameSchemeSeries(left: string | null | undefined, right: string | null | undefined): boolean {
  const first = versionPattern.exec(left ?? "");
  const second = versionPattern.exec(right ?? "");
  return first !== null && second !== null
    && Number(first[1]) === Number(second[1]) && Number(first[2] ?? 0) === Number(second[2] ?? 0);
}

export const supportedSchemeMajors = [1] as const;

export function supportsScheme(version: string | null | undefined): boolean {
  return supportedSchemeMajors.some((major) => major === schemeMajor(version));
}
