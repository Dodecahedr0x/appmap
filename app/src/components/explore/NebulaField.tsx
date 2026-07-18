"use client";

import { useRef } from "react";
import { useShaderBackground } from "@/lib/useShaderBackground";

// Procedural deep-space backdrop: a slow domain-warped fbm "nebula" tinted
// toward DESIGN.md's nebula gradient (#3245ff -> #b845ed) over the void
// canvas/abyss surfaces. No star grid — it sits directly behind the
// force-directed map's own nodes/edges, and a twinkling starfield there
// competed with the real data for attention.
const FRAGMENT_SRC = `#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;

out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.55;
  for (int i = 0; i < 5; i++) {
    v += amp * noise(p);
    p *= 2.03;
    amp *= 0.55;
  }
  return v;
}

void main() {
  vec2 fragPx = gl_FragCoord.xy;
  vec2 uv = fragPx / u_resolution.xy;
  vec2 p = (fragPx - 0.5 * u_resolution.xy) / u_resolution.y;

  vec3 col = mix(vec3(0.047, 0.059, 0.098), vec3(0.122, 0.137, 0.180), uv.y);

  vec2 warp = p * 1.6 + vec2(u_time * 0.012, -u_time * 0.008);
  float n = fbm(warp + fbm(warp * 1.3 + 4.0));
  vec3 nebA = vec3(0.196, 0.271, 1.0);
  vec3 nebB = vec3(0.722, 0.271, 0.929);
  vec3 nebula = mix(nebA, nebB, clamp(n * 1.3 - 0.15, 0.0, 1.0));
  col += nebula * smoothstep(0.32, 0.82, n) * 0.5;

  float vignette = smoothstep(1.05, 0.35, length(p));
  col *= mix(0.7, 1.0, vignette);

  outColor = vec4(col, 1.0);
}`;

/**
 * Decorative animated nebula background for the Explore maps panel — a
 * single fullscreen-triangle WebGL2 fragment shader, procedural (no image
 * assets). Purely visual chrome behind the actual data canvas, so it's
 * aria-hidden; if WebGL2 is unavailable or the shader fails to
 * compile/link, it silently renders nothing and the panel's own CSS gradient
 * background carries the look on its own instead of throwing. See
 * `useShaderBackground` for the compile/resize/lifecycle plumbing shared
 * with `ConstellationField` (the About page's hero shader).
 */
export function NebulaField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useShaderBackground(canvasRef, FRAGMENT_SRC);
  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}
