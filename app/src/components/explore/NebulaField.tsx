"use client";

import { useEffect, useRef } from "react";

// Fullscreen-triangle trick: 3 hardcoded clip-space vertices via
// gl_VertexID, covering the whole viewport with no vertex buffer needed.
const VERTEX_SRC = `#version 300 es
void main() {
  vec2 pos[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  gl_Position = vec4(pos[gl_VertexID], 0.0, 1.0);
}`;

// Procedural deep-space backdrop: a slow domain-warped fbm "nebula" tinted
// toward DESIGN.md's nebula gradient (#3245ff -> #b845ed) over the void
// canvas/abyss surfaces, plus two layered star grids (one hashed point per
// grid cell, so cost stays O(1) per pixel regardless of star count) with a
// gentle per-star twinkle.
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
  float size = mix(0.6, 1.6, hash21(cell + 71.0));
  float twinkle = 0.5 + 0.5 * sin(t * twinkleSpeed + hash21(cell) * 6.2831);
  float glow = smoothstep(size, 0.0, d) * mix(0.35, 1.0, twinkle);
  return present * glow;
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

  float s = 0.0;
  s += starLayer(fragPx, 30.0, 0.12, 1.1, u_time);
  s += starLayer(fragPx + 500.0, 14.0, 0.06, 1.6, u_time) * 0.7;
  col += vec3(0.9, 0.95, 1.0) * s;

  float vignette = smoothstep(1.05, 0.35, length(p));
  col *= mix(0.7, 1.0, vignette);

  outColor = vec4(col, 1.0);
}`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * Decorative animated nebula/starfield background for the Explore maps
 * panel — a single fullscreen-triangle WebGL2 fragment shader, procedural
 * (no image assets). Purely visual chrome behind the actual data canvas, so
 * it's aria-hidden; if WebGL2 is unavailable or the shader fails to
 * compile/link, it silently renders nothing and the panel's own CSS gradient
 * background carries the look on its own instead of throwing.
 */
export function NebulaField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
    if (!gl) return;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
    if (!vs || !fs) return;
    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
      return;
    }
    gl.useProgram(program);
    const resolutionLoc = gl.getUniformLocation(program, "u_resolution");
    const timeLoc = gl.getUniformLocation(program, "u_time");

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;

    function drawFrame(t: number) {
      gl!.uniform2f(resolutionLoc, width, height);
      gl!.uniform1f(timeLoc, t);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    }

    function resize() {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width * dpr));
      height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.width = width;
      canvas.height = height;
      gl!.viewport(0, 0, width, height);
      // A resize needs a repaint even in reduced-motion mode, where there's
      // no running rAF loop to pick it up on its own.
      if (reduceMotion) drawFrame(0);
    }

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    let onScreen = true;
    const io = new IntersectionObserver((entries) => {
      onScreen = entries[0]?.isIntersecting ?? true;
    });
    io.observe(canvas);

    let raf = 0;
    let stopped = false;
    const start = performance.now();
    if (reduceMotion) {
      drawFrame(0);
    } else {
      const frame = (now: number) => {
        if (stopped) return;
        if (onScreen) drawFrame((now - start) / 1000);
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    }

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}
