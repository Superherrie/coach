// Small stroke icon set (24px grid) — keeps the bundle free of an icon library.
const PATHS: Record<string, string> = {
  today: 'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10l1.4 1.4M5.6 18.4L7 17m10-10l1.4-1.4M12 8a4 4 0 100 8 4 4 0 000-8z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4m8-4v4',
  chart: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  chat: 'M4 5h16v11H9l-5 4V5z',
  plus: 'M12 5v14M5 12h14',
  settings: 'M12 9a3 3 0 100 6 3 3 0 000-6zm8 3l2-1-2-4-2 1a7 7 0 00-2-1l-.5-2h-5L10 7a7 7 0 00-2 1l-2-1-2 4 2 1a7 7 0 000 2l-2 1 2 4 2-1a7 7 0 002 1l.5 2h5l.5-2a7 7 0 002-1l2 1 2-4-2-1a7 7 0 000-2z',
  run: 'M13 4a1.5 1.5 0 103 0 1.5 1.5 0 00-3 0M7 21l3-6 3 2v5m-6-11l3-3 4 1 2 4 3 1M10 15l1-5',
  bike: 'M5.5 17.5a3.5 3.5 0 100-.01M18.5 17.5a3.5 3.5 0 100-.01M5.5 17.5L9 9h5l4.5 8.5M9 9l3 8.5h-6.5M14 6h2',
  dumbbell: 'M3 10v4m3-6v8m0-4h12m0-4v8m3-6v4',
  stretch: 'M12 4a1.5 1.5 0 100 3 1.5 1.5 0 000-3M5 21l4-7 3 1 3-1 4 7M12 9v6',
  moon: 'M20 14A8 8 0 0110 4a8 8 0 1010 10z',
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
  sync: 'M4 12a8 8 0 0113.7-5.7L20 9m0-5v5h-5M20 12a8 8 0 01-13.7 5.7L4 15m0 5v-5h5',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z',
  scale: 'M5 5h14l1 14H4zM9 9a3 3 0 006 0',
  left: 'M15 5l-7 7 7 7', right: 'M9 5l7 7-7 7', close: 'M6 6l12 12M18 6L6 18', check: 'M5 12l5 5 9-10',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4', trash: 'M5 7h14M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3',
  out: 'M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4M10 8l-4 4 4 4m-4-4h11',
  send: 'M4 12l16-8-6 16-2-7z', lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3',
  camera: 'M4 8h3l2-3h6l2 3h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1zm8 3a3.5 3.5 0 100 7 3.5 3.5 0 000-7z',
  mic: 'M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM5 11a7 7 0 0014 0M12 18v3',
  food: 'M7 3v8a2 2 0 002 2v8M5 3v5M9 3v5M17 3c-2 0-3 3-3 6s1 4 3 4v8',
}

export default function Icon({ name, size = 20, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={PATHS[name] ?? ''} />
    </svg>
  )
}

/** the app mark: a road climbing to a summit flag */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="16" fill="#0f1f33" />
      <path d="M8 50 L24 30 L32 38 L44 20 L56 50 Z" fill="#1d3a5f" />
      <path d="M14 50 C24 44 30 40 34 34 S42 24 44 20" fill="none" stroke="#e8642c" strokeWidth="4" strokeLinecap="round" />
      <path d="M44 20 V8 h9 l-3 3 3 3 h-9" fill="#f4f5f2" />
    </svg>
  )
}
