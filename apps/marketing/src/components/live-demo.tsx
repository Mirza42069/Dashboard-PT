"use client";

import { useEffect, useRef, useState } from "react";

import type { Content } from "@/lib/content";

import { Check, Lock, Refresh } from "./icons";

const STEP_MS = 1100;

/**
 * The reporting-period runner: baseline → actuals → review → lock.
 *
 * It starts when it scrolls into view rather than on mount — a runner that has
 * already finished by the time the reader reaches it demonstrates nothing.
 *
 * Under `prefers-reduced-motion` it jumps straight to the completed state. The
 * point of the panel is the sequence of steps, and that stays legible without
 * the animation; the repo suppresses motion elsewhere the same way.
 */
export function LiveDemo({ t }: { t: Content }) {
  const steps = t.liveDemo.steps;
  const total = steps.length;

  const rootRef = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const [run, setRun] = useState(0);
  const [done, setDone] = useState(0);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || started) return;
    if (typeof IntersectionObserver === "undefined") {
      setStarted(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDone(total);
      return;
    }
    setDone(0);
    let step = 0;
    const timer = setInterval(() => {
      step += 1;
      setDone(step);
      if (step >= total) clearInterval(timer);
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [started, run, total]);

  const complete = done >= total;
  const percent = Math.round((done / total) * 100);

  return (
    <div className="runner" ref={rootRef} data-complete={complete || undefined}>
      <div className="runner-top">
        <div>
          <strong aria-live="polite">
            {complete ? t.liveDemo.complete : t.liveDemo.running}
          </strong>
        </div>
        <span className="runner-percent">{percent}%</span>
      </div>

      <div
        className="runner-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={t.liveDemo.title}
      >
        <i style={{ width: `${percent}%` }} />
      </div>

      <ol className="runner-steps">
        {steps.map((step, index) => {
          const state = index < done ? "done" : index === done && !complete ? "active" : "idle";
          return (
            <li key={step.label} data-state={state}>
              <span className="runner-tick" aria-hidden>
                {state === "done" ? <Check /> : <i />}
              </span>
              <span className="runner-label">
                <b>{step.label}</b>
                <small>{step.detail}</small>
              </span>
            </li>
          );
        })}
      </ol>

      <div className="runner-foot">
        <span>
          {complete ? <Lock /> : null}
          {complete ? t.liveDemo.duration : `${done}/${total}`}
        </span>
        <button type="button" onClick={() => setRun((value) => value + 1)} disabled={!complete}>
          <Refresh />
          {t.liveDemo.replay}
        </button>
      </div>
    </div>
  );
}
