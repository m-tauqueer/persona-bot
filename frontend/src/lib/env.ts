export function requiredVite(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

export function requiredViteInt(name: keyof ImportMetaEnv): number {
  const parsed = Number(requiredVite(name));
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function requiredViteNonNegInt(name: keyof ImportMetaEnv): number {
  const parsed = Number(requiredVite(name));
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

export function requiredViteBool(name: keyof ImportMetaEnv): boolean {
  const raw = requiredVite(name);
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  throw new Error(`${name} must be true or false`);
}

export function requiredViteGain(name: keyof ImportMetaEnv): number {
  const parsed = Number(requiredVite(name));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    throw new Error(`${name} must be greater than 0 and at most 1`);
  }
  return parsed;
}

export function requiredViteFloat(
  name: keyof ImportMetaEnv,
  min: number,
  max: number,
): number {
  const parsed = Number(requiredVite(name));
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return parsed;
}

export function requiredViteOneOf<T extends string>(
  name: keyof ImportMetaEnv,
  allowed: readonly T[],
): T {
  const value = requiredVite(name);
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
}
