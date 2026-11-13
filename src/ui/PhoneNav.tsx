'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Button, Drawer, Icon, MobileFooter, NavList } from '@sovereignfs/ui';
import { FOOTER_LEFT, FOOTER_RIGHT, placeById, placeOf, type Place } from './nav';
import styles from './AppShell.module.css';

/**
 * The phone's footer (DESIGN.md §15.11): Home and Groups left of the middle button, People and Activity right of it. The middle button opens a drawer
 * with Add expense and Insights until the floating Add button (14.3) and the avatar menu (2.6) take them. **The same places at the same addresses as the
 * sidebar**: only what is drawn differs, and the shell's CSS decides at which width (`AppShell.module.css`), so nothing here asks for the width.
 */
export function PhoneNav() {
  const [more, setMore] = useState(false);
  const current = placeOf(usePathname())?.id;
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
          <Button variant="primary" disabled title="Adding an expense arrives with the add sheet">
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
