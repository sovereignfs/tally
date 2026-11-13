/**
 * The app's mark, a tally of five: four strokes and a fifth across them, in `currentColor`. The same shape as `public/icons/icon.svg`, for the
 * places that have room for it (sign-in).
 */
export function TallyMark({ size = 40 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      role="img"
      aria-label="Tally"
      fill="none"
      stroke="currentColor"
      strokeWidth={32}
      strokeLinecap="round"
    >
      <path d="M168 136v240M224 136v240M280 136v240M336 136v240" />
      <path d="M120 344l272-176" />
    </svg>
  );
}
