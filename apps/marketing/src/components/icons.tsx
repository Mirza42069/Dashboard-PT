type IconProps = React.ComponentProps<"svg">;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

export function ArrowRight(props: IconProps) {
  return <Icon {...props}><path d="M5 12h14M13 6l6 6-6 6" /></Icon>;
}

export function ArrowDown(props: IconProps) {
  return <Icon {...props}><path d="M12 5v14M6 13l6 6 6-6" /></Icon>;
}

export function Check(props: IconProps) {
  return <Icon {...props}><path d="m5 12 4 4L19 6" /></Icon>;
}

export function Menu(props: IconProps) {
  return <Icon {...props}><path d="M4 7h16M4 12h16M4 17h16" /></Icon>;
}

export function X(props: IconProps) {
  return <Icon {...props}><path d="m6 6 12 12M18 6 6 18" /></Icon>;
}

export function HardHat(props: IconProps) {
  return <Icon {...props}><path d="M4 17h16M6 17v-3a6 6 0 0 1 12 0v3M9 14V9m6 5V9M3 19h18" /></Icon>;
}

export function Clipboard(props: IconProps) {
  return <Icon {...props}><path d="M9 5h6M9 3h6v4H9zM7 5H5v16h14V5h-2M8 12h8M8 16h6" /></Icon>;
}

export function Alert(props: IconProps) {
  return <Icon {...props}><path d="M12 3 2.8 20h18.4zM12 9v4M12 17h.01" /></Icon>;
}

export function Camera(props: IconProps) {
  return <Icon {...props}><path d="M4 8h3l1.5-2h7L17 8h3v11H4z" /><circle cx="12" cy="13" r="3" /></Icon>;
}

export function Lock(props: IconProps) {
  return <Icon {...props}><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></Icon>;
}

export function Chart(props: IconProps) {
  return <Icon {...props}><path d="M4 19V5M4 19h16M7 15l4-5 3 2 5-7" /></Icon>;
}

export function File(props: IconProps) {
  return <Icon {...props}><path d="M6 3h8l4 4v14H6zM14 3v5h5M9 13h6M9 17h5" /></Icon>;
}
