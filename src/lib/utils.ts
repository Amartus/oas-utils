
/**
 * Recursively drops `null` values from objects and arrays.
 *
 * - For objects: removes keys whose value is `null`, and recursively cleans nested objects/arrays.
 * - For arrays: removes elements that are `null`, and recursively cleans nested objects/arrays.
 * - Other values are returned as-is.
 *
 * Note: `undefined` values are preserved. Only strict `null` is removed.
 */
export function dropNulls<T = any>(input: T): T | null {
	if (input === null) return input;

	if (Array.isArray(input)) {
		if (input.length === 0) return input;
		const cleaned = input
			.map(item => dropNulls(item))
			.filter(item => item !== null);
		return cleaned.length === 0 ? null : cleaned as unknown as T;
	}

	if (typeof input === 'object' && input !== null) {
		const out: Record<string, any> = {};
		for (const [key, value] of Object.entries(input as Record<string, any>)) {
			if (value === null) continue;
			const cleaned = dropNulls(value);
			if (cleaned === null) continue;
			out[key] = cleaned;
		}
		return out as T;
	}

	return input;
}
