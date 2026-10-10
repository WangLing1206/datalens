import type { SVGProps } from 'react';

/**
 * Inline icon set.
 *
 * Hand-rolled rather than pulling in an icon package: we only need ~50 glyphs,
 * and this keeps the bundle small and the stroke weight consistent with the
 * rest of the design system (1.6px on a 24px grid).
 */

const PATHS: Record<string, string> = {
  // navigation
  overview: 'M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z',
  table: 'M3 5h18v14H3V5Zm0 5h18M3 15h18M9 5v14M15 5v14',
  broom: 'M14 4l6 6-4 1-1 4-6-6 5-5Zm-7 7 6 6-3 3-3-3-3 1 1-3-1-1 3-3Z',
  sigma: 'M18 5H7l6 7-6 7h11',
  group: 'M4 6h6v5H4V6Zm10 0h6v5h-6V6ZM4 13h6v5H4v-5Zm10 0h6v5h-6v-5Z',
  grid: 'M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z',
  scatter: 'M4 20V4m0 16h16M8 16l3-5 3 3 4-7',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5v4l3 2',
  chart: 'M4 20V4m0 16h16M8 17v-5m4 5V8m4 9v-3',
  brain: 'M9 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5.8V16a3 3 0 0 0 4 2.8V4Zm6 0a3 3 0 0 1 3 3 3 3 0 0 1 1 5.8V16a3 3 0 0 1-4 2.8V4Z',
  report: 'M6 3h9l4 4v14H6V3Zm9 0v4h4M9 12h7M9 16h7M9 8h3',
  // actions
  upload: 'M12 16V4m0 0L8 8m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  download: 'M12 4v12m0 0 4-4m-4 4-4-4M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2',
  copy: 'M9 9h10v10H9V9Zm-2 6H5V5h10v2',
  check: 'M5 12.5 9.5 17 19 7',
  x: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  trash: 'M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13',
  undo: 'M9 14 4 9l5-5M4 9h9a7 7 0 0 1 0 14H8',
  redo: 'M15 14l5-5-5-5m5 5h-9a7 7 0 0 0 0 14h5',
  refresh: 'M20 11a8 8 0 1 0-2 6m2-6v-4m0 4h-4',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 4 4',
  filter: 'M4 5h16l-6 7v6l-4 2v-8L4 5Z',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm8 3-2 .6-.5 1.3 1 1.8-1.7 1.7-1.8-1-1.3.5L13 20h-2l-.6-2-1.3-.5-1.8 1L5.6 17l1-1.8-.5-1.3L4 13v-2l2-.6.5-1.3-1-1.8L7.2 5.6l1.8 1 1.3-.5L11 4h2l.6 2 1.3.5 1.8-1 1.7 1.7-1 1.8.5 1.3L20 11v2Z',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronUp: 'M6 15l6-6 6 6',
  arrowRight: 'M5 12h14m0 0-5-5m5 5-5 5',
  arrowUp: 'M12 19V5m0 0-6 6m6-6 6 6',
  arrowDown: 'M12 5v14m0 0 6-6m-6 6-6-6',
  sortAsc: 'M7 20V6m0 0L3 10m4-4 4 4M14 8h7M14 12h5M14 16h3',
  sortDesc: 'M7 4v14m0 0-4-4m4 4 4-4M14 8h3M14 12h5M14 16h7',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v.5m0 3.5v5',
  alert: 'M12 4 2 20h20L12 4Zm0 6v5m0 3v.5',
  bulb: 'M9 18h6m-5 3h4M12 3a6 6 0 0 1 3.5 10.9V16h-7v-2.1A6 6 0 0 1 12 3Z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 3a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z',
  layers: 'M12 3 3 8l9 5 9-5-9-5Zm-9 8 9 5 9-5m-18 5 9 5 9-5',
  eye: 'M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6Zm10-2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  eyeOff: 'M4 4l16 16M9.5 9.6A2 2 0 0 0 12 14a2 2 0 0 0 1.4-.6M6.3 6.5C3.8 8.1 2 12 2 12s4 6 10 6c1.7 0 3.2-.4 4.5-1M11 6.1c.3 0 .7-.1 1-.1 6 0 10 6 10 6s-1 1.5-2.7 3',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c-3 3.5-3 14.5 0 18m0-18c3 3.5 3 14.5 0 18M3.5 9h17M3.5 15h17',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z',
  code: 'M9 7l-5 5 5 5m6-10 5 5-5 5',
  lock: 'M6 11h12v9H6v-9Zm3 0V8a3 3 0 0 1 6 0v3',
  database: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3ZM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  file: 'M6 3h8l4 4v14H6V3Zm8 0v4h4',
  keyboard: 'M3 7h18v10H3V7Zm3 3h.5M9 10h.5M12 10h.5M15 10h.5M18 10h.5M7 13.5h10',
  pause: 'M8 5h3v14H8V5Zm5 0h3v14h-3V5Z',
  play: 'M7 4l13 8-13 8V4Z',
  crop: 'M6 2v16h16M2 6h16v16',
  columns: 'M4 4h6v16H4V4Zm10 0h6v16h-6V4Z',
  wand: 'M15 4l5 5-9 9-5-5 9-9Zm-9 9-3 7 7-3M18 3v3m0 0v3m0-3h3m-3 0h-3',
  flask: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3M7.5 14h9',
  percent: 'M6 6a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm12 9a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM5 19 19 5',
  link: 'M10 13a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L11.5 6M14 11a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 19.7L12.5 18',
  pin: 'M12 17v5M8 3h8l-1 6 3 3v2H6v-2l3-3-1-6Z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  panelRight: 'M3 4h18v16H3V4Zm11 0v16',
  drag: 'M9 5h.5M14 5h.5M9 12h.5M14 12h.5M9 19h.5M14 19h.5',
  history: 'M12 7v5l3 2M3.5 12a8.5 8.5 0 1 1 2.5 6M3 18v-5h5',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.5M3.5 12h.5M3.5 18h.5',
  axes: 'M4 4v16h16M8 4v16M4 8h16M4 16h16',
  ruler: 'M3 9h18v6H3V9Zm4 0v3m4-3v3m4-3v3m4-3v3',
  zoomIn: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 4 4M8 11h6m-3-3v6',
  zoomOut: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 4 4M8 11h6',
  book: 'M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 0-2 2V5Zm2 14h13',
  scale: 'M12 4v16M7 8l-4 8h8L7 8Zm10 0-4 8h8l-4-8ZM5 20h14',
};

export type IconName = keyof typeof PATHS;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: string;
  size?: number;
  /** Stroke width; filled icons ignore it. */
  weight?: number;
}

/** Icons drawn as filled shapes rather than strokes. */
const FILLED = new Set(['overview', 'table', 'group', 'grid', 'chart', 'layers', 'columns', 'play', 'pin', 'axes', 'pause']);

export function Icon({ name, size = 16, weight = 1.6, ...rest }: IconProps) {
  const d = PATHS[name] ?? PATHS.info;
  const filled = FILLED.has(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={d} />
    </svg>
  );
}

export const ICON_NAMES = Object.keys(PATHS) as IconName[];
