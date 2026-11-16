/**
 * Reading numbers the way a student types them, and rounding the way a
 * pharmacist is told to.
 */

export type ParsedNumber =
  | {
      ok: true;
      value: number;
      /** Digits after the decimal point in what she typed (after the exponent is applied). */
      decimals: number;
      /** Significant figures in what she typed (trailing zeros of a whole number do not count). */
      sigFigs: number;
      /** What was left after the number: the unit text, possibly empty. */
      rest: string;
      /** True when the number was written as a fraction such as 1/2. */
      wasFraction: boolean;
    }
  | {
      ok: false;
      code: "no_number" | "fraction_not_allowed" | "bad_number" | "zero_denominator";
      reason: string;
    };

const MINUS = /[−‒–]/g;

/** Turn a typed number with separators into a plain decimal string, or null if it makes no sense. */
export function cleanNumberToken(raw: string): string | null {
  const token = raw.replace(/[.,]+$/, "");
  if (!/^[\d.,]+$/.test(token) || !/\d/.test(token)) return null;
  const commas = (token.match(/,/g) ?? []).length;
  const dots = (token.match(/\./g) ?? []).length;
  if (commas === 0 && dots === 0) return token;
  if (commas === 0) {
    if (dots === 1) return token.startsWith(".") ? `0${token}` : token;
    // 1.250.000 : European thousands dots.
    return /^\d{1,3}(\.\d{3})+$/.test(token) ? token.replaceAll(".", "") : null;
  }
  if (dots === 0) {
    // 1,250 or 1,250,000 : thousands.   2,5 or 0,25 : decimal comma.
    if (/^\d{1,3}(,\d{3})+$/.test(token)) return token.replaceAll(",", "");
    if (commas === 1 && /^\d*,\d+$/.test(token)) {
      const t = token.replace(",", ".");
      return t.startsWith(".") ? `0${t}` : t;
    }
    return null;
  }
  const lastComma = token.lastIndexOf(",");
  const lastDot = token.lastIndexOf(".");
  if (lastDot > lastComma) {
    // 1,250.5
    return /^\d{1,3}(,\d{3})+\.\d+$/.test(token) ? token.replaceAll(",", "") : null;
  }
  // 1.250,5
  return /^\d{1,3}(\.\d{3})+,\d+$/.test(token) ? token.replaceAll(".", "").replace(",", ".") : null;
}

function precisionOf(mantissa: string, exponent: number): { decimals: number; sigFigs: number } {
  const [whole = "", frac = ""] = mantissa.split(".");
  const decimals = Math.max(0, frac.length - exponent);
  const digits = (whole + frac).replace(/^0+/, "");
  const hasPoint = mantissa.includes(".");
  const significant = hasPoint ? digits : digits.replace(/0+$/, "");
  return { decimals, sigFigs: Math.max(1, significant.length) };
}

/**
 * Read a leading number from text like "2.5mg", "1,250 mL", "1.5e3 mg",
 * "1.5 x 10^3 mg", "1/2 tablet". The remaining text (the unit) is returned in
 * `rest`. Fractions are only read when `allowFractions` is true.
 */
export function parseLeadingNumber(input: string, allowFractions: boolean): ParsedNumber {
  const text = input.normalize("NFKC").replace(MINUS, "-").trim();
  const mixed = /^([+-]?)\s*(\d+)\s+(\d+)\s*\/\s*(\d+)(?![\d.])/.exec(text);
  const fraction = /^([+-]?)\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)(?![\d.])/.exec(text);
  const fractional = mixed ?? fraction;
  if (fractional) {
    if (!allowFractions) {
      return {
        ok: false,
        code: "fraction_not_allowed",
        reason: `Fractions such as "${fractional[0].trim()}" are not accepted here. Give the answer as a decimal number.`,
      };
    }
    const whole = mixed ? Number(mixed[2]) : 0;
    const top = Number((mixed ? mixed[3] : fraction?.[2]) as string);
    const bottom = Number((mixed ? mixed[4] : fraction?.[3]) as string);
    if (bottom === 0) {
      return {
        ok: false,
        code: "zero_denominator",
        reason: "A fraction cannot have 0 underneath.",
      };
    }
    return {
      ok: true,
      value: (fractional[1] === "-" ? -1 : 1) * (whole + top / bottom),
      decimals: 6,
      sigFigs: 6,
      rest: text.slice(fractional[0].length).trim(),
      wasFraction: true,
    };
  }
  const match =
    /^([+-]?)\s*([\d.,]*\d[\d.,]*|[.,]\d+)(?:[eE]([+-]?\d+)|\s*[x×*]\s*10\s*\^?\s*([+-]?\d+))?/.exec(
      text,
    );
  if (!match) {
    return {
      ok: false,
      code: "no_number",
      reason: "No number found. Start the answer with a number, for example 2.5 mg.",
    };
  }
  const numberText = match[2] as string;
  // Do not swallow the full stop that ends a sentence: "250." is 250.
  const cleaned = cleanNumberToken(numberText);
  if (cleaned === null) {
    return { ok: false, code: "bad_number", reason: `"${numberText}" is not a number I can read.` };
  }
  const exponent = Number(match[3] ?? match[4] ?? 0);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 300) {
    return { ok: false, code: "bad_number", reason: "The power of ten is out of range." };
  }
  const value = (match[1] === "-" ? -1 : 1) * Number(cleaned) * 10 ** exponent;
  if (!Number.isFinite(value)) {
    return { ok: false, code: "bad_number", reason: "That number is too large." };
  }
  const { decimals, sigFigs } = precisionOf(cleaned, exponent);
  return {
    ok: true,
    value,
    decimals,
    sigFigs,
    rest: text.slice(match[0].length).trim(),
    wasFraction: false,
  };
}

/** Round half away from zero to a number of decimal places (negative places round to tens, hundreds...). */
export function roundDecimals(x: number, places: number): number {
  const f = 10 ** places;
  return (Math.sign(x) * Math.round(Math.abs(x) * f * (1 + 1e-12))) / f;
}

/** Round to a number of significant figures. */
export function roundSigFigs(x: number, figures: number): number {
  if (x === 0) return 0;
  const magnitude = Math.floor(Math.log10(Math.abs(x)));
  return roundDecimals(x, figures - 1 - magnitude);
}

/** Show a number without floating-point noise and without an exponent for ordinary sizes. */
export function formatNumber(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  if (x === 0) return "0";
  const abs = Math.abs(x);
  if (abs >= 1e15 || abs < 1e-6) return x.toExponential(6).replace(/\.?0+e/, "e");
  const s = Number(x.toPrecision(10)).toString();
  return s.includes("e") ? x.toFixed(10).replace(/\.?0+$/, "") : s;
}
