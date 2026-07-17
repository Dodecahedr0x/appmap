// CSS Houdini Paint Worklet — a generative dot-field divider between
// sections. Registered from ModeMorph/FutureExperience via
// CSS.paintWorklet.addModule when the browser supports it; the CSS side
// always ships a gradient fallback via @supports.
class DotFieldPainter {
  static get inputProperties() {
    return ["--dot-color", "--dot-density"];
  }

  paint(ctx, size, props) {
    const color = props.get("--dot-color").toString().trim() || "#0068f9";
    const density = parseFloat(props.get("--dot-density").toString()) || 18;
    const spacing = Math.max(10, density);

    ctx.fillStyle = color;
    for (let y = spacing / 2; y < size.height; y += spacing) {
      for (let x = spacing / 2; x < size.width; x += spacing) {
        const wobble = Math.sin((x * 0.7 + y * 1.3) / 28) * 0.5 + 0.5;
        const radius = 0.5 + wobble * 1.4;
        ctx.globalAlpha = 0.25 + wobble * 0.55;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

registerPaint("dotfield", DotFieldPainter);
