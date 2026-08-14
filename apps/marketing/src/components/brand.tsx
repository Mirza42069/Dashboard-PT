export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className="brand" data-inverse={inverse || undefined}>
      <span className="brand-mark" aria-hidden>
        <span>V2</span>
        <i />
      </span>
      <span className="brand-name">V2</span>
    </span>
  );
}
