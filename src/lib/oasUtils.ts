// Common OpenAPI schema utilities

/**
 * Helper to extract a components/schemas ref name from a $ref string.
 */
export function refToName(ref: string): string | undefined {
  const m = ref.match(/^#\/(?:components\/)?schemas\/([^#/]+)$/);
  return m ? decodeURIComponent(m[1]) : undefined;
}
