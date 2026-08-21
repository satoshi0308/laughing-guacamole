const common = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

const paths = {
  link: (
    <>
      <path d="M10.4 13.6 13.6 10" />
      <path d="M7.7 15.8 6 17.5a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 4.9 0" />
      <path d="m12.1 9.5.9-1a3.5 3.5 0 1 1 5 5l-3 3a3.5 3.5 0 0 1-4.9 0" />
    </>
  ),
  search: (
    <>
      <circle cx="8.7" cy="8.7" r="5.7" />
      <path d="m13 13 4.6 4.6" />
    </>
  ),
  book: (
    <>
      <path d="M3 4.2h5.2A2.8 2.8 0 0 1 11 7v10a2.8 2.8 0 0 0-2.8-2.8H3z" />
      <path d="M17 4.2h-5.2A2.8 2.8 0 0 0 9 7v10a2.8 2.8 0 0 1 2.8-2.8H17z" />
    </>
  ),
  download: (
    <>
      <path d="M10 2.5v10" />
      <path d="m6.5 9.5 3.5 3.5 3.5-3.5" />
      <path d="M3 15v2.5h14V15" />
    </>
  ),
  external: (
    <>
      <path d="M11 3h6v6" />
      <path d="m9 11 8-8" />
      <path d="M16 11v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" />
    </>
  ),
  chevron: <path d="m7.5 4.5 5 5.5-5 5.5" />,
  close: (
    <>
      <path d="m4 4 12 12" />
      <path d="M16 4 4 16" />
    </>
  ),
  alert: (
    <>
      <circle cx="10" cy="10" r="8" />
      <path d="M10 5.5v5.5" />
      <path d="M10 14.5h.01" />
    </>
  ),
  warning: (
    <>
      <path d="M8.4 3.1 1.8 15a2 2 0 0 0 1.7 3h13a2 2 0 0 0 1.7-3L11.6 3.1a1.8 1.8 0 0 0-3.2 0Z" />
      <path d="M10 7v4" />
      <path d="M10 14.5h.01" />
    </>
  ),
  check: (
    <>
      <circle cx="10" cy="10" r="8" />
      <path d="m6.4 10 2.2 2.2 4.9-5" />
    </>
  ),
  info: (
    <>
      <circle cx="10" cy="10" r="8" />
      <path d="M10 9v5" />
      <path d="M10 5.7h.01" />
    </>
  ),
  shield: (
    <>
      <path d="M10 2.2 16 4.8v4.7c0 4.1-2.5 6.8-6 8.3-3.5-1.5-6-4.2-6-8.3V4.8z" />
      <path d="m7.3 10 1.8 1.8 3.7-4" />
    </>
  ),
  file: (
    <>
      <path d="M5 2.5h6l4 4v11H5z" />
      <path d="M11 2.5v4h4" />
      <path d="M7.8 11h4.5M7.8 14h4.5" />
    </>
  ),
};

export function Icon({ name, size = 20, className = "", title }) {
  return (
    <svg
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={className}
      height={size}
      role={title ? "img" : undefined}
      viewBox="0 0 20 20"
      width={size}
      {...common}
    >
      {title ? <title>{title}</title> : null}
      {paths[name] || paths.info}
    </svg>
  );
}

export function PulseMark() {
  return (
    <span className="pulse-mark" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
