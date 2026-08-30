const VERTEX_SOURCE = `
attribute vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SOURCE = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_dark;

vec3 spectrum(float value) {
  vec3 phase = vec3(0.0, 2.1, 4.2);
  return 0.58 + 0.42 * cos(6.28318 * value + phase);
}

float softBand(float distance, float width, float feather) {
  return 1.0 - smoothstep(width - feather, width, abs(distance));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 point = uv - 0.5;
  point.x *= u_resolution.x / u_resolution.y;
  float aspect = u_resolution.x / u_resolution.y;
  float wide = smoothstep(0.55, 1.35, aspect);

  // 果冻般的强烈扭曲，让彩虹像液体一样流动
  vec2 warp = 0.16 * vec2(
    sin(point.y * 6.0 + u_time * 1.8),
    cos(point.x * 6.0 - u_time * 1.4)
  );
  vec2 q = point + warp;
  float radius = length(q);
  float angle = atan(q.y, q.x);

  // 万花筒：三折对称 + 旋转彩虹漩涡
  float fold = abs(mod(angle, 1.0472) - 0.5236);
  float spiral = fold / 1.0472 + radius * 3.0 - u_time * 0.35;
  vec3 kaleido = spectrum(spiral + u_time * 0.06);
  float kaleidoMask = softBand(radius, mix(0.55, 0.65, wide), 0.4) * 0.55;

  // 主彩虹弧（保留契约标识符）
  vec2 center = vec2(
    0.10 + 0.06 * sin(u_time * 0.5),
    mix(-0.53, -0.73, wide) + 0.07 * cos(u_time * 0.4)
  );
  float arcRadius = mix(0.68, 0.86, wide) + 0.045 * sin(u_time * 1.3);
  float arcDistance = length(q - center) - arcRadius;
  float arc = softBand(arcDistance, mix(0.13, 0.21, wide), 0.032);
  float arcFade = smoothstep(-0.18, 0.12, q.y);
  float arcColor = arcDistance / 0.38 + u_time * 0.07;
  vec3 rainbowArc = spectrum(arcColor);
  float arcOpacity = arc * arcFade * mix(0.72, 0.88, u_dark);

  // 反向旋转的第二层光环
  float ring = softBand(abs(radius - mix(0.42, 0.55, wide)), 0.055, 0.022);
  vec3 ringColor = spectrum(-angle / 6.28318 + u_time * 0.12);
  float ringOpacity = ring * smoothstep(0.45, 0.9, radius) * mix(0.35, 0.5, u_dark);

  // 放射状频闪
  float flash = 0.5 + 0.5 * sin(u_time * 9.0 + radius * 9.0);
  float glint = pow(1.0 - abs(radius - mix(0.62, 0.72, wide)), 8.0) * flash;

  // 扫描线
  float scan = 0.5 + 0.5 * sin(q.y * 180.0 + u_time * 14.0);
  float scanLine = mix(1.0, 0.9, scan * 0.35);

  vec3 paper = mix(vec3(1.0), vec3(0.035), u_dark);
  vec3 color = mix(paper, rainbowArc, arcOpacity);
  color = mix(color, ringColor, ringOpacity);
  color = mix(color, kaleido, kaleidoMask);
  color += rainbowArc * glint * mix(0.35, 0.55, u_dark);
  color *= scanLine;

  gl_FragColor = vec4(color, 1.0);
}
`;

/**
 * @typedef {object} PrismShaderController
 * @property {() => void} destroy
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {PrismShaderController | null}
 */
function initPrismShader(canvas) {
  const parent = canvas.parentElement;
  const setFallback = () => {
    if (parent) parent.dataset.shaderState = "fallback";
  };

  /** @type {WebGLRenderingContext | null} */
  let gl = null;
  try {
    gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
    });
  } catch {
    setFallback();
    return null;
  }

  if (!gl) {
    setFallback();
    return null;
  }

  /** @param {number} type @param {string} source */
  function compileShader(type, source) {
    const shader = gl.createShader(type);
    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("Prism shader compilation failed:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  const vertexShader = compileShader(gl.VERTEX_SHADER, VERTEX_SOURCE);
  const fragmentShader = compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SOURCE);
  if (!vertexShader || !fragmentShader) {
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
    setFallback();
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    setFallback();
    return null;
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Prism shader linking failed:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    setFallback();
    return null;
  }

  const positionBuffer = gl.createBuffer();
  const positionLocation = gl.getAttribLocation(program, "a_position");
  const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
  const timeLocation = gl.getUniformLocation(program, "u_time");
  const darkLocation = gl.getUniformLocation(program, "u_dark");
  if (
    !positionBuffer ||
    positionLocation < 0 ||
    !resolutionLocation ||
    !timeLocation ||
    !darkLocation
  ) {
    if (positionBuffer) gl.deleteBuffer(positionBuffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    setFallback();
    return null;
  }

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const state = { animationFrame: 0, destroyed: false };

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(bounds.width * pixelRatio));
    const height = Math.max(1, Math.round(bounds.height * pixelRatio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    gl.viewport(0, 0, width, height);
  }

  /** @param {number} time */
  function draw(time) {
    resize();
    gl.useProgram(program);
    gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
    gl.uniform1f(timeLocation, reducedMotion.matches ? 0 : time * 0.001);
    gl.uniform1f(
      darkLocation,
      document.documentElement.dataset.theme === "dark" ? 1 : 0,
    );
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    canvas.dataset.shaderFrame = String(Number(canvas.dataset.shaderFrame ?? "0") + 1);
  }

  /** @param {number} time */
  function animate(time) {
    state.animationFrame = 0;
    if (state.destroyed || document.visibilityState === "hidden") return;
    draw(time);
    if (!reducedMotion.matches) {
      state.animationFrame = requestAnimationFrame(animate);
    }
  }

  function start() {
    if (
      state.destroyed ||
      state.animationFrame ||
      document.visibilityState === "hidden"
    ) return;
    state.animationFrame = requestAnimationFrame(animate);
  }

  function stop() {
    if (!state.animationFrame) return;
    cancelAnimationFrame(state.animationFrame);
    state.animationFrame = 0;
  }

  function handleVisibility() {
    if (document.visibilityState === "hidden") stop();
    else start();
  }

  function handleMotionChange() {
    stop();
    start();
  }

  function handleResize() {
    resize();
    if (reducedMotion.matches && document.visibilityState !== "hidden") draw(0);
  }

  function handleThemeChange() {
    if (reducedMotion.matches && document.visibilityState !== "hidden") draw(0);
  }

  const resizeObserver =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(handleResize);
  const themeObserver = new MutationObserver(handleThemeChange);

  if (resizeObserver) resizeObserver.observe(canvas);
  else window.addEventListener("resize", handleResize);
  document.addEventListener("visibilitychange", handleVisibility);
  reducedMotion.addEventListener("change", handleMotionChange);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  resize();
  if (parent) parent.dataset.shaderState = "running";
  start();

  return {
    destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      stop();
      resizeObserver?.disconnect();
      themeObserver.disconnect();
      if (!resizeObserver) window.removeEventListener("resize", handleResize);
      document.removeEventListener("visibilitychange", handleVisibility);
      reducedMotion.removeEventListener("change", handleMotionChange);
      gl.disableVertexAttribArray(positionLocation);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.useProgram(null);
      gl.deleteBuffer(positionBuffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      if (parent) parent.dataset.shaderState = "fallback";
    },
  };
}

globalThis.RainbowShader = { initPrismShader };

if (typeof document !== "undefined") {
  document.querySelectorAll("[data-prism-canvas]").forEach((canvas) => {
    if (canvas instanceof HTMLCanvasElement) initPrismShader(canvas);
  });
}
