/**
 * Utilities for JSON Schema references and names.
 */
export function extractDefRefName(ref: string): string {
  const defsMatch = ref.match(/#\/\$defs\/([^/]+)$/);
  if (defsMatch) return defsMatch[1];
  const defsMatch2 = ref.match(/#\/definitions\/([^/]+)$/);
  if (defsMatch2) return defsMatch2[1];
  return "";
}

export default {
  extractDefRefName,
};
