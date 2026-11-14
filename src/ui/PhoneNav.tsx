'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button, Drawer, FloatingActionButton, Icon, MobileFooter, NavList } from '@sovereignfs/ui';
import { goLocally, sheetHref } from '../screens/AddSheet';
import { FOOTER_LEFT, FOOTER_RIGHT, placeById, placeOf, type Place } from './nav';
import styles from './AppShell.module.css';

/**
 * The phone's footer (DESIGN.md §15.11): Home and Groups left of the middle button, People and Activity right of it, and the floating **Add** above it,
 * which opens the add sheet (a drawer at this width) with the page's group filled in. The middle button opens a drawer with Add expense and Insights
 * (which is also in the avatar menu). **The same places at the same addresses as the
 * sidebar**: only what is drawn differs, and the shell's CSS decides at which width (`AppShell.module.css`), so nothing here asks for the width.
 */
export function PhoneNav() {
  const [more, setMore] = useState(false);
  const pathname = usePathname();
  const params = useSearchParams();
  const current = placeOf(pathname)?.id;
  const group = /^\/g\/([^/]+)/.exec(pathname)?.[1];
  const add = () =>
    goLocally(
      sheetHref(pathname, new URLSearchParams(params.toString()), {
        add: 'expense',
        ...(group ? { g: group } : {}),
      }),
    );
  const icon = (id: Place['id']) => {
    const place = placeById(id);
    return {
      icon: <Icon name={place.icon} aria-hidden />,
      label: place.label,
      href: place.href,
      active: current === place.id,
    };
  };
  const insights = placeById('insights');
  return (
    <>
      <FloatingActionButton
        label="Add expense"
        icon={<Icon name="plus" aria-hidden />}
        onClick={add}
      />
      <MobileFooter
        aria-label="Main"
        onOpenApps={() => setMore(true)}
        launcherOpen={more}
        launcherIcon={<Icon name="menu" aria-hidden />}
        leftIcons={FOOTER_LEFT.map(icon)}
        rightIcons={FOOTER_RIGHT.map(icon)}
      />
      <Drawer open={more} onClose={() => setMore(false)} aria-label="More">
        <div className={styles.more}>
          <Button
            variant="primary"
            onClick={() => {
              setMore(false);
              add();
            }}
          >
            Add expense
          </Button>
          <NavList
            aria-label="More places"
            variant="static"
            groups={[{ id: 'more', items: [{ ...insights, active: current === 'insights' }] }]}
            renderLink={(item, linkProps) => (
              <Link {...linkProps} href={item.href} onClick={() => setMore(false)}>
                {linkProps.children}
              </Link>
            )}
          />
        </div>
      </Drawer>
    </>
  );
}
