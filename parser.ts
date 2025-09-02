// parser.ts
import chrono from 'chrono-node';
import stringSimilarity from 'string-similarity';

/**
 * Types
 */
export type FieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'time'
  | 'datetime'
  | 'radio'
  | 'select'
  | 'checkbox'
  | 'switch'
  | 'email'
  | 'phone';

export type Option = { id: string; label: string; synonyms?: string[] };

export type Field = {
  id: string;
  label: string;
  type: FieldType;
  options?: Option[];
  required?: boolean;
  pattern?: string;
  min?: number;
  max?: number;
  // optional synonyms for labels (helps dynamic matching)
  synonyms?: string[];
};

export type FieldUpdate = {
  fieldId: string;
  value: any;
  confidence: number; // 0..1
  evidence?: string;
};

function escRe(s: string) {
  return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

type Span = { start: number; end: number };
function spansOverlap(a: Span, b: Span) {
  return a.start < b.end && b.start < a.end;
}
function mergeSpans(spans: Span[]): Span[] {
  if (!spans.length) return [];
  const s = spans.slice().sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  let cur = { ...s[0] };
  for (let i = 1; i < s.length; i++) {
    const nx = s[i];
    if (nx.start <= cur.end) {
      cur.end = Math.max(cur.end, nx.end);
    } else {
      out.push(cur);
      cur = { ...nx };
    }
  }
  out.push(cur);
  return out;
}
function isSpanFree(used: Span[], span: Span) {
  const merged = mergeSpans(used);
  for (const u of merged) if (spansOverlap(u, span)) return false;
  return true;
}

function markSpan(used: Span[], newSpan: Span) {
  used.push(newSpan);
}

/** Coerce raw string to typed value based on field.type */
function coerceValue(field: Field, raw: string): { value: any; confidence: number; evidence?: string } | null {
  const t = raw.trim();
  if (!t) return null;
  switch (field.type) {
    case 'number': {
      // allow currency symbols, commas
      const num = Number(t.replace(/[^0-9.\-]/g, ''));
      if (!Number.isNaN(num)) return { value: num, confidence: 0.9, evidence: 'number' };
      return null;
    }
    case 'date':
    case 'datetime':
    case 'time': {
      try {
        // chrono.parse requires chrono imported
        const parsed = (chrono as any).parse(t);
        if (parsed && parsed.length) {
          const iso = parsed[0].date().toISOString();
          return { value: iso, confidence: 0.85, evidence: 'chrono' };
        }
      } catch (e) {
        // fallthrough
      }
      return null;
    }
    case 'email': {
      const m = t.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,})/i);
      if (m) return { value: m[1], confidence: 0.95, evidence: 'email' };
      return null;
    }
    case 'phone': {
      const m = t.match(/(\+?\d[\d\-\s().]{6,}\d)/);
      if (m) return { value: m[1].replace(/[\s\-\(\)\.]/g, ''), confidence: 0.9, evidence: 'phone' };
      return null;
    }
    case 'checkbox':
    case 'radio':
    case 'select':
      return null; // handled elsewhere
    default:
      return { value: t, confidence: 0.6, evidence: 'text' };
  }
}

/** Helper: find the first regex match (case-insensitive) on original text and return match + index */
function firstRegexMatch(text: string, pattern: RegExp | string) {
  const re = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
  const m = re.exec(text);
  return m ? { match: m[0], index: m.index, groups: m } : null;
}

/** Safe word-presence test for a token in text (word boundary aware) */
function tokenPresent(text: string, token: string) {
  const re = new RegExp(`\\b${escRe(token)}\\b`, 'i');
  return re.test(text);
}

/**
 * MAIN PARSER
 */
export function parseTranscript(schema: Field[], transcript: string): { updates: FieldUpdate[]; debug: any } {
  const text = transcript || '';
  const usedSpans: Span[] = [];
  const updates: FieldUpdate[] = [];
  const debug: any[] = [];

  // Utility to mark + log a used span
  const markUsedRange = (span: Span, note?: string) => {
    markSpan(usedSpans, span);
    debug.push({ type: 'markSpan', span, note });
  };

  // 1) email
  {
    const emailRe = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,})/gi;
    let m;
    while ((m = emailRe.exec(text))) {
      const span = { start: m.index, end: m.index + m[0].length };
      if (!isSpanFree(usedSpans, span)) { debug.push({ type: 'email-skip-overlap', match: m[0], span }); continue; }
      let target = schema.find((f) => f.type === 'email');
      if (!target) target = schema.find((f) => f.label.toLowerCase().includes('email'));
      if (!target) target = schema.find((f) => f.type === 'text');
      if (target) {
        updates.push({ fieldId: target.id, value: m[1], confidence: 0.95, evidence: 'email' });
        markUsedRange(span, 'email');
        debug.push({ type: 'email-match', match: m[0], field: target.id });
      }
    }
  }

  // 2) phone
  {
    const phoneRe = /(\+?\d[\d\-\s().]{6,}\d)/g;
    let m;
    while ((m = phoneRe.exec(text))) {
      const raw = (m[0] || '').trim();
      if (!raw) continue;
      const span = { start: m.index, end: m.index + raw.length };
      if (!isSpanFree(usedSpans, span)) { debug.push({ type: 'phone-skip-overlap', match: raw, span }); continue; }
      let target = schema.find((f) => f.type === 'phone');
      if (!target) target = schema.find((f) => f.label.toLowerCase().includes('phone') || f.label.toLowerCase().includes('mobile'));
      if (!target) target = schema.find((f) => f.type === 'text');
      if (target) {
        updates.push({ fieldId: target.id, value: raw.replace(/\D/g, ''), confidence: 0.9, evidence: 'phone' });
        markUsedRange(span, 'phone');
        debug.push({ type: 'phone-match', match: raw, field: target.id });
      }
    }
  }

  // 3) chrono date/time
  try {
    const chronoResults = (chrono as any).parse(text);
    if (chronoResults && chronoResults.length) {
      for (const cr of chronoResults) {
        const span = { start: cr.index, end: cr.index + (cr.text?.length ?? 0) };
        if (!isSpanFree(usedSpans, span)) { debug.push({ type: 'chrono-skip-overlap', span, text: cr.text }); continue; }
        const candidate = schema.find((f) => ['date', 'datetime', 'time'].includes(f.type) && !updates.find((u) => u.fieldId === f.id));
        if (candidate) {
          updates.push({ fieldId: candidate.id, value: cr.date().toISOString(), confidence: 0.85, evidence: 'chrono' });
          markUsedRange(span, 'chrono');
          debug.push({ type: 'chrono-match', text: cr.text, field: candidate.id });
        }
      }
    }
  } catch (e) {
    debug.push({ type: 'chrono-error', error: String(e) });
  }

  // 4) option fields (select/radio/checkbox)
  for (const field of schema.filter((f) => ['select', 'radio', 'checkbox'].includes(f.type))) {
    if (!field.options || field.options.length === 0) continue;
    // try exact phrase match for option label or synonyms
    let matched = false;
    for (const opt of field.options) {
      const phrases = [opt.label, ...(opt.synonyms ?? [])].filter(Boolean).sort((a, b) => b.length - a.length);
      for (const phrase of phrases) {
        const re = new RegExp(`\\b${escRe(phrase)}\\b`, 'i');
        const m = re.exec(text);
        if (m) {
          const span = { start: m.index, end: m.index + m[0].length };
          if (!isSpanFree(usedSpans, span)) { debug.push({ type: 'option-skip-overlap', field: field.id, opt: opt.id, phrase }); continue; }
          if (field.type === 'checkbox') {
            // accumulate found checkbox options
            const existing = updates.find((u) => u.fieldId === field.id && Array.isArray(u.value));
            if (existing) existing.value.push(opt.id);
            else updates.push({ fieldId: field.id, value: [opt.id], confidence: 0.9, evidence: 'option-exact' });
            markUsedRange(span, 'option-exact');
            debug.push({ type: 'option-exact', field: field.id, opt: opt.id, phrase });
            matched = true;
            // for checkboxes, continue to find more options
          } else {
            updates.push({ fieldId: field.id, value: opt.id, confidence: 0.92, evidence: 'option-exact' });
            markUsedRange(span, 'option-exact');
            debug.push({ type: 'option-exact', field: field.id, opt: opt.id, phrase });
            matched = true;
            break;
          }
        }
      }
      if (matched && field.type !== 'checkbox') break;
    }
    if (matched) continue;

    // fuzzy token presence: all tokens of an option phrase present as word tokens somewhere
    for (const opt of field.options) {
      const candidates = [opt.label, ...(opt.synonyms ?? [])].filter(Boolean);
      let fuzzyMatched = false;
      for (const cand of candidates) {
        const tokens = cand.toLowerCase().split(/\s+/).filter(Boolean);
        if (tokens.length === 0) continue;
        const allPresent = tokens.every((tk) => tokenPresent(text, tk));
        if (allPresent) {
          // do fuzzy assignment (no precise span)
          if (field.type === 'checkbox') {
            const existing = updates.find((u) => u.fieldId === field.id && Array.isArray(u.value));
            if (existing) existing.value.push(opt.id);
            else updates.push({ fieldId: field.id, value: [opt.id], confidence: 0.75, evidence: 'option-fuzzy' });
            debug.push({ type: 'option-fuzzy', field: field.id, opt: opt.id, cand });
          } else {
            updates.push({ fieldId: field.id, value: opt.id, confidence: 0.75, evidence: 'option-fuzzy' });
            debug.push({ type: 'option-fuzzy', field: field.id, opt: opt.id, cand });
          }
          fuzzyMatched = true;
          break;
        }
      }
      if (fuzzyMatched && field.type !== 'checkbox') break;
    }
  }

  // 5) booleans / switches
  {
    const trueWords = ['yes', 'true', 'enable', 'enabled', 'on', 'allow', 'allowed'];
    const falseWords = ['no', 'false', 'disable', 'disabled', 'off', "don't", 'do not', 'not'];
    for (const field of schema.filter((f) => f.type === 'switch')) {
      // try "label <verb> <value>" pattern
      const labelPhrases = [field.label, ...(field.synonyms ?? [])].filter(Boolean).sort((a, b) => b.length - a.length);
      let matched = false;
      for (const lp of labelPhrases) {
        const kvRe = new RegExp(`\\b${escRe(lp)}\\b\\s*(?:is|:|=|to|as)?\\s*([^,;\\n\\.]+)`, 'i');
        const m = kvRe.exec(text);
        if (m && m[1]) {
          const valueStr = m[1].toLowerCase();
          const isTrue = trueWords.some((w) => valueStr.includes(w));
          const isFalse = falseWords.some((w) => valueStr.includes(w));
          const span = { start: m.index, end: m.index + m[0].length };
          if (!isSpanFree(usedSpans, span)) { debug.push({ type: 'switch-skip-overlap', field: field.id, lp }); break; }
          if (isTrue || isFalse) {
            updates.push({ fieldId: field.id, value: isTrue, confidence: 0.9, evidence: 'label-boolean' });
            markUsedRange(span, 'label-boolean');
            debug.push({ type: 'switch-match', field: field.id, value: isTrue });
            matched = true;
            break;
          }
        }
      }
      if (matched) continue;
      // fallback: "turn <label> on/off"
      for (const lp of labelPhrases) {
        const tRe = new RegExp(`turn\\s+${escRe(lp)}\\s+(on|off)`, 'i');
        const m = tRe.exec(text);
        if (m) {
          updates.push({ fieldId: field.id, value: m[1].toLowerCase() === 'on', confidence: 0.9, evidence: 'turn-on-off' });
          debug.push({ type: 'switch-turn', field: field.id, value: m[1] });
          break;
        }
      }
    }
  }

  // 6) numbers
  {
    const numRe = /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/g;
    let m;
    while ((m = numRe.exec(text))) {
      const rawNum = m[0];
      const span = { start: m.index, end: m.index + rawNum.length };
      if (!isSpanFree(usedSpans, span)) { debug.push({ type: 'number-skip-overlap', match: rawNum }); continue; }
      const field = schema.find((f) => f.type === 'number' && !updates.find((u) => u.fieldId === f.id));
      if (field) {
        const val = Number(rawNum.replace(/,/g, ''));
        updates.push({ fieldId: field.id, value: val, confidence: 0.9, evidence: 'digits' });
        markUsedRange(span, 'digits');
        debug.push({ type: 'number-match', field: field.id, value: val });
      }
    }
  }

  // 7) label-based key:value generic mapping (try full label / synonyms first)
  for (const field of schema) {
    if (updates.find((u) => u.fieldId === field.id)) continue;
    const labelPhrases = [field.label, ...(field.synonyms ?? []), field.id].filter(Boolean).sort((a, b) => b.length - a.length);
    if (!labelPhrases.length) continue;
    const pattern = labelPhrases.map((p) => escRe(p)).join('|');
    const kvRegex = new RegExp(`\\b(?:${pattern})\\b\\s*(?:is|:|=|to|as)?\\s*([^,;\\n\\.]+)`, 'i');
    const r = kvRegex.exec(text);
    if (r && r[1]) {
      const rawVal = r[1].trim();
      const span = { start: r.index, end: r.index + r[0].length };
      if (!isSpanFree(usedSpans, span)) { debug.push({ type: 'labelkv-skip-overlap', field: field.id, match: r[0] }); continue; }
      const coerced = coerceValue(field, rawVal);
      if (coerced) {
        updates.push({ fieldId: field.id, value: coerced.value, confidence: coerced.confidence, evidence: 'label-kv' });
        markUsedRange(span, 'label-kv');
        debug.push({ type: 'labelkv-match-coerced', field: field.id, value: coerced.value, evidence: coerced.evidence });
      } else if (['select', 'radio', 'checkbox'].includes(field.type) && field.options) {
        // try matching options against rawVal
        const foundIds: string[] = [];
        for (const opt of field.options) {
          const cand = opt.label.toLowerCase();
          if (new RegExp(`\\b${escRe(cand)}\\b`, 'i').test(rawVal)) foundIds.push(opt.id);
        }
        if (foundIds.length) {
          const val = field.type === 'checkbox' ? foundIds : foundIds[0];
          updates.push({ fieldId: field.id, value: val, confidence: 0.85, evidence: 'label-kv-option' });
          markUsedRange(span, 'label-kv-option');
          debug.push({ type: 'labelkv-option', field: field.id, value: val });
        } else {
          updates.push({ fieldId: field.id, value: rawVal, confidence: 0.6, evidence: 'label-kv-text' });
          markUsedRange(span, 'label-kv-text');
          debug.push({ type: 'labelkv-text', field: field.id, rawVal });
        }
      } else {
        updates.push({ fieldId: field.id, value: rawVal, confidence: 0.6, evidence: 'label-kv-text' });
        markUsedRange(span, 'label-kv-text');
        debug.push({ type: 'labelkv-text-fallback', field: field.id, rawVal });
      }
    }
  }

  // 8) fallback: assign leftover clauses to empty text fields
  let leftover = '';
  if (!usedSpans.length) {
    leftover = text.trim();
  } else {
    const merged = mergeSpans(usedSpans);
    let cursor = 0;
    const parts: string[] = [];
    for (const s of merged) {
      if (cursor < s.start) parts.push(text.slice(cursor, s.start));
      cursor = Math.max(cursor, s.end);
    }
    if (cursor < text.length) parts.push(text.slice(cursor));
    leftover = parts.join(' ').trim();
  }

  if (leftover) {
    const clauses = leftover.split(/\b(?:,|;|\band\b|\n)\b/).map((c) => c.trim()).filter(Boolean);
    const emptyTextFields = schema.filter((f) => ['text'].includes(f.type) && !updates.find((u) => u.fieldId === f.id));
    let idx = 0;
    for (const cl of clauses) {
      if (idx >= emptyTextFields.length) break;
      if (cl.length < 2) continue;
      updates.push({ fieldId: emptyTextFields[idx].id, value: cl, confidence: 0.55, evidence: 'fallback-clause' });
      debug.push({ type: 'fallback-assign', field: emptyTextFields[idx].id, clause: cl });
      idx++;
    }
  }

  // final dedupe: pick best confidence per fieldId
  const map = new Map<string, FieldUpdate>();
  for (const u of updates) {
    const existing = map.get(u.fieldId);
    if (!existing || u.confidence > existing.confidence) map.set(u.fieldId, u);
  }
  const finalUpdates = Array.from(map.values());

  return { updates: finalUpdates, debug: { usedSpans: mergeSpans(usedSpans), events: debug } };
}

/**
 * ---------------------------
 * Simple test harness (paste below)
 * ---------------------------
 */
/*
const schema: Field[] = [
  { id: 'name', label: 'Name', type: 'text' },
  { id: 'email', label: 'Email', type: 'email' },
  { id: 'phone', label: 'Phone', type: 'phone' },
  { id: 'subscribe', label: 'Subscribe to newsletter', type: 'switch', synonyms: ['newsletter'] },
  { id: 'city', label: 'City', type: 'select', options: [{ id: 'blr', label: 'Bangalore' }, { id: 'mum', label: 'Mumbai' }] },
  { id: 'age', label: 'Age', type: 'number' },
];

const transcript = "My name is Gurpreet, email gurpreet@example.com, phone +91 98765 43210, I live in Bangalore and I'm 29 years old. Subscribe: yes";

const res = parseTranscript(schema, transcript);
console.log(JSON.stringify(res, null, 2));
*/

