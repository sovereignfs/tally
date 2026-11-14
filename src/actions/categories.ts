/**
 * The fixed list of categories (DESIGN.md §8.4), as stored. Custom categories are not in phase 1. Each is shown with a design-system icon and a word,
 * which the screens map; the stored value never changes.
 */
export const CATEGORIES = [
  'general',
  'groceries',
  'eating_out',
  'rent',
  'utilities',
  'transport',
  'travel',
  'entertainment',
  'shopping',
  'health',
  'gifts',
  'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const DEFAULT_CATEGORY: Category = 'general';

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}
