"use client";

import { useRef } from "react";
import { useShaderBackground } from "@/lib/useShaderBackground";

// The About hero's signature visual: a domain-warped fbm nebula wash in
// DESIGN.md's gradient colors (no star grid), plus a GPU-driven
// "constellation" layer — a small set of
// nodes that drift and connect to their nearest neighbors, redrawing every
// frame. Purely procedural (no per-node JS state, no data), but it's the
// clearest one-shader illustration of what the product actually is: a
// living network of things discovering their neighbors.
const NODE_COUNT = 10;

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

// Each node wanders on its own slow, looping orbit around a per-node home
// point — deterministic from its index (via hash21), so nothing needs to be
// passed in from JS and every reload starts from the same, still-organic
// layout.
vec2 nodePos(int i, float t) {
  float fi = float(i);
  vec2 home = vec2(hash21(vec2(fi, 11.0)), hash21(vec2(fi, 29.0))) * 1.7 - 0.85;
  float speed = 0.05 + 0.05 * hash21(vec2(fi, 41.0));
  float phase = hash21(vec2(fi, 53.0)) * 6.2831;
  vec2 orbit = vec2(cos(t * speed + phase), sin(t * speed * 0.85 + phase * 1.4)) * 0.16;
  return home + orbit;
}

// Distance from point p to the segment a-b, plus how far along the segment
// (0 at a, 1 at b) the closest point sits — used to draw a glowing line
// between two connected nodes whose width tapers with edgeWidth() below, so
// it reads as thickest right at each node and thinnest at the midpoint.
vec2 segDistT(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return vec2(length(pa - ba * h), h);
}

// Edge glow half-width at parameter t along the segment (0 = midpoint, 1 =
// at a node) — tapers the line so it's visibly thicker approaching either
// endpoint instead of a uniform pixel width end to end.
float edgeWidth(float t) {
  float towardNode = abs(2.0 * t - 1.0);
  return mix(0.0022, 0.0078, towardNode);
}

void main() {
  vec2 fragPx = gl_FragCoord.xy;
  vec2 uv = fragPx / u_resolution.xy;
  vec2 p = (fragPx - 0.5 * u_resolution.xy) / u_resolution.y;

  vec3 col = mix(vec3(0.031, 0.035, 0.067), vec3(0.071, 0.067, 0.106), uv.y);

  vec2 warp = p * 1.3 + vec2(u_time * 0.009, -u_time * 0.006);
  float n = fbm(warp + fbm(warp * 1.3 + 4.0));
  vec3 nebA = vec3(0.184, 0.239, 1.0);
  vec3 nebB = vec3(0.788, 0.247, 0.949);
  vec3 nebula = mix(nebA, nebB, clamp(n * 1.3 - 0.15, 0.0, 1.0));
  col += nebula * smoothstep(0.42, 0.88, n) * 0.3;

  vec2 nodes[${NODE_COUNT}];
  for (int i = 0; i < ${NODE_COUNT}; i++) nodes[i] = nodePos(i, u_time);

  vec3 edgeColor = vec3(0.227, 0.659, 1.0);
  float edgeGlow = 0.0;
  for (int i = 0; i < ${NODE_COUNT}; i++) {
    for (int j = i + 1; j < ${NODE_COUNT}; j++) {
      float d = distance(nodes[i], nodes[j]);
      float within = smoothstep(0.55, 0.0, d);
      if (within > 0.0) {
        vec2 sdt = segDistT(p, nodes[i], nodes[j]);
        edgeGlow += within * smoothstep(edgeWidth(sdt.y), 0.0, sdt.x) * 0.7;
      }
    }
  }
  col += edgeColor * edgeGlow;

  vec3 nodeMint = vec3(0.180, 0.969, 0.776);
  vec3 nodeViolet = vec3(0.604, 0.616, 1.0);
  float nodeGlow = 0.0;
  vec3 nodeTint = vec3(0.0);
  for (int i = 0; i < ${NODE_COUNT}; i++) {
    float d = length(p - nodes[i]);
    float pulse = 0.65 + 0.35 * sin(u_time * 1.1 + float(i) * 1.9);
    float core = smoothstep(0.028, 0.0, d) * pulse;
    float halo = smoothstep(0.09, 0.0, d) * 0.35 * pulse;
    float contribution = core + halo;
    nodeGlow += contribution;
    nodeTint += mix(nodeMint, nodeViolet, hash21(vec2(float(i), 61.0))) * contribution;
  }
  col += nodeTint;

  float vignette = smoothstep(1.1, 0.3, length(p));
  col *= mix(0.68, 1.0, vignette);

  outColor = vec4(col, 1.0);
}`;

/**
 * The About page hero's WebGL2 backdrop — see the module comment above for
 * what it's actually drawing. Graceful degradation: aria-hidden, and if
 * WebGL2/compilation fails it draws nothing, leaving the hero's CSS
 * gradient to carry the look alone.
 */
export function ConstellationField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useShaderBackground(canvasRef, FRAGMENT_SRC);
  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}
