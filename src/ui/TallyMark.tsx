/**
 * The app's mark, two arrows exchanging (the plugin's icon, carried over as the app's), in `currentColor`. The same shape as `public/icons/icon.svg`,
 * for the places that have room for it (sign-in).
 */
export function TallyMark({ size = 40 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role="img"
      aria-label="Tally"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 3 3 7l4 4" />
      <path d="M3 7h11a4 4 0 0 1 4 4v1" />
      <path d="M17 21l4-4-4-4" />
      <path d="M21 17H10a4 4 0 0 1-4-4v-1" />
    </svg>
  );
}
