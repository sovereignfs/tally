import { describe, expect, it } from 'vitest';
import { type Minor, toMinor } from './amount';

const m = (value: number) => toMinor(value);
import { CURRENCY_OPTIONS, currencyDecimals } from './currencies';
import { decimalText, formatMoney, parseAmount } from './text';

/** `Intl` writes a no-break space where a person sees a space, which a test should not have to type. */
const plain = (text: string) => text.replace(new RegExp('[\u00a0\u202f]', 'g'), ' ');

describe('the decimal text of an amount', () => {
  it('is exact, with the currency’s own number of decimals', () => {
    expect(decimalText(m(340), 'EUR')).toBe('3.40');
    expect(decimalText(m(-340), 'EUR')).toBe('-3.40');
    expect(decimalText(m(5), 'EUR')).toBe('0.05');
    expect(decimalText(m(0), 'EUR')).toBe('0.00');
    expect(decimalText(m(1500), 'JPY')).toBe('1500');
    expect(decimalText(m(1005), 'BHD')).toBe('1.005');
    expect(decimalText(m(Number.MAX_SAFE_INTEGER), 'EUR')).toBe('90071992547409.91');
  });

  it('refuses what is not an amount', () => {
    expect(() => decimalText(12.5 as Minor, 'EUR')).toThrow();
  });
});

describe('an amount as it is read', () => {
  it('has the currency’s own decimals: ¥1,500 reads ¥1,500 and not ¥15, and 1.005 BHD keeps its three', () => {
    expect(plain(formatMoney(m(1500), 'JPY', 'en'))).toBe('¥1,500');
    expect(plain(formatMoney(m(1005), 'BHD', 'en'))).toBe('BHD 1.005');
    expect(plain(formatMoney(m(340), 'EUR', 'en'))).toBe('€3.40');
    expect(plain(formatMoney(m(-340), 'EUR', 'en'))).toBe('-€3.40');
    expect(plain(formatMoney(m(0), 'USD', 'en'))).toBe('$0.00');
  });

  it('is written with a locale’s own marks', () => {
    expect(plain(formatMoney(m(123_456), 'EUR', 'de'))).toBe('1.234,56 €');
    expect(plain(formatMoney(m(123_456), 'EUR', 'fr'))).toBe('1 234,56 €');
  });

  it('is exact for an amount a float could not hold', () => {
    expect(plain(formatMoney(m(Number.MAX_SAFE_INTEGER), 'EUR', 'en'))).toBe(
      '€90,071,992,547,409.91',
    );
  });
});

describe('an amount as it is typed', () => {
  it('is read into minor units, digit by digit', () => {
    expect(parseAmount('3.40', 'EUR', 'en')).toBe(340);
    expect(parseAmount('3.4', 'EUR', 'en')).toBe(340);
    expect(parseAmount('3', 'EUR', 'en')).toBe(300);
    expect(parseAmount('.5', 'EUR', 'en')).toBe(50);
    expect(parseAmount('1,234.56', 'EUR', 'en')).toBe(123_456);
    expect(parseAmount('  12  ', 'EUR', 'en')).toBe(1200);
    expect(parseAmount('1500', 'JPY', 'en')).toBe(1500);
    expect(parseAmount('1.005', 'BHD', 'en')).toBe(1005);
  });

  it('follows the locale’s decimal mark, so that "1.234" is a thousand in German and a euro and a bit in English', () => {
    expect(parseAmount('1.234,56', 'EUR', 'de')).toBe(123_456);
    expect(parseAmount('1234,5', 'EUR', 'de')).toBe(123_450);
    expect(parseAmount('1 234,56', 'EUR', 'fr')).toBe(123_456);
    expect(parseAmount('1.234', 'EUR', 'de')).toBe(123_400);
    // A comma typed where it is the grouping mark is not read as a decimal mark: refused, so that 3,40 is never 340.
    expect(parseAmount('3,40', 'EUR', 'en')).toBeNull();
    expect(parseAmount('3.40', 'EUR', 'de')).toBeNull();
  });

  it('reads a minus, and "-0" is zero and not a negative zero', () => {
    expect(parseAmount('-3.40', 'EUR', 'en')).toBe(-340);
    expect(parseAmount('−3.40', 'EUR', 'en')).toBe(-340);
    expect(Object.is(parseAmount('-0', 'EUR', 'en'), 0)).toBe(true);
  });

  it('refuses what is not an amount, and more decimals than the currency has, which it does not round', () => {
    for (const text of [
      '',
      ' ',
      '-',
      '.',
      'abc',
      '3.4.5',
      '3,40,1',
      '12e3',
      '1 2 x',
      '3.405',
      '€3.40',
    ])
      expect(parseAmount(text, 'EUR', 'en'), JSON.stringify(text)).toBeNull();
    expect(parseAmount('1500.5', 'JPY', 'en')).toBeNull();
    expect(parseAmount('1.0055', 'BHD', 'en')).toBeNull();
  });

  it('refuses a number too large to be exact', () => {
    expect(parseAmount('90071992547409.91', 'EUR', 'en')).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseAmount('90071992547409.92', 'EUR', 'en')).toBeNull();
    expect(parseAmount('9'.repeat(40), 'EUR', 'en')).toBeNull();
  });

  it('round-trips every currency: what is read of what was written is the amount', () => {
    for (const { code } of CURRENCY_OPTIONS)
      for (const minor of [0, 1, 99, 12_345, -12_345, 123_456_789])
        expect(parseAmount(decimalText(m(minor), code), code, 'en'), `${code} ${minor}`).toBe(
          minor,
        );
    expect(currencyDecimals('JPY')).toBe(0);
  });
});

describe('an amount, from typing to minor units to text and back', () => {
  const cases = [
    { currency: 'JPY', en: '1,500', de: '1.500', minor: 1500 },
    { currency: 'EUR', en: '1,234.56', de: '1.234,56', minor: 123456 },
    { currency: 'BHD', en: '1.005', de: '1,005', minor: 1005 },
  ] as const;

  for (const { currency, en, de, minor } of cases) {
    it(`round-trips ${currency} in English and in German`, () => {
      for (const [locale, typed] of [
        ['en', en],
        ['de', de],
      ] as const) {
        const parsed = parseAmount(typed, currency, locale);
        expect(parsed, `${locale} ${typed}`).toBe(minor);
        if (parsed === null) throw new Error('not parsed');
        const shown = plain(formatMoney(parsed, currency, locale));
        // What is shown, without its currency sign, is read back as the same amount.
        const digits = shown.replace(/[^0-9.,]/g, '');
        expect(parseAmount(digits, currency, locale), `${locale} ${shown}`).toBe(minor);
      }
    });
  }
});
