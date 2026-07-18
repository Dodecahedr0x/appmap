"use client";

import { useRef } from "react";
import { useShaderBackground } from "@/lib/useShaderBackground";

// The About hero's signature visual: the same nebula/starfield language as
// NebulaField (deep space wash + domain-warped fbm nebula in DESIGN.md's
// gradient colors), plus a GPU-driven "constellation" layer — a small set of
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

float starLayer(vec2 fragPx, float cellSize, float density, float twinkleSpeed, float t) {
  vec2 cell = floor(fragPx / cellSize);
  float present = step(1.0 - density, hash21(cell));
  vec2 jitter = vec2(hash21(cell + 11.0), hash21(cell + 37.0));
  vec2 starPos = (cell + jitter) * cellSize;
  float d = length(fragPx - starPos);
  float size = mix(0.6, 1.4, hash21(cell + 71.0));
  float twinkle = 0.5 + 0.5 * sin(t * twinkleSpeed + hash21(cell) * 6.2831);
  float glow = smoothstep(size, 0.0, d) * mix(0.35, 1.0, twinkle);
  return present * glow;
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

// Distance from point p to the segment a-b — used to draw a thin glowing
// line between two connected nodes.
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  vec2 fragPx = gl_FragCoord.xy;
  vec2 uv = fragPx / u_resolution.xy;
  vec2 p = (fragPx - 0.5 * u_resolution.xy) / u_resolution.y;

  vec3 col = mix(vec3(0.047, 0.059, 0.098), vec3(0.11, 0.10, 0.16), uv.y);

  vec2 warp = p * 1.3 + vec2(u_time * 0.009, -u_time * 0.006);
  float n = fbm(warp + fbm(warp * 1.3 + 4.0));
  vec3 nebA = vec3(0.196, 0.271, 1.0);
  vec3 nebB = vec3(0.722, 0.271, 0.929);
  vec3 nebula = mix(nebA, nebB, clamp(n * 1.3 - 0.15, 0.0, 1.0));
  col += nebula * smoothstep(0.42, 0.88, n) * 0.3;

  float s = 0.0;
  s += starLayer(fragPx, 34.0, 0.10, 1.0, u_time);
  s += starLayer(fragPx + 500.0, 16.0, 0.05, 1.5, u_time) * 0.6;
  col += vec3(0.9, 0.95, 1.0) * s;

  vec2 nodes[${NODE_COUNT}];
  for (int i = 0; i < ${NODE_COUNT}; i++) nodes[i] = nodePos(i, u_time);

  vec3 edgeColor = vec3(0.33, 0.73, 1.0);
  float edgeGlow = 0.0;
  for (int i = 0; i < ${NODE_COUNT}; i++) {
    for (int j = i + 1; j < ${NODE_COUNT}; j++) {
      float d = distance(nodes[i], nodes[j]);
      float within = smoothstep(0.55, 0.0, d);
      if (within > 0.0) {
        float sd = segDist(p, nodes[i], nodes[j]);
        edgeGlow += within * smoothstep(0.005, 0.0, sd) * 0.7;
      }
    }
  }
  col += edgeColor * edgeGlow;

  vec3 nodeMint = vec3(0.29, 0.95, 0.78);
  vec3 nodeViolet = vec3(0.67, 0.69, 1.0);
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
 * what it's actually drawing. Same graceful-degradation contract as
 * NebulaField: aria-hidden, and if WebGL2/compilation fails it draws
 * nothing, leaving the hero's CSS gradient to carry the look alone.
 */
export function ConstellationField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useShaderBackground(canvasRef, FRAGMENT_SRC);
  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}
