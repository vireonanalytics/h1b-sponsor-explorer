// DOL's official prevailing-wage skill/experience tiers (PW_WAGE_LEVEL: I-IV).
// This is the standard DOL proxy for a role's experience level in LCA/PERM
// wage determinations, so we use it as the site-wide "experience level" filter.
export const PW_LEVELS = [
  { value: "I", label: "Level I (Entry)" },
  { value: "II", label: "Level II (Qualified)" },
  { value: "III", label: "Level III (Experienced)" },
  { value: "IV", label: "Level IV (Senior / Fully Competent)" },
] as const;

export const PW_LEVEL_LABELS: Record<string, string> = Object.fromEntries(
  PW_LEVELS.map((l) => [l.value, l.label])
);

export const VALID_PW_LEVELS: Set<string> = new Set(PW_LEVELS.map((l) => l.value));

export function pwLevelLabel(value: string | null): string {
  if (!value) return "Not specified";
  return PW_LEVEL_LABELS[value] ?? value;
}
