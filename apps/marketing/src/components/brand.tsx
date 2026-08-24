import { Logo } from "./logo";

/**
 * The Fushin AI lockup: mark plus wordmark.
 *
 * "AI" is a separate element so it can sit back a step from "Fushin" — the name
 * is Fushin, the AI is what it does. `.brand-word i` in globals.css fades it off
 * currentColor rather than a fixed token, so the pairing survives `inverse`.
 */
export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className="brand" data-inverse={inverse || undefined}>
      <Logo size={26} className="brand-mark" />
      <span className="brand-word">Fushin <i>AI</i></span>
    </span>
  );
}
