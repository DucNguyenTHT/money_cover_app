export const PIN_MAX_FAILED = 5;
export const PIN_LOCK_MINUTES = 5;

/** Reasons a PIN is rejected, or null when it is acceptable. */
export function pinProblem(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) return 'Mã PIN phải gồm 4–6 chữ số';
  if (/^(\d)\1+$/.test(pin)) return 'Mã PIN không được là các số giống nhau';
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]!);
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1))
    return 'Mã PIN không được là dãy số liên tiếp';
  return null;
}
