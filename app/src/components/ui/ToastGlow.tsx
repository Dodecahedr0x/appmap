"use client";

import { useEffect, useRef } from "react";

// Not built on lib/useShaderBackground.ts (the shared lifecycle
// ConstellationField uses): that hook creates its WebGL2 context with
// `alpha: false`, correct for a full-bleed opaque background but wrong
// here — this canvas is a translucent glow composited *over* the toast
// card's own background, not a replacement for it, so it needs its own
// alpha-blended context (see the `alpha`/`premultipliedAlpha`/`BLEND`
// setup below).
//
// Fullscreen-triangle trick (see about/ConstellationField.tsx) — 3
// hardcoded clip-space vertices via gl_VertexID, covering the whole canvas
// with no vertex buffer needed.
const VERTEX_SRC = `#version 300 es
void main() {
  vec2 pos[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  gl_Position = vec4(pos[gl_VertexID], 0.0, 1.0);
}`;

// A single soft, slowly breathing glow anchored near the toast's icon —
// a quiet accent, not a distraction from the message. Alpha-only output
// (RGB is the toast kind's color, passed in) so it composites over the
// card's own background rather than painting a rectangle.
const FRAGMENT_SRC = `#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_color;

out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 center = vec2(0.09 + 0.012 * sin(u_time * 0.6), 0.5 + 0.04 * sin(u_time * 0.9 + 1.7));
  vec2 d = uv - center;
  d.x *= aspect;
  float dist = length(d);
  float pulse = 0.85 + 0.15 * sin(u_time * 1.4);
  float glow = smoothstep(0.55 * pulse, 0.0, dist);
  outColor = vec4(u_color, glow * 0.5);
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
 * A single breathing glow behind a toast card — purely decorative, aria-
 * hidden. If WebGL2 is unavailable or the shader fails to compile/link, it
 * silently renders nothing and the card's own background/border carry the
 * look on their own instead of throwing.
 */
export function ToastGlow({ color }: { color: readonly [number, number, number] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      alpha: true,
      premultipliedAlpha: false,
    });
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
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const resolutionLoc = gl.getUniformLocation(program, "u_resolution");
    const timeLoc = gl.getUniformLocation(program, "u_time");
    const colorLoc = gl.getUniformLocation(program, "u_color");
    gl.uniform3f(colorLoc, color[0], color[1], color[2]);

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;

    function drawFrame(t: number) {
      gl!.clearColor(0, 0, 0, 0);
      gl!.clear(gl!.COLOR_BUFFER_BIT);
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
      if (reduceMotion) drawFrame(0);
    }

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    let raf = 0;
    let stopped = false;
    const start = performance.now();
    if (reduceMotion) {
      drawFrame(0);
    } else {
      const frame = (now: number) => {
        if (stopped) return;
        drawFrame((now - start) / 1000);
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    }

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [color]);

  return <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 h-full w-full" />;
}
