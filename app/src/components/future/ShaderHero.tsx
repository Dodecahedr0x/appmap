"use client";

import { useEffect, useRef, useState } from "react";

const VERTEX_SRC = `#version 300 es
// Fullscreen triangle — no vertex buffer needed.
void main() {
  vec2 pos = vec2(
    (gl_VertexID == 2) ? 3.0 : -1.0,
    (gl_VertexID == 1) ? 3.0 : -1.0
  );
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;

// A field of drifting, domain-warped nodes and connective glow — standing in
// for nebulous.world's tag graph: many small apps, linked and weighted by the crowd.
const FRAGMENT_SRC = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uMouse;
uniform float uMotion; // 0 = reduced motion, 1 = full

out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amp * noise(p);
    p *= 2.02;
    amp *= 0.55;
  }
  return value;
}

// Domain-warped fbm: feed fbm's output back in as a coordinate offset to get
// the folded, nebula-like structure instead of flat noise.
float warped(vec2 p, float t) {
  vec2 q = vec2(fbm(p + vec2(0.0, 0.0) + t), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + 4.0 * q + vec2(1.7, 9.2) + 0.15 * t), fbm(p + 4.0 * q + vec2(8.3, 2.8)));
  return fbm(p + 4.0 * r);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  vec2 mouse = (uMouse - 0.5 * uResolution) / uResolution.y;

  float t = uTime * 0.06 * uMotion;
  float pull = clamp(1.0 - length(uv - mouse) * 1.1, 0.0, 1.0);
  vec2 p = uv * 1.6 + pull * (mouse - uv) * 0.3;

  float w = warped(p, t);

  // Dock's hero palette (see DESIGN.md): cream canvas lifted through the
  // hero's signature sky-blue-to-lavender-mist gradient in the folds,
  // cobalt reserved for the sparse node glints below — the single accent
  // color, used sparingly, not washed across the whole field.
  vec3 cream = vec3(0.980, 0.976, 0.969);
  vec3 skyBlue = vec3(0.835, 0.925, 1.0);
  vec3 mist = vec3(0.957, 0.941, 1.0);

  vec3 col = mix(cream, skyBlue, smoothstep(0.25, 0.62, w));
  col = mix(col, mist, smoothstep(0.55, 0.95, w) * 0.7);

  // Sparse procedural node glints: a jittered grid, each cell lit if a hashed
  // threshold passes, brightness modulated by the warped field so glints
  // cluster inside the bright folds — "apps" sitting on the graph. Mixed
  // toward cobalt (not added) since additive light on an already-pale base
  // would just blow out to white instead of reading as a glint.
  vec2 grid = uv * 14.0;
  vec2 cell = floor(grid);
  vec2 cellUv = fract(grid) - 0.5;
  vec2 jitter = vec2(hash(cell), hash(cell + 11.0)) - 0.5;
  float d = length(cellUv - jitter * 0.6);
  float node = smoothstep(0.09, 0.0, d) * step(0.55, hash(cell + 3.1));
  float glintBoost = smoothstep(0.2, 0.8, w);
  vec3 cobalt = vec3(0.0, 0.408, 0.976);
  col = mix(col, cobalt, node * glintBoost * 0.85);

  // Fade toward pure cream at the edges (rather than darkening, which would
  // read as a muddy vignette on a light field) so overlaid text stays on a
  // flat, legible background near the margins.
  float vig = smoothstep(1.05, 0.2, length(uv * vec2(1.0, 1.15)));
  col = mix(cream, col, vig);

  fragColor = vec4(col, 1.0);
}
`;

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * Full-viewport WebGL2 shader background: domain-warped fbm "graph" field
 * with mouse-reactive node glints. Falls back to a static CSS gradient if
 * WebGL2 or shader compilation is unavailable, and freezes on the first
 * frame under prefers-reduced-motion.
 */
export function ShaderHero() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
    if (!gl) {
      setFailed(true);
      return;
    }

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
    if (!vs || !fs) {
      setFailed(true);
      return;
    }

    const program = gl.createProgram();
    if (!program) {
      setFailed(true);
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      setFailed(true);
      return;
    }
    gl.useProgram(program);

    const uResolution = gl.getUniformLocation(program, "uResolution");
    const uTime = gl.getUniformLocation(program, "uTime");
    const uMouse = gl.getUniformLocation(program, "uMouse");
    const uMotion = gl.getUniformLocation(program, "uMotion");

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const mouse = { x: 0, y: 0 };

    function resize() {
      if (!canvas || !gl) return;
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width * dpr));
      height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      if (mouse.x === 0 && mouse.y === 0) {
        mouse.x = width / 2;
        mouse.y = height / 2;
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      mouse.x = (e.clientX - rect.left) * dpr;
      mouse.y = (rect.height - (e.clientY - rect.top)) * dpr;
    }

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    let raf = 0;
    const start = performance.now();
    let visible = true;
    const io = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
    });
    io.observe(canvas);

    function frame(now: number) {
      if (!gl) return;
      if (visible) {
        gl.uniform2f(uResolution, width, height);
        gl.uniform1f(uTime, (now - start) / 1000);
        gl.uniform2f(uMouse, mouse.x, mouse.y);
        gl.uniform1f(uMotion, reduceMotion ? 0.0 : 1.0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      if (!reduceMotion) {
        raf = requestAnimationFrame(frame);
      }
    }
    if (reduceMotion) {
      // Paint exactly one frame so the field isn't blank, then stop.
      frame(performance.now());
    } else {
      raf = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, []);

  return (
    <div className="hero-canvas-wrap" aria-hidden="true">
      {!failed && <canvas ref={canvasRef} className="hero-canvas" />}
      {failed && <div className="hero-canvas-fallback" />}
    </div>
  );
}
