import { describe, expect, it } from 'vitest';
import { FOOTER_LEFT, FOOTER_RIGHT, PLACES, SIDEBAR_PLACES, placeOf } from './nav';

describe('the places of the app', () => {
  it('are the five of the design, each with its own address', () => {
    expect(PLACES.map((place) => place.id)).toEqual([
      'home',
      'groups',
      'people',
      'activity',
      'insights',
    ]);
    expect(new Set(PLACES.map((place) => place.href)).size).toBe(5);
  });

  it('are all reachable at every width: the sidebar and its groups, or the footer and its drawer', () => {
    const wide = new Set([...SIDEBAR_PLACES, 'groups']);
    const phone = new Set([...FOOTER_LEFT, ...FOOTER_RIGHT, 'insights']);
    for (const place of PLACES) {
      expect(wide.has(place.id)).toBe(true);
      expect(phone.has(place.id)).toBe(true);
    }
    expect(FOOTER_LEFT.length).toBe(FOOTER_RIGHT.length);
  });

  it('are found by the path, and what is under a place is in it', () => {
    expect(placeOf('/')?.id).toBe('home');
    expect(placeOf('/groups')?.id).toBe('groups');
    expect(placeOf('/g/abc')?.id).toBe('groups');
    expect(placeOf('/g/abc/e/def')?.id).toBe('groups');
    expect(placeOf('/people/')?.id).toBe('people');
    expect(placeOf('/people/abc')?.id).toBe('people');
    expect(placeOf('/activity')?.id).toBe('activity');
    expect(placeOf('/insights')?.id).toBe('insights');
  });

  it('is not Home for every address, and not a place for a name that merely starts alike', () => {
    expect(placeOf('/peoples')).toBeUndefined();
    expect(placeOf('/gallery')).toBeUndefined();
    expect(placeOf('/settings')).toBeUndefined();
    expect(placeOf('/sign-in')).toBeUndefined();
  });
});
