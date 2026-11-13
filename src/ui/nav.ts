import type { IconName } from '@sovereignfs/ui';

/**
 * One place in the app (DESIGN.md §15.2, §15.3), at the same address at every width: the sidebar of a wide screen draws Home, People, Activity and
 * Insights, with the groups in their own section; the phone's footer draws Home and Groups, People and Activity, and its drawer Insights
 * (§15.11). Only what is drawn differs.
 */
export interface Place {
  id: 'home' | 'groups' | 'people' | 'activity' | 'insights';
  label: string;
  href: string;
  icon: IconName;
}

export const PLACES: readonly Place[] = [
  { id: 'home', label: 'Home', href: '/', icon: 'house' },
  { id: 'groups', label: 'Groups', href: '/groups', icon: 'layers' },
  { id: 'people', label: 'People', href: '/people', icon: 'users' },
  { id: 'activity', label: 'Activity', href: '/activity', icon: 'activity' },
  // The design system has no chart icon yet; the charts of epic 14 are the place to add one.
  { id: 'insights', label: 'Insights', href: '/insights', icon: 'layout-dashboard' },
];

export function placeById(id: Place['id']): Place {
  const place = PLACES.find((each) => each.id === id);
  if (!place) throw new Error(`no such place: ${id}`);
  return place;
}

/** The places the sidebar lists, in order: the groups are its own section below them. */
export const SIDEBAR_PLACES: readonly Place['id'][] = ['home', 'people', 'activity', 'insights'];

/** The phone's footer: two places on each side of the middle button (`MobileFooter` wants as many on each side). */
export const FOOTER_LEFT: readonly Place['id'][] = ['home', 'groups'];
export const FOOTER_RIGHT: readonly Place['id'][] = ['people', 'activity'];

/**
 * The place a path is in, or none: a place and everything under it. A group's own pages (`/g/<id>`) are in Groups. Home is `/` alone, since every
 * address starts with it. Pure, so that the rule is tested with no browser.
 */
export function placeOf(pathname: string): Place | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (path === '/g' || path.startsWith('/g/')) return placeById('groups');
  return PLACES.find((place) =>
    place.href === '/' ? path === '/' : path === place.href || path.startsWith(`${place.href}/`),
  );
}
