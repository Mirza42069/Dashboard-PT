/**
 * Progressive blur over the bottom edge of the viewport.
 *
 * One backdrop-filter cannot ramp — it is uniform across its own box, so a
 * single layer leaves a hard line where it starts. Six layers of increasing
 * blur, each masked to a window that slides down the strip, make the
 * transition continuous.
 *
 * Purely decorative and pointer-transparent. The six <i>s carry no meaning of
 * their own and are styled by :nth-child in globals.css, the same way
 * .window-controls is.
 */
export function GradualBlur() {
  return (
    <div className="gradual-blur" aria-hidden>
      <i />
      <i />
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}
