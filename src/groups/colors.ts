/**
 * The colour of a group (DESIGN.md §7.1): **any colour**, written `#rrggbb`, shown as the group's dot. A person picks one with `ColorPicker`, which
 * offers these as suggestions and a free choice beside them. Copied from Tusk's colours of a list: the design system has no palette of accent tokens,
 * and a colour a person chose is data, drawn as a dot and never as a background or the colour of text, which keeps light and dark mode readable.
 */
export const HEX_COLOR = /^#[0-9a-f]{6}$/;

/** The suggestions `ColorPicker` offers, in order. A group may be any colour at all, not only these. */
export const SWATCHES: readonly { label: string; value: string }[] = [
  { label: 'Grey', value: '#6b7280' },
  { label: 'Red', value: '#dc2626' },
  { label: 'Orange', value: '#ea580c' },
  { label: 'Amber', value: '#d97706' },
  { label: 'Green', value: '#16a34a' },
  { label: 'Teal', value: '#0d9488' },
  { label: 'Blue', value: '#2563eb' },
  { label: 'Violet', value: '#7c3aed' },
  { label: 'Pink', value: '#db2777' },
];

export const DEFAULT_COLOR = '#2563eb';

export function isGroupColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value);
}
