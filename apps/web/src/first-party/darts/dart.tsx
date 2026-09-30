"use client";

/**
 * Dart artwork (SVG). Board darts are drawn in board millimetres with the
 * tip at (0, 0): seen from the oche they point back at you, so you mostly
 * see the flights as an X hanging just above the tip. The hand dart is a
 * big profile view for the throwing zone.
 */

import { useId } from "react";

/** Flight colours by seat. */
export const FLIGHT_COLORS = ["#35d7ff", "#ff5ca8", "#c6ff3d", "#ffb03d", "#a98bff", "#ffffff", "#ff7a4d", "#3dffb5"];

export function flightColor(seat: number): string {
  return FLIGHT_COLORS[((seat % FLIGHT_COLORS.length) + FLIGHT_COLORS.length) % FLIGHT_COLORS.length]!;
}

/** Shared gradients for every dart on the page (rendered once, invisible). */
export function DartDefs() {
  return (
    <svg aria-hidden width="0" height="0" className="absolute">
      <defs>
        <linearGradient id="dart-steel" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8d949d" />
          <stop offset="0.45" stopColor="#f4f6f8" />
          <stop offset="1" stopColor="#6b7178" />
        </linearGradient>
        <linearGradient id="dart-tungsten" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#23262b" />
          <stop offset="0.35" stopColor="#8a9098" />
          <stop offset="0.55" stopColor="#4c5158" />
          <stop offset="1" stopColor="#1b1d21" />
        </linearGradient>
        <linearGradient id="dart-gloss" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.65" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.08" />
          <stop offset="1" stopColor="#000" stopOpacity="0.25" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** How far (mm) and which way (degrees clockwise from up) a stuck dart's tail sits from its tip. */
export function tailFor(at: { x: number; y: number }, spin: number): { deg: number; length: number } {
  // Darts arrive on a slight arc, so tails sit up; perspective pushes them out from the centre of view.
  const out = { x: at.x * 0.0022, y: at.y * 0.0012 };
  const dir = { x: out.x + Math.sin(spin) * 0.08, y: -1 + out.y };
  return { deg: (Math.atan2(dir.x, -dir.y) * 180) / Math.PI, length: 27 };
}

/**
 * A dart stuck in the board (or in flight), in board mm, tip at the origin,
 * tail straight up (rotate the group to point it). `flightSpin` turns the X.
 */
export function BoardDartShape({ color, flightSpin = 0 }: { color: string; flightSpin?: number }) {
  return (
    <g>
      {/* point */}
      <path d="M0 0 L-0.7 -6 L0.7 -6 Z" fill="url(#dart-steel)" />
      {/* barrel with grip rings */}
      <path d="M-1.3 -6 L-2.3 -9 L-2.6 -15 L-1.6 -18.5 L1.6 -18.5 L2.6 -15 L2.3 -9 L1.3 -6 Z" fill="url(#dart-tungsten)" />
      <path d="M-2.4 -10.5 H2.4 M-2.5 -12.2 H2.5 M-2.5 -13.9 H2.5" stroke="#15171a" strokeWidth="0.45" opacity="0.8" />
      {/* shaft */}
      <rect x="-0.95" y="-24.5" width="1.9" height="6.4" rx="0.6" fill={color} stroke="#000" strokeOpacity="0.35" strokeWidth="0.3" />
      {/* flights: an X seen from behind */}
      <g transform={`translate(0 -26) rotate(${45 + flightSpin})`}>
        {[0, 90, 180, 270].map((r) => (
          <g key={r} transform={`rotate(${r})`}>
            <path d="M0 0 L3.4 -2.4 L3.9 -11 L0.4 -13 Z" fill={color} stroke="#000" strokeOpacity="0.4" strokeWidth="0.35" />
            <path d="M0 0 L3.4 -2.4 L3.9 -11 L0.4 -13 Z" fill="url(#dart-gloss)" />
          </g>
        ))}
        <circle r="1.1" fill="#111" />
      </g>
    </g>
  );
}

/** The dart's shadow on the board, cast down and to the right (key light top left). */
export function DartShadow() {
  return (
    <g opacity="0.3">
      <path d="M0 0 L9 13 L10.5 12 Z" fill="#000" />
      <ellipse cx="12" cy="16" rx="4.6" ry="2.6" transform="rotate(40 12 16)" fill="#000" />
    </g>
  );
}

/** Big profile dart for the throwing hand (tip up). */
export function HandDart({ color, className }: { color: string; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 44 176" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}-flight`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={color} />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor={color} />
        </linearGradient>
      </defs>
      {/* flights: two wings in profile, one edge-on */}
      <path d="M22 104 L5 150 L6 172 L22 160 Z" fill={color} stroke="#000" strokeOpacity="0.35" strokeWidth="0.8" />
      <path d="M22 104 L39 150 L38 172 L22 160 Z" fill={color} stroke="#000" strokeOpacity="0.35" strokeWidth="0.8" />
      <path d="M22 104 L5 150 L6 172 L22 160 Z" fill="url(#dart-gloss)" />
      <path d="M22 104 L39 150 L38 172 L22 160 Z" fill="url(#dart-gloss)" />
      <rect x="20.6" y="100" width="2.8" height="72" rx="1.2" fill={`url(#${id}-flight)`} />
      {/* shaft */}
      <rect x="18.5" y="74" width="7" height="32" rx="2" fill={color} stroke="#000" strokeOpacity="0.3" strokeWidth="0.6" />
      <rect x="19.5" y="75" width="2" height="30" rx="1" fill="#fff" opacity="0.35" />
      {/* barrel */}
      <path d="M17 30 L15 38 L15 66 L17.5 76 L26.5 76 L29 66 L29 38 L27 30 Z" fill="url(#dart-tungsten)" />
      {[42, 47, 52, 57, 62].map((y) => (
        <path key={y} d={`M15.4 ${y} H28.6`} stroke="#0f1114" strokeWidth="1.3" opacity="0.7" />
      ))}
      {/* point */}
      <path d="M22 0 L19.6 30 L24.4 30 Z" fill="url(#dart-steel)" />
    </svg>
  );
}
