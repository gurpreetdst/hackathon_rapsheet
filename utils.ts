import { Field } from './parser';

const isEmpty = (v: any) =>
  v === null ||
  v === undefined ||
  (typeof v === 'string' && v.trim() === '') ||
  (Array.isArray(v) && v.length === 0);

export function coerceValue(field: Field, value: any) {
  if (isEmpty(value)) return value;
  switch (field.type) {
    case 'number': {
      const n = Number(value);
      return isNaN(n) ? value : n;
    }
    case 'switch':
      return !!value;
    default:
      return value;
  }
}

export function validateField(field: Field, value: any): string | null {
  // 1) Nothing is required → empty is always OK
  if (isEmpty(value)) return null;

  // 2) Type-specific checks
  switch (field.type) {
    case 'number': {
      const num = Number(value);
      if (isNaN(num)) return `${field.label} must be a number`;
      if (typeof field.min === 'number' && num < field.min)
        return `${field.label} must be ≥ ${field.min}`;
      if (typeof field.max === 'number' && num > field.max)
        return `${field.label} must be ≤ ${field.max}`;
      break;
    }

    case 'phone': {
      // exactly 10 digits when provided
      const re = /^\d{10}$/;
      if (!re.test(String(value))) return `Enter a 10-digit phone number`;
      break;
    }

    case 'email': {
      // per requirement: NO validation on email (skip any regex)
      break;
    }

    case 'date': {
      // accept YYYY-MM-DD; also reject impossible dates
      const s = String(value).trim();
      const re = /^\d{4}-\d{2}-\d{2}$/;
      if (!re.test(s)) return `Use YYYY-MM-DD`;
      const d = new Date(s + 'T00:00:00');
      if (isNaN(d.getTime())) return `Invalid date`;
      // extra guard: month/day must match (avoid 2025-02-31)
      const [y, m, day] = s.split('-').map(Number);
      if (
        d.getUTCFullYear() !== y ||
        d.getUTCMonth() + 1 !== m ||
        d.getUTCDate() !== day
      )
        return `Invalid date`;
      break;
    }

    case 'time': {
      // HH:mm (24h)
      const re = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!re.test(String(value))) return `Use HH:mm (24h)`;
      break;
    }

    case 'datetime': {
      // basic ISO-like: YYYY-MM-DD HH:mm
      const re = /^\d{4}-\d{2}-\d{2}[ T]([01]\d|2[0-3]):[0-5]\d$/;
      if (!re.test(String(value))) return `Use YYYY-MM-DD HH:mm`;
      break;
    }

    case 'radio':
    case 'select': {
      const ids = (field.options ?? []).map(o => o.id);
      if (!ids.includes(String(value))) return `Select a valid option`;
      break;
    }

    case 'checkbox': {
      const ids = (field.options ?? []).map(o => o.id);
      const arr = Array.isArray(value) ? value : [];
      if (!arr.every(v => ids.includes(String(v))))
        return `Contains invalid option(s)`;
      break;
    }
  }

  // 3) Pattern (skip for email; only check if non-empty)
  if (field.pattern && field.type !== 'email' && !isEmpty(value)) {
    try {
      const re = new RegExp(field.pattern);
      if (!re.test(String(value))) return `${field.label} is invalid`;
    } catch {
      // ignore bad patterns from AI
    }
  }

  return null;
}
