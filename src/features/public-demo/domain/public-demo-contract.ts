export const PUBLIC_DEMO_FIXTURE_RELATIVE_PATH = "fixtures/notion-export";

export const PUBLIC_DEMO_SOURCE_DESCRIPTION =
  "synthetic-fixture:fixtures/notion-export";

export interface PublicDataRisk {
  readonly description: string;
}

const riskPatterns: readonly {
  readonly description: string;
  readonly pattern: RegExp;
}[] = [
  {
    description: "absolute path",
    pattern:
      /(?:^|[^A-Za-z0-9])(?:[A-Za-z]:[\\/]+[^\s"'<>]*|\\{2,}(?:\?\\+UNC\\+)?[A-Za-z0-9._-]+\\+[A-Za-z0-9._$-]+)/i,
  },
  {
    description: "absolute path",
    pattern:
      /(?:^|[\s"'=:([{,])\/(?![/>])(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+/i,
  },
  {
    description: "absolute path",
    pattern:
      /(?:^|[^A-Za-z0-9+:])\/\/[A-Za-z0-9._-]+\/[A-Za-z0-9._~/-]+/i,
  },
  {
    description: "file URI",
    pattern: /file:(?:\/\/)?[^\s"'<>]*/i,
  },
  {
    description: "email address",
    pattern: /[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+/u,
  },
  {
    description: "phone number",
    pattern:
      /(?:\+\d{8,15}\b|(?<![A-Fa-f0-9])\d{10,15}(?![A-Fa-f0-9])|(?:(?:\+\d{1,3}[\s.-]+)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]+\d{3,4}[\s.-]+\d{4}))/,
  },
  {
    description: "secret-shaped value",
    pattern:
      /(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|(?:sk|ntn)_[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|["']?(?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{8,})/i,
  },
];

export function findPublicDataRisks(value: string): readonly PublicDataRisk[] {
  return riskPatterns
    .filter(({ pattern }) => pattern.test(value))
    .map(({ description }) => ({ description }));
}

export function findSensitiveJsonRisks(
  value: unknown,
): readonly PublicDataRisk[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => findSensitiveJsonRisks(item));
  }
  if (!value || typeof value !== "object") {
    return [];
  }

  const risks: PublicDataRisk[] = [];
  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key.replace(/[-_]/g, "").toLowerCase();
    if (
      /(?:accesskey|apikey|authorization|credential|password|passwd|privatekey|secret|token)$/.test(
        normalizedKey,
      ) &&
      nestedValue !== null &&
      nestedValue !== ""
    ) {
      risks.push({ description: "secret-shaped value" });
    }
    risks.push(...findSensitiveJsonRisks(nestedValue));
  }
  return risks;
}
