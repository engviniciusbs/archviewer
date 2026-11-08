const PATHS = {
  check: 'M3.5 8.5l3 3 6-7',
  warning: 'M8 2.5l6 11H2l6-11zM8 6.5v3.5M8 12v.01',
  info: 'M8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13zM8 7.5v4M8 5v.01',
  chevron: 'M6 3.5L10.5 8 6 12.5',
  search: 'M7 12.5A5.5 5.5 0 1 0 7 1.5a5.5 5.5 0 0 0 0 11zM11 11l3.5 3.5',
  folder: 'M1.5 4.5v8h13v-7H8L6.5 3.5h-5v1z',
  file: 'M3.5 1.5h6l3 3v10h-9v-13zM9.5 1.5v3h3',
  package: 'M2 5l6-3 6 3v6l-6 3-6-3V5zM2 5l6 3 6-3M8 8v6',
  cycle: 'M13 8a5 5 0 0 1-9 3M3 8a5 5 0 0 1 9-3M12 2v3h-3M4 14v-3h3',
} as const;

export type IconName = keyof typeof PATHS;

/** Ícone de traço em 16px; decorativo, o texto ao lado carrega o sentido. */
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
