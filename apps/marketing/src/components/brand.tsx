import { Logo } from "./logo";

/**
 * The Fushin lockup: mark plus wordmark. Mirrors apps/web/src/components/brand.tsx
 * so the marketing nav and the product sidebar read as the same brand.
 */
export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className="brand" data-inverse={inverse || undefined}>
      <Logo size={26} className="brand-mark" />
      <span className="brand-word">Fushin</span>
    </span>
  );
}
