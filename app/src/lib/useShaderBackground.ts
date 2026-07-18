"use client";

import { useEffect, type RefObject } from "react";

// Fullscreen-triangle trick: 3 hardcoded clip-space vertices via
// gl_VertexID, covering the whole viewport with no vertex buffer needed.
const VERTEX_SRC = `#version 300 es
void main() {
  vec2 pos[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  gl_Position = vec4(pos[gl_VertexID], 0.0, 1.0);
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
 * Shared WebGL2 lifecycle for a fullscreen-triangle fragment shader that
 * only needs `u_resolution`/`u_time` — compile/link, DPR-capped resize,
 * pause-when-off-screen, and prefers-reduced-motion all live here once so
 * every decorative shader background (NebulaField, ConstellationField, ...)
 * doesn't reimplement it. Fails silently (draws nothing) if WebGL2 is
 * unavailable or `fragmentSrc` doesn't compile/link — the caller's own CSS
 * background is expected to carry the look on its own in that case.
 */
export function useShaderBackground(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  fragmentSrc: string,
) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
    if (!gl) return;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc);
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
    // fragmentSrc is expected to be a module-level constant (a template
    // literal recreated on every render would otherwise tear down and
    // recompile the shader every frame).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef, fragmentSrc]);
}
