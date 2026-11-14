import type { IconName } from '@sovereignfs/ui';
import type { Category } from '../actions/categories';

/**
 * The words and icons of the categories (DESIGN.md §8.4). The stored value never changes; these are how a screen shows it. The icons are the nearest the
 * design system has (it has no receipt, cart or bus yet, worth adding there).
 */
export const CATEGORY_VIEW: Record<Category, { label: string; icon: IconName }> = {
  general: { label: 'General', icon: 'file-text' },
  groceries: { label: 'Groceries', icon: 'shopping-basket' },
  eating_out: { label: 'Eating out', icon: 'pizza' },
  rent: { label: 'Rent', icon: 'house' },
  utilities: { label: 'Utilities', icon: 'settings-2' },
  transport: { label: 'Transport', icon: 'route' },
  travel: { label: 'Travel', icon: 'luggage' },
  entertainment: { label: 'Entertainment', icon: 'wine' },
  shopping: { label: 'Shopping', icon: 'credit-card' },
  health: { label: 'Health', icon: 'shield' },
  gifts: { label: 'Gifts', icon: 'package' },
  other: { label: 'Other', icon: 'rectangle-ellipsis' },
};
