/**
 * Pattern matching utilities with SQL-like wildcard support.
 * 
 * Wildcard patterns:
 * - `*` matches any sequence of characters (including empty)
 * - No wildcards means exact match
 * - `Foo*` matches strings starting with "Foo"
 * - `*Bar` matches strings ending with "Bar"
 * - `*Baz*` matches strings containing "Baz"
 * - `*` matches everything
 */

/**
 * Converts a wildcard pattern to a matching function.
 * 
 * @param pattern - Pattern with optional `*` wildcards
 * @returns Function that tests if a string matches the pattern
 */
export function createWildcardMatcher(pattern: string): (str: string) => boolean {
  if (pattern === '*') {
    return () => true;
  }

  const hasWildcard = pattern.includes('*');
  if (!hasWildcard) {
    // Exact match
    return (str: string) => str === pattern;
  }

  // Convert wildcard pattern to regex
  const parts = pattern.split('*');
  const escapedParts = parts.map(part => 
    part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );
  
  let regexPattern = '';
  if (pattern.startsWith('*')) {
    regexPattern += '.*';
  }
  
  for (let i = 0; i < escapedParts.length; i++) {
    regexPattern += escapedParts[i];
    // Add .* between parts, but not after the last part
    if (i < escapedParts.length - 1) {
      regexPattern += '.*';
    }
  }
  
  if (!pattern.endsWith('*') && escapedParts[escapedParts.length - 1] === '') {
    // Pattern ends with *, already handled
  }

  const regex = new RegExp(`^${regexPattern}$`);
  return (str: string) => regex.test(str);
}

/**
 * Tests if a string matches any of the given patterns.
 * 
 * @param str - String to test
 * @param patterns - Array of wildcard patterns
 * @returns true if the string matches at least one pattern
 */
export function matchesAny(str: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  return patterns.some(pattern => createWildcardMatcher(pattern)(str));
}

/**
 * Creates a keep/filter predicate based on positive and negative patterns.
 * 
 * Logic:
 * - If no patterns (empty array): return undefined (no filtering, default behavior)
 * - If only positive patterns: keep only if matches any positive pattern
 * - If only negative patterns: keep if matches NO negative pattern
 * - If both: keep if matches any positive AND matches NO negative
 * 
 * Negative patterns are prefixed with `!` (e.g., `!*Test`).
 * 
 * @param patterns - Array of patterns, negative patterns start with `!`
 * @returns Predicate function that returns true to keep the item, or undefined if no filtering
 */
export function createKeepPredicate(patterns: string[]): ((name: string) => boolean) | undefined {
  const positive = patterns.filter(p => !p.startsWith('!')).map(p => p.trim());
  const negative = patterns.filter(p => p.startsWith('!')).map(p => p.slice(1).trim());
  
  const hasPositive = positive.length > 0;
  const hasNegative = negative.length > 0;

  if (!hasPositive && !hasNegative) {
    // No patterns - no filtering (undefined means "don't filter")
    return undefined;
  }

  if (hasPositive && !hasNegative) {
    // Only positive - keep if matches any positive
    return (name: string) => matchesAny(name, positive);
  }

  if (!hasPositive && hasNegative) {
    // Only negative - keep if matches NO negative
    return (name: string) => !matchesAny(name, negative);
  }

  // Both positive and negative - keep if matches positive AND NOT negative
  return (name: string) => {
    return matchesAny(name, positive) && !matchesAny(name, negative);
  };
}
