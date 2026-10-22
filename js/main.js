/* 「强国"油"我」工作室官网 · 脚本 */
(function () {
'use strict';

/* ═══ liquid-chrome.js（石油 · 来自 ima 知识库，着色器未改） ═══ */
const LiquidChrome = (function(){
/**
 * LiquidChrome — 液态金属（石油质感）动态背景
 * ------------------------------------------------------------------
 * 来源：用户 ima 知识库《2026-10-18-LiquidChrome液态金属背景组件》
 * 本文件为「原封移植」：着色器源码、渲染管线、交互逻辑一行未改，
 * 仅把 React 封装换成原生 class（无 React 依赖）。
 *
 * 管线：SIM（波动场）→ SLOPE（梯度/法线）→ CHROME（金属打光）
 */

const PIXEL_BUDGET = 1.6e6;
const SIM_CELL = 4;
const SIM_STEP = 1 / 60;

const VERTEX = `#version 300 es
const vec2 corners[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() {
  gl_Position = vec4(corners[gl_VertexID], 0.0, 1.0);
}`;

const SIM = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform vec2 uSize;
uniform vec4 uStroke;
uniform vec2 uImpulse;
out vec4 fragColor;

float segment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
  return length(p - a - ab * t);
}

void main() {
  vec2 texel = 1.0 / uSize;
  vec2 uv = gl_FragCoord.xy * texel;
  vec2 state = texture(uState, uv).rg;
  vec2 around =
    texture(uState, uv - vec2(texel.x, 0.0)).rg +
    texture(uState, uv + vec2(texel.x, 0.0)).rg +
    texture(uState, uv - vec2(0.0, texel.y)).rg +
    texture(uState, uv + vec2(0.0, texel.y)).rg -
    4.0 * state;
  float next = state.r + (state.r - state.g) * 0.982 + 0.3 * around.r + 0.08 * (around.r - around.g);
  next *= 0.998;
  if (uImpulse.x != 0.0) {
    float d = segment(gl_FragCoord.xy, uStroke.xy, uStroke.zw) / uImpulse.y;
    next += uImpulse.x * exp(-d * d);
  }
  fragColor = vec4(next, state.r, 0.0, 1.0);
}`;

const SLOPE = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform vec2 uSize;
out vec4 fragColor;

void main() {
  vec2 texel = 1.0 / uSize;
  vec2 uv = gl_FragCoord.xy * texel;
  float left = texture(uState, uv - vec2(texel.x, 0.0)).r;
  float right = texture(uState, uv + vec2(texel.x, 0.0)).r;
  float down = texture(uState, uv - vec2(0.0, texel.y)).r;
  float up = texture(uState, uv + vec2(0.0, texel.y)).r;
  fragColor = vec4((right - left) * 0.5, (up - down) * 0.5, 0.0, 1.0);
}`;

const CHROME = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform float uUnit;
uniform float uTime;
uniform float uAmplitude;
uniform vec2 uFrequency;
uniform float uDetail;
uniform float uSharpness;
uniform float uDepth;
uniform float uPresence;
uniform vec3 uTint;
uniform vec2 uShift;
uniform float uRoughness;
uniform float uExposure;
uniform float uLight;
uniform sampler2D uSlope;
uniform vec2 uSlopeSize;
uniform float uRipple;
out vec4 fragColor;

vec2 slopeAt(vec2 uv) {
  vec2 st = uv * uSlopeSize - 0.5;
  vec2 i = floor(st);
  vec2 f = st - i;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (-f3 + 3.0 * f2 - 3.0 * f + 1.0) / 6.0;
  vec2 w1 = (3.0 * f3 - 6.0 * f2 + 4.0) / 6.0;
  vec2 w2 = (-3.0 * f3 + 3.0 * f2 + 3.0 * f + 1.0) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 h0 = (i - 0.5 + w1 / g0) / uSlopeSize;
  vec2 h1 = (i + 1.5 + w3 / g1) / uSlopeSize;
  vec2 a = texture(uSlope, vec2(h0.x, h0.y)).rg;
  vec2 b = texture(uSlope, vec2(h1.x, h0.y)).rg;
  vec2 c = texture(uSlope, vec2(h0.x, h1.y)).rg;
  vec2 d = texture(uSlope, vec2(h1.x, h1.y)).rg;
  return g0.y * (g0.x * a + g1.x * b) + g1.y * (g0.x * c + g1.x * d);
}

float lamp(vec2 p, vec2 center, vec2 size, float soft) {
  vec2 grown = size + soft;
  vec2 q = (p - center) / grown;
  q *= q;
  float d = sqrt(sqrt(dot(q, q)));
  float edge = soft / min(grown.x, grown.y);
  float shape = (1.0 - smoothstep(1.0 - edge, 1.0 + edge, d)) * (1.0 - 0.45 * d * d);
  return shape * size.x * size.y / (grown.x * grown.y);
}

vec3 studio(vec3 r, float blur) {
  vec2 p = r.xy / max(r.z + 1.0, 0.05);
  p += uShift * smoothstep(0.3, 1.0, length(p));
  float radius = length(p);
  float soft = 0.008 + blur;
  vec2 dir = p / max(radius, 1e-3);
  float key = lamp(p, vec2(-0.25, 0.42), vec2(0.3, 0.12), soft);
  float side = lamp(p, vec2(0.48, 0.12), vec2(0.06, 0.3), soft);
  float ground = lamp(p, vec2(-0.1, -0.55), vec2(0.45, 0.06), soft);
  float rise = smoothstep(-1.0, 1.0, dir.y);
  if (uLight > 0.5) {
    float edge = 0.008 + blur * 0.8;
    float lobe = smoothstep(0.15, 0.85, 0.5 + 0.5 * sin(atan(dir.y, dir.x) * 2.0 + 0.9));
    float tone = mix(2.4, 0.95, smoothstep(0.5 - edge, 1.0 + edge, radius));
    tone = mix(tone, 0.02, smoothstep(0.98 - edge, 1.12 + edge, radius));
    tone = mix(tone, mix(0.03, 0.3, lobe) * (0.8 + 0.4 * rise), smoothstep(1.15 - edge, 1.3 + edge, radius));
    float width = 0.035 + edge;
    tone += 2.4 * exp(-pow((radius - 1.4) / width, 2.0)) * min(1.0, 0.06 / width) * (0.6 + 0.4 * rise);
    return vec3(tone) * (1.0 - 0.5 * side) * (1.0 - 0.3 * ground) + 0.8 * key;
  }
  float width = 0.015 + soft * 2.0;
  float rim = exp(-abs(radius - 1.0) / width) * 0.031 / width * (0.8 + smoothstep(-0.5, 0.8, p.y));
  float band = 1.0 - 0.95 * smoothstep(1.04 - soft, 1.12 + soft, radius);
  float wall = smoothstep(1.25, 1.55, radius) * (0.6 + 0.4 * rise);
  float streak = smoothstep(0.2, 0.8, 0.5 + 0.5 * sin(atan(dir.y, dir.x) * 3.0 + 0.6));
  vec3 color = vec3(0.004, 0.004, 0.005) + 0.02 * smoothstep(-0.4, 0.6, p.y);
  color += vec3(1.0, 0.97, 0.94) * key * 4.0 + vec3(0.9, 0.95, 1.0) * side * 3.0 + ground * 1.2;
  color += vec3(1.0, 0.98, 0.95) * rim;
  color *= band;
  return color + vec3(mix(0.45, 1.8, streak)) * wall;
}

vec3 shade(vec2 slope, vec3 v, float blur, vec3 f0) {
  float steep = length(slope);
  slope *= 3.0 * tanh(steep / 3.0) / max(steep, 1e-6);
  vec3 n = normalize(vec3(-slope, 1.0));
  vec3 r = reflect(v, n);
  float facing = clamp(dot(n, -v), 0.0, 1.0);
  return studio(r, blur) * (f0 + (1.0 - f0) * pow(1.0 - facing, 5.0));
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = (2.0 * frag - uResolution) / uUnit;
  vec2 p = uv;
  vec2 rowX = vec2(1.0, 0.0);
  vec2 rowY = vec2(0.0, 1.0);
  float amplitude = uAmplitude * uPresence;
  for (float i = 1.0; i < 9.0; i++) {
    if (i > uDetail) break;
    float a = amplitude / i;
    float soften = exp(0.3 - 0.3 * i);
    float argX = i * uFrequency.x * p.y + uTime;
    p.x += a * cos(argX);
    rowX -= a * sin(argX) * i * uFrequency.x * soften * rowY;
    float argY = i * uFrequency.y * p.x + uTime;
    p.y += a * cos(argY);
    rowY -= a * sin(argY) * i * uFrequency.y * soften * rowX;
  }
  float phase = uTime - p.x - p.y;
  vec2 field = -(rowX + rowY);
  float density = max(length(field), 1e-3);
  vec2 across = field / density;
  float k = uSharpness;
  float sn = sin(phase);
  float cs = cos(phase);
  float th = tanh(k * sn);
  float bevel = (1.0 - th * th) / tanh(k);
  float fade = smoothstep(3.0, 9.0, 3.14159 * uUnit / density);
  float weight = uDepth * uPresence * fade;
  vec2 slope = k * cs * bevel * weight * across + slopeAt(frag / uResolution) * uRipple;
  vec2 sweep = -k * bevel * (sn + 2.0 * k * cs * cs * th) * weight * density * 2.0 / uUnit * across;
  vec2 stepX = dFdx(slope);
  vec2 stepY = dFdy(slope);
  vec2 crease = dot(stepX, stepX) > dot(stepY, stepY) ? stepX : stepY;
  if (dot(crease, crease) > dot(sweep, sweep)) sweep = crease;
  float bend = length(sweep);
  float alpha = smoothstep(0.0, 0.1, length(slope));
  vec3 f0 = mix(vec3(1.0), uTint, smoothstep(0.05, 0.6, length(slope))) * 0.92;
  vec3 v = normalize(vec3(uv * 0.08, -1.0));
  float blur = uRoughness * 0.35;
  vec3 light;
  if (bend < 0.01) {
    light = shade(slope, v, blur + bend * 0.5, f0);
  } else {
    light = vec3(0.0);
    for (float t = -0.375; t < 0.4; t += 0.25) {
      light += shade(slope + sweep * t, v, blur + bend * 0.15, f0);
    }
    light *= 0.25;
  }
  vec3 color = pow(aces(light * uExposure), vec3(1.0 / 2.2));
  float grain = fract(52.9829189 * fract(dot(frag, vec2(0.06711056, 0.00583715))));
  color += (grain - 0.5) / 255.0;
  fragColor = vec4(clamp(color, 0.0, 1.0) * alpha, alpha);
}`;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const parseColor = (value) => {
  if (Array.isArray(value)) return [0, 1, 2].map((index) => clamp(Number(value[index]) || 0, 0, 1));
  const text = String(value || '').trim();
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const full = hex[1].length === 3 ? hex[1].replace(/./g, (digit) => digit + digit) : hex[1];
    return [0, 2, 4].map((index) => parseInt(full.slice(index, index + 2), 16) / 255);
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
  if (rgb) return [rgb[1], rgb[2], rgb[3]].map((channel) => clamp(parseFloat(channel) / 255, 0, 1));
  return [1, 1, 1];
};

const compile = (gl, type, source) => {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('[LiquidChrome]', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
};

const link = (gl, fragmentSource) => {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = vertex && fragment ? gl.createProgram() : null;
  if (!vertex || !fragment || !program) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return null;
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[LiquidChrome]', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let index = 0; index < count; index++) {
    const info = gl.getActiveUniform(program, index);
    if (info) uniforms[info.name] = gl.getUniformLocation(program, info.name);
  }
  return { program, uniforms };
};

class LiquidChrome {
  constructor(container, options = {}) {
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    this.options = Object.assign(
      {
        color: '#ffffff',
        speed: 0.2,
        amplitude: 0.3,
        frequencyX: 3,
        frequencyY: 3,
        detail: 4,
        thickness: 1,
        depth: 1,
        roughness: 0.3,
        exposure: 1,
        interactive: true,
        rippleStrength: 1,
        rippleSize: 1,
        tilt: 1,
        intro: true,
        lightMode: false,
        maxDevicePixelRatio: 2,
        preserveDrawingBuffer: false
      },
      options
    );
    this._build();
  }

  _settings() {
    const o = this.options;
    return {
      tint: parseColor(o.color).map((channel) => Math.pow(channel, 2.2)),
      speed: Math.max(0, o.speed),
      amplitude: clamp(o.amplitude, 0, 2),
      frequency: [Math.max(0.1, o.frequencyX), Math.max(0.1, o.frequencyY)],
      detail: clamp(Math.round(o.detail), 1, 8),
      thickness: clamp(o.thickness, 0.25, 4),
      depth: Math.max(0, o.depth),
      roughness: clamp(o.roughness, 0, 1),
      exposure: Math.max(0, o.exposure),
      interactive: o.interactive,
      rippleStrength: Math.max(0, o.rippleStrength),
      rippleSize: clamp(o.rippleSize, 0.2, 4),
      tilt: Math.max(0, o.tilt),
      intro: o.intro,
      light: o.lightMode,
      maxRatio: clamp(o.maxDevicePixelRatio, 0.5, 3)
    };
  }

  _build() {
    const container = this.container;
    if (!container) return;
    container.classList.add('liquid-chrome');
    const canvas = document.createElement('canvas');
    canvas.className = 'liquid-chrome__canvas';
    canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(canvas);
    this.canvas = canvas;

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: !!this.options.preserveDrawingBuffer
    });
    const chrome = gl ? link(gl, CHROME) : null;
    if (!gl || !chrome) {
      this.supported = false;
      return;
    }
    this.supported = true;
    const fluid = Boolean(gl.getExtension('EXT_color_buffer_float'));
    const sim = fluid ? link(gl, SIM) : null;
    const slope = fluid ? link(gl, SLOPE) : null;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const vao = gl.createVertexArray();
    const grid = { width: 1, height: 1 };
    const targets = [];
    let slopeTarget = null;
    let current = 0;
    let unit = 1;
    const pointer = { x: 0, y: 0, inside: false, ready: false, nx: 0, ny: 0 };
    const view = { yaw: 0, pitch: 0, vyaw: 0, vpitch: 0 };
    const strokes = [];
    let time = Math.random() * 40;
    let presence = this.options.intro && !reduced ? 0 : 1;
    let energy = 0;
    let accumulator = 0;
    let raf = 0;
    let last = 0;
    let visible = true;
    let pageVisible = document.visibilityState !== 'hidden';
    let lost = false;

    const settingsRef = { current: this._settings() };
    this._settingsRef = settingsRef;

    const makeTarget = (width, height) => {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, width, height, 0, gl.RG, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { texture, framebuffer };
    };

    const dropTarget = (target) => {
      if (!target) return;
      gl.deleteTexture(target.texture);
      gl.deleteFramebuffer(target.framebuffer);
    };

    const resize = () => {
      const s = settingsRef.current;
      const rect = container.getBoundingClientRect();
      const cssWidth = Math.max(1, rect.width);
      const cssHeight = Math.max(1, rect.height);
      const ratio = Math.min(window.devicePixelRatio || 1, s.maxRatio, Math.sqrt(PIXEL_BUDGET / (cssWidth * cssHeight)));
      const width = Math.max(1, Math.round(cssWidth * ratio));
      const height = Math.max(1, Math.round(cssHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      unit = Math.min(width, height);
      if (!fluid || !sim || !slope) return;
      const gridWidth = clamp(Math.round(cssWidth / SIM_CELL), 16, 512);
      const gridHeight = clamp(Math.round(cssHeight / SIM_CELL), 16, 512);
      if (gridWidth === grid.width && gridHeight === grid.height && targets.length) return;
      targets.forEach(dropTarget);
      targets.length = 0;
      dropTarget(slopeTarget);
      Object.assign(grid, { width: gridWidth, height: gridHeight });
      targets.push(makeTarget(gridWidth, gridHeight), makeTarget(gridWidth, gridHeight));
      slopeTarget = makeTarget(gridWidth, gridHeight);
    };

    const simulate = (steps) => {
      if (!sim || !slope || !slopeTarget) return;
      gl.useProgram(sim.program);
      gl.viewport(0, 0, grid.width, grid.height);
      gl.uniform2f(sim.uniforms.uSize, grid.width, grid.height);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(sim.uniforms.uState, 0);
      for (let step = 0; step < steps; step++) {
        const stroke = step === 0 ? strokes.shift() : null;
        if (stroke) {
          gl.uniform4f(sim.uniforms.uStroke, stroke.ax, stroke.ay, stroke.bx, stroke.by);
          gl.uniform2f(sim.uniforms.uImpulse, stroke.strength, stroke.radius);
        } else {
          gl.uniform2f(sim.uniforms.uImpulse, 0, 1);
        }
        const source = targets[current];
        const destination = targets[1 - current];
        gl.bindTexture(gl.TEXTURE_2D, source.texture);
        gl.bindFramebuffer(gl.FRAMEBUFFER, destination.framebuffer);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        current = 1 - current;
      }
      gl.useProgram(slope.program);
      gl.uniform2f(slope.uniforms.uSize, grid.width, grid.height);
      gl.uniform1i(slope.uniforms.uState, 0);
      gl.bindTexture(gl.TEXTURE_2D, targets[current].texture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, slopeTarget.framebuffer);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const render = (s) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      const u = chrome.uniforms;
      gl.useProgram(chrome.program);
      gl.uniform2f(u.uResolution, canvas.width, canvas.height);
      gl.uniform1f(u.uUnit, unit);
      gl.uniform1f(u.uTime, time);
      gl.uniform1f(u.uAmplitude, s.amplitude);
      gl.uniform2f(u.uFrequency, s.frequency[0], s.frequency[1]);
      gl.uniform1f(u.uDepth, s.depth);
      gl.uniform1f(u.uDetail, s.detail);
      gl.uniform1f(u.uSharpness, 5 / (3 * s.thickness));
      gl.uniform1f(u.uPresence, 1 - Math.pow(1 - presence, 3));
      gl.uniform3fv(u.uTint, s.tint);
      gl.uniform2f(u.uShift, view.yaw, view.pitch);
      gl.uniform1f(u.uRoughness, s.roughness);
      gl.uniform1f(u.uExposure, s.exposure);
      gl.uniform1f(u.uLight, s.light ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, slopeTarget ? slopeTarget.texture : null);
      gl.uniform1i(u.uSlope, 0);
      gl.uniform2f(u.uSlopeSize, grid.width, grid.height);
      gl.uniform1f(u.uRipple, slopeTarget ? s.rippleStrength * 2.2 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const frame = (now) => {
      raf = 0;
      if (lost) return;
      const s = settingsRef.current;
      const dt = clamp((now - last) / 1000 || 0, 0, 0.05);
      last = Math.max(last, now);
      time += dt * s.speed * (reduced ? 0.25 : 1);
      presence = Math.min(1, presence + dt / 1.8);

      const hovering = s.interactive && pointer.inside;
      const reach = reduced ? 0 : s.tilt;
      const targetYaw = (hovering ? pointer.nx * 0.35 : 0.22 * Math.sin(time * 1.3)) * reach;
      const targetPitch = (hovering ? -pointer.ny * 0.28 : 0.16 * Math.sin(time * 0.9 + 1.7)) * reach;
      const stiffness = 36;
      const damping = 2 * Math.sqrt(stiffness) * 0.95;
      view.vyaw += ((targetYaw - view.yaw) * stiffness - view.vyaw * damping) * dt;
      view.vpitch += ((targetPitch - view.pitch) * stiffness - view.vpitch * damping) * dt;
      view.yaw += view.vyaw * dt;
      view.pitch += view.vpitch * dt;

      gl.bindVertexArray(vao);
      if (slopeTarget) {
        accumulator += dt;
        const steps = Math.min(4, Math.floor(accumulator / SIM_STEP));
        accumulator -= steps * SIM_STEP;
        if (steps > 0) {
          simulate(steps);
          energy = Math.max(0, energy * Math.pow(0.982, steps));
        }
      }
      render(s);

      const settling =
        Math.abs(view.vyaw) + Math.abs(view.vpitch) > 1e-4 ||
        Math.abs(targetYaw - view.yaw) + Math.abs(targetPitch - view.pitch) > 1e-4;
      const busy = s.speed > 0 || presence < 1 || settling || energy > 0.002 || strokes.length > 0;
      if (busy && visible && pageVisible) raf = requestAnimationFrame(frame);
    };

    const wake = () => {
      if (raf || lost || !visible || !pageVisible) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    const toGrid = (clientX, clientY) => {
      const rect = container.getBoundingClientRect();
      return {
        x: ((clientX - rect.left) / rect.width) * grid.width,
        y: (1 - (clientY - rect.top) / rect.height) * grid.height,
        nx: ((clientX - rect.left) / rect.width) * 2 - 1,
        ny: ((clientY - rect.top) / rect.height) * 2 - 1,
        inside: clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
      };
    };

    const push = (stroke, s) => {
      if (!slopeTarget || !s.interactive || reduced) return;
      strokes.push(stroke);
      if (strokes.length > 6) strokes.shift();
      energy = 1;
    };

    const onPointerMove = (event) => {
      const s = settingsRef.current;
      const spot = toGrid(event.clientX, event.clientY);
      pointer.nx = clamp(spot.nx, -1, 1);
      pointer.ny = clamp(spot.ny, -1, 1);
      pointer.inside = spot.inside;
      if (spot.inside && pointer.ready) {
        const travel = Math.hypot(spot.x - pointer.x, spot.y - pointer.y);
        if (travel > 0.25) {
          push(
            {
              ax: pointer.x,
              ay: pointer.y,
              bx: spot.x,
              by: spot.y,
              strength: -Math.min(0.45, 0.04 + travel * 0.045) * s.rippleSize,
              radius: 4 * s.rippleSize
            },
            s
          );
        }
      }
      pointer.x = spot.x;
      pointer.y = spot.y;
      pointer.ready = spot.inside;
      wake();
    };

    const onPointerDown = (event) => {
      const s = settingsRef.current;
      const spot = toGrid(event.clientX, event.clientY);
      if (!spot.inside) return;
      push({ ax: spot.x, ay: spot.y, bx: spot.x, by: spot.y, strength: -1.6 * s.rippleSize, radius: 6 * s.rippleSize }, s);
      wake();
    };

    const onLeave = () => {
      pointer.inside = false;
      pointer.ready = false;
      wake();
    };

    const onPointerUp = (event) => {
      if (event.pointerType !== 'mouse') onLeave();
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);

    const onLost = (event) => {
      event.preventDefault();
      lost = true;
      cancelAnimationFrame(raf);
      raf = 0;
    };
    canvas.addEventListener('webglcontextlost', onLost);

    const resizeObserver = new ResizeObserver(() => {
      resize();
      wake();
    });
    resizeObserver.observe(container);

    const intersection = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      wake();
    });
    intersection.observe(container);

    const onVisibility = () => {
      pageVisible = document.visibilityState !== 'hidden';
      wake();
    };
    document.addEventListener('visibilitychange', onVisibility);

    resize();
    wake();

    this._destroy = () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      intersection.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onLost);
      if (!gl.isContextLost()) {
        targets.forEach(dropTarget);
        dropTarget(slopeTarget);
        gl.deleteVertexArray(vao);
        gl.deleteProgram(chrome.program);
        if (sim) gl.deleteProgram(sim.program);
        if (slope) gl.deleteProgram(slope.program);
      }
      container.removeChild(canvas);
    };

    // 调试钩子：供自动化验收读取真实渲染结果
    this.debug = {
      gl,
      canvas,
      step: (ms) => {
        time += ms / 1000 * settingsRef.current.speed || 0;
        render(settingsRef.current);
      },
      probe() {
        const w = canvas.width;
        const h = canvas.height;
        const px = new Uint8Array(w * h * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let sum = 0;
        let sum2 = 0;
        let n = 0;
        let min = 255;
        let max = 0;
        for (let i = 0; i < px.length; i += 4 * 37) {
          const v = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          sum += v;
          sum2 += v * v;
          n++;
          if (v < min) min = v;
          if (v > max) max = v;
        }
        const mean = sum / n;
        return { mean: +mean.toFixed(2), std: +Math.sqrt(sum2 / n - mean * mean).toFixed(2), min: +min.toFixed(1), max: +max.toFixed(1) };
      }
    };
  }

  destroy() {
    if (this._destroy) this._destroy();
  }
}


return LiquidChrome;
})();

/* ═══ silk.js（红旗 · 来自 ima 知识库，着色器未改） ═══ */
const Silk = (function(){
/**
 * Silk — 丝绸（红旗飘动）动态背景
 * ------------------------------------------------------------------
 * 来源：用户 ima 知识库《2026-10-19-Silk丝绸动态背景组件》
 * 本文件为「原封移植」：着色器源码、两段式管线、交互逻辑一行未改，
 * 仅把 React 封装换成原生 class（无 React 依赖）。
 *
 * 管线：FIELD（低分辨率亮度场 + mipmap）→ COMPOSITE（全分辨率光照/高光/色调）
 */

const VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const SILK = `
uniform vec2 uView;
uniform float uScale;
uniform float uRotation;
uniform float uTime;
uniform float uWave;
uniform float uRipple;
uniform float uFold;
uniform vec2 uShift;
uniform vec4 uPointer;
uniform vec2 uDrag;
uniform vec4 uWaves[4];

const float e = 2.71828182845904523536;

float noise(vec2 texCoord) {
  float G = e;
  vec2 r = (G * sin(G * texCoord));
  return fract(r.x * r.y * (1.0 + texCoord.x));
}

vec2 rotateUvs(vec2 uv, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  mat2 rot = mat2(c, -s, s, c);
  return rot * uv;
}

vec2 bend(vec2 uv) {
  vec2 aspect = vec2(uView.x / uView.y, 1.0);
  vec2 offset = (uv - uPointer.xy) * aspect;
  float touch = uPointer.z * exp(-dot(offset, offset) / (uPointer.w * uPointer.w));
  uv -= uDrag * touch;
  for (int i = 0; i < 4; i++) {
    vec4 wave = uWaves[i];
    if (wave.w <= 0.0) continue;
    vec2 q = (uv - wave.xy) * aspect;
    float dist = length(q);
    float front = dist - wave.z;
    float ring = exp(-front * front * 60.0) * wave.w;
    uv += q / max(dist, 0.0001) / aspect * ring * 0.034 * sin(front * 34.0);
  }
  return uv;
}

float silk(vec2 vUv) {
  vec2 uv = rotateUvs(vUv * uScale, uRotation);
  vec2 tex = uv * uScale + uShift;
  float tOffset = uTime;
  tex.y += 0.03 * uWave * sin(8.0 * tex.x - tOffset);
  return 0.6 + 0.4 * uFold * sin(5.0 * (tex.x + tex.y + cos(3.0 * tex.x + 5.0 * tex.y) + 0.02 * tOffset) + uRipple * sin(20.0 * (tex.x + tex.y - 0.1 * tOffset)));
}`;

const FIELD = `#version 300 es
precision highp float;
${SILK}
out vec4 outColor;

void main() {
  vec2 vUv = gl_FragCoord.xy / uView;
  float pattern = silk(bend(vUv));
  float n = clamp((pattern - 0.2) / 0.8, 0.0, 1.0);
  outColor = vec4(pow(n, 6.0), 0.0, 0.0, 1.0);
}`;

const COMPOSITE = `#version 300 es
precision highp float;
${SILK}
uniform sampler2D uBloom;
uniform vec3 uColor;
uniform vec3 uSheenColor;
uniform float uNoiseIntensity;
uniform float uDepth;
uniform float uSheen;
uniform float uGlow;
uniform float uLightMode;
uniform vec3 uLight;
uniform vec2 uStep;
uniform float uPresence;
uniform float uFade;
out vec4 outColor;

float smootherstep01(float t) {
  t = clamp(t, 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

vec3 softClip(vec3 c) {
  vec3 over = max(c - 0.75, 0.0);
  return min(c, 0.75) + 0.25 * (1.0 - exp(-over * 4.0));
}

void main() {
  vec2 vUv = gl_FragCoord.xy / uView;
  vec2 coord = bend(vUv);
  float pattern = silk(coord);
  float rnd = noise(gl_FragCoord.xy);
  float n = clamp((pattern - 0.2) / 0.8, 0.0, 1.0);

  float gx = silk(coord + vec2(uStep.x, 0.0)) - pattern;
  float gy = silk(coord + vec2(0.0, uStep.y)) - pattern;
  vec3 normal = normalize(vec3(-gx * 26.0, -gy * 26.0, 1.0));
  vec3 toLight = normalize(vec3(uLight.xy, 0.85));
  float relief = 1.0 + (dot(normal, toLight) - toLight.z) * 1.8 * uDepth;
  vec3 halfway = normalize(toLight + vec3(0.0, 0.0, 1.0));
  float gloss = pow(max(dot(normal, halfway), 0.0), 48.0) * smoothstep(0.25, 0.85, n);
  float crest = pow(n, 5.0);
  float shine = (gloss * 0.85 + crest * 0.4) * uSheen * (1.0 + uLight.z * 0.6);

  float bloom = 0.0;
  if (uGlow > 0.0) {
    bloom += textureLod(uBloom, vUv, 1.0).r * 0.35;
    bloom += textureLod(uBloom, vUv, 2.0).r * 0.3;
    bloom += textureLod(uBloom, vUv, 3.0).r * 0.2;
    bloom += textureLod(uBloom, vUv, 4.0).r * 0.15;
  }

  vec3 result;
  if (uLightMode > 0.5) {
    float fold = smoothstep(0.28, 0.9, pattern);
    float specular = smoothstep(0.72, 0.98, pattern);
    vec3 shadowColor = uColor * (0.72 - 0.12 * uDepth);
    vec3 bodyColor = min(uColor * 1.18, vec3(1.0));
    vec3 lightBase = mix(shadowColor, bodyColor, fold) * mix(1.0, relief, 0.6);
    lightBase = mix(lightBase, vec3(1.0), clamp(specular * 0.92 + shine * 0.22 + bloom * uGlow * 0.2, 0.0, 1.0));
    float fineNoise = noise(gl_FragCoord.xy * 0.63 + vec2(17.0, 41.0));
    float grainSignal = (rnd + fineNoise - 1.0);
    float grainStrength = clamp(uNoiseIntensity * 0.038, 0.0, 0.16);
    result = clamp(lightBase + grainSignal * grainStrength, 0.0, 1.0);
  } else {
    float grain = rnd / 15.0 * uNoiseIntensity;
    float floorValue = mix(0.2, 0.03, uDepth);
    float curve = uDepth > 0.0 ? pow(n, 1.0 + 1.4 * uDepth) : n;
    float shade = uDepth > 0.0 ? floorValue + (1.0 - floorValue) * curve : pattern;
    vec3 tone = mix(uColor, pow(uColor, vec3(1.45)), (1.0 - n) * uDepth);
    vec3 lit = tone * shade * relief - vec3(grain);
    vec3 tint = mix(uColor, uSheenColor, 0.8);
    vec3 extra = tint * (shine + bloom * uGlow * 0.55);
    float blend = clamp((uSheen + uGlow) * 4.0, 0.0, 1.0);
    result = mix(clamp(lit, 0.0, 1.0), clamp(softClip(lit + extra), 0.0, 1.0), blend);
  }

  float edge = uFade * 0.5;
  float mask = 1.0;
  if (edge > 0.0) {
    mask = smootherstep01(vUv.x / edge) * smootherstep01((1.0 - vUv.x) / edge);
    mask *= smootherstep01(vUv.y / edge) * smootherstep01((1.0 - vUv.y) / edge);
  }
  float alpha = uPresence * mask;
  outColor = vec4(result * alpha, alpha);
}`;

const INTRO_SECONDS = 2.2;
const INTRO_RUSH = 1.6;
const WAVE_LIFE = 1.6;
const DEFAULT_LIGHT = [-0.55, 0.7];
const LIGHT_TILT = Math.hypot(DEFAULT_LIGHT[0], DEFAULT_LIGHT[1]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const ease = (t) => t * t * t * (t * (t * 6 - 15) + 10);

const variationShift = (variation) => {
  const n = Number(variation) || 0;
  if (!n) return [0, 0];
  const wave = (k) => {
    const v = Math.sin(n * 12.9898 + k * 78.233) * 43758.5453;
    return v - Math.floor(v) - 0.5;
  };
  return [wave(1) * 6, wave(2) * 6];
};

const compile = (gl, type, source) => {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.error('[Silk]', gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
};

const link = (gl, fragmentSource) => {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, 'aPosition');
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[Silk]', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    if (info) uniforms[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(program, info.name);
  }
  return { program, uniforms };
};

class Silk {
  constructor(container, options = {}) {
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    this.options = Object.assign(
      {
        speed: 5,
        scale: 1,
        color: '#7B7481',
        sheenColor: '#ffffff',
        noiseIntensity: 1.5,
        rotation: 0,
        sheen: 0.5,
        depth: 0.5,
        glow: 0.3,
        ripple: 1,
        wave: 1,
        variation: 0,
        mouseInteraction: true,
        interactionStrength: 1,
        clickRipple: true,
        intro: true,
        fade: 0,
        lightMode: false,
        paused: false,
        dpr: undefined,
        preserveDrawingBuffer: false
      },
      options
    );
    this._build();
  }

  _settings() {
    const o = this.options;
    return {
      speed: o.speed,
      scale: o.scale,
      color: String(o.color),
      sheenColor: String(o.sheenColor),
      noiseIntensity: Math.max(0, o.noiseIntensity),
      rotation: o.rotation,
      sheen: Math.max(0, o.sheen),
      depth: clamp(o.depth, 0, 1),
      glow: Math.max(0, o.glow),
      ripple: Math.max(0, o.ripple),
      wave: Math.max(0, o.wave),
      variation: o.variation,
      mouseInteraction: o.mouseInteraction,
      interactionStrength: Math.max(0, o.interactionStrength),
      clickRipple: o.clickRipple,
      intro: o.intro,
      fade: clamp(o.fade, 0, 1),
      lightMode: o.lightMode,
      paused: o.paused,
      dpr: o.dpr
    };
  }

  _build() {
    const container = this.container;
    if (!container) return;
    container.classList.add('silk-container');
    const canvas = document.createElement('canvas');
    canvas.className = 'silk-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(canvas);
    this.canvas = canvas;

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: !!this.options.preserveDrawingBuffer
    });
    if (!gl) {
      this.supported = false;
      return;
    }

    const fieldProgram = link(gl, FIELD);
    const compositeProgram = link(gl, COMPOSITE);
    if (!fieldProgram || !compositeProgram) {
      this.supported = false;
      return;
    }
    this.supported = true;

    const buffer = gl.createBuffer();
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    const target = { width: 0, height: 0 };
    const sizeTarget = (width, height) => {
      if (target.width === width && target.height === height) return;
      target.width = width;
      target.height = height;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    };

    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const colorCache = new Map();
    const toRgb = (value) => {
      if (colorCache.has(value)) return colorCache.get(value);
      let rgb = [1, 1, 1];
      if (probe) {
        probe.clearRect(0, 0, 1, 1);
        probe.fillStyle = '#ffffff';
        probe.fillStyle = value;
        probe.fillRect(0, 0, 1, 1);
        const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
        rgb = [r / 255, g / 255, b / 255];
      }
      colorCache.set(value, rgb);
      return rgb;
    };

    const settingsRef = { current: this._settings() };
    this._settingsRef = settingsRef;

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const view = { width: 1, height: 1, ratio: 1 };
    const pointer = { x: 0, y: 0, inside: false };
    const waves = [];
    const waveData = new Float32Array(16);
    const state = {
      flow: 0,
      intro: settingsRef.current.intro && !reduce ? 0 : 1,
      touch: 0,
      x: 0,
      y: 0,
      dragX: 0,
      dragY: 0,
      lightX: DEFAULT_LIGHT[0],
      lightY: DEFAULT_LIGHT[1]
    };
    let raf = 0;
    let last = 0;
    let visible = true;

    const setShared = (uniforms, width, height, s, unfold) => {
      const [shiftX, shiftY] = variationShift(s.variation);
      gl.uniform2f(uniforms.uView, width, height);
      gl.uniform1f(uniforms.uScale, s.scale);
      gl.uniform1f(uniforms.uRotation, s.rotation);
      gl.uniform1f(uniforms.uTime, state.flow - INTRO_RUSH * (1 - unfold));
      gl.uniform1f(uniforms.uWave, s.wave);
      gl.uniform1f(uniforms.uRipple, s.ripple);
      gl.uniform1f(uniforms.uFold, 0.25 + 0.75 * unfold);
      gl.uniform2f(uniforms.uShift, shiftX, shiftY);
      gl.uniform4f(uniforms.uPointer, state.x / view.width, 1 - state.y / view.height, state.touch * s.interactionStrength, 0.32);
      gl.uniform2f(uniforms.uDrag, state.dragX, state.dragY);
      gl.uniform4fv(uniforms.uWaves, waveData);
    };

    const render = () => {
      const s = settingsRef.current;
      const unfold = ease(state.intro);
      const presence = 1 - Math.pow(1 - state.intro, 3);
      gl.bindVertexArray(vao);

      waveData.fill(0);
      waves.slice(-4).forEach((item, index) => {
        waveData.set([item.x, item.y, item.age * 0.6, Math.exp(-item.age / (WAVE_LIFE * 0.45))], index * 4);
      });

      if (s.glow > 0) {
        sizeTarget(Math.max(1, Math.round(canvas.width / 4)), Math.max(1, Math.round(canvas.height / 4)));
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.viewport(0, 0, target.width, target.height);
        gl.useProgram(fieldProgram.program);
        setShared(fieldProgram.uniforms, target.width, target.height, s, unfold);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.generateMipmap(gl.TEXTURE_2D);
      }

      const c = compositeProgram.uniforms;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(compositeProgram.program);
      setShared(c, canvas.width, canvas.height, s, unfold);
      gl.uniform3fv(c.uColor, toRgb(s.color));
      gl.uniform3fv(c.uSheenColor, toRgb(s.sheenColor));
      gl.uniform1f(c.uNoiseIntensity, s.noiseIntensity);
      gl.uniform1f(c.uDepth, s.depth);
      gl.uniform1f(c.uSheen, s.sheen);
      gl.uniform1f(c.uGlow, s.glow);
      gl.uniform1f(c.uLightMode, s.lightMode ? 1 : 0);
      gl.uniform3f(c.uLight, state.lightX, state.lightY, state.touch * s.interactionStrength);
      gl.uniform2f(c.uStep, view.ratio / canvas.width, view.ratio / canvas.height);
      gl.uniform1f(c.uPresence, presence);
      gl.uniform1f(c.uFade, s.fade);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(c.uBloom, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const frame = (now) => {
      raf = 0;
      if (!visible || document.hidden) return;
      const s = settingsRef.current;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      const flowing = !s.paused && !reduce && s.speed !== 0;
      if (flowing) state.flow += dt * 0.1 * s.speed;
      if (!s.intro || reduce) state.intro = 1;
      else if (state.intro < 1) state.intro = Math.min(1, state.intro + dt / INTRO_SECONDS);

      const engaged = s.mouseInteraction && pointer.inside && !reduce;
      if (engaged && state.touch < 0.01) {
        state.x = pointer.x;
        state.y = pointer.y;
      }
      const follow = 1 - Math.exp(-dt * 10);
      const prevX = state.x;
      const prevY = state.y;
      state.x += (pointer.x - state.x) * follow;
      state.y += (pointer.y - state.y) * follow;
      const velX = (state.x - prevX) / Math.max(dt, 0.001) / view.height;
      const velY = (state.y - prevY) / Math.max(dt, 0.001) / view.height;
      const dragBlend = 1 - Math.exp(-dt * 4);
      state.dragX += (clamp(velX * 0.03, -0.06, 0.06) - state.dragX) * dragBlend;
      state.dragY += (clamp(-velY * 0.03, -0.06, 0.06) - state.dragY) * dragBlend;
      state.touch += ((engaged ? 1 : 0) - state.touch) * (1 - Math.exp(-dt * (engaged ? 3.5 : 1.4)));

      let lightGoalX = DEFAULT_LIGHT[0];
      let lightGoalY = DEFAULT_LIGHT[1];
      if (engaged) {
        const aimX = (pointer.x / view.width - 0.5) * (view.width / view.height);
        const aimY = 0.5 - pointer.y / view.height;
        const reach = Math.hypot(aimX, aimY);
        if (reach > 0.04) {
          lightGoalX = (aimX / reach) * LIGHT_TILT;
          lightGoalY = (aimY / reach) * LIGHT_TILT;
        } else {
          lightGoalX = state.lightX;
          lightGoalY = state.lightY;
        }
      }
      const lightFollow = 1 - Math.exp(-dt * 3);
      state.lightX += (lightGoalX - state.lightX) * lightFollow;
      state.lightY += (lightGoalY - state.lightY) * lightFollow;

      for (let i = waves.length - 1; i >= 0; i--) {
        waves[i].age += dt;
        if (waves[i].age > WAVE_LIFE * 2.5) waves.splice(i, 1);
      }

      render();

      const settling =
        state.intro < 1 ||
        waves.length > 0 ||
        Math.abs((engaged ? 1 : 0) - state.touch) > 0.002 ||
        Math.abs(state.dragX) + Math.abs(state.dragY) > 0.0002 ||
        Math.abs(pointer.x - state.x) + Math.abs(pointer.y - state.y) > 0.3 ||
        Math.abs(lightGoalX - state.lightX) + Math.abs(lightGoalY - state.lightY) > 0.001;
      if (flowing || settling) raf = requestAnimationFrame(frame);
      else last = 0;
    };

    const wake = () => {
      if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame);
    };

    const resize = () => {
      const s = settingsRef.current;
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      const ratio = Math.min(s.dpr || window.devicePixelRatio || 1, 2);
      view.width = width;
      view.height = height;
      view.ratio = ratio;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      if (!raf) render();
      wake();
    };

    const locate = (event) => {
      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      return { x, y, inside: x >= 0 && y >= 0 && x <= rect.width && y <= rect.height };
    };

    const onPointerMove = (event) => {
      const point = locate(event);
      pointer.x = point.x;
      pointer.y = point.y;
      pointer.inside = point.inside;
      wake();
    };

    const onPointerDown = (event) => {
      const s = settingsRef.current;
      if (!s.clickRipple || reduce) return;
      const point = locate(event);
      if (!point.inside) return;
      waves.push({ x: point.x / view.width, y: 1 - point.y / view.height, age: 0 });
      if (waves.length > 4) waves.shift();
      wake();
    };

    const onPointerLeave = () => {
      pointer.inside = false;
      wake();
    };

    const onVisibility = () => {
      last = 0;
      wake();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    const intersection = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible) {
        last = 0;
        wake();
      }
    });
    intersection.observe(container);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    document.documentElement.addEventListener('pointerleave', onPointerLeave);
    document.addEventListener('visibilitychange', onVisibility);
    resize();

    // 供外部调整流速：只改 settings 后唤醒循环，不重建管线（偶发加速用）
    this.setSpeed = (value) => {
      const num = Number(value);
      if (!Number.isFinite(num)) return;
      settingsRef.current.speed = num;
      wake();
    };

    this._destroy = () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      intersection.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      document.documentElement.removeEventListener('pointerleave', onPointerLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(framebuffer);
      gl.deleteProgram(fieldProgram.program);
      gl.deleteProgram(compositeProgram.program);
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      container.removeChild(canvas);
    };

    // 调试钩子：供自动化验收读取真实渲染结果
    this.debug = {
      gl,
      canvas,
      advance: (ms) => {
        state.flow += (ms / 1000) * 0.1 * settingsRef.current.speed;
        render();
      },
      probe() {
        const w = canvas.width;
        const h = canvas.height;
        const px = new Uint8Array(w * h * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let sum = 0;
        let sum2 = 0;
        let n = 0;
        let min = 255;
        let max = 0;
        let red = 0;
        for (let i = 0; i < px.length; i += 4 * 37) {
          const v = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          sum += v;
          sum2 += v * v;
          n++;
          if (v < min) min = v;
          if (v > max) max = v;
          red += px[i];
        }
        const mean = sum / n;
        return {
          mean: +mean.toFixed(2),
          std: +Math.sqrt(sum2 / n - mean * mean).toFixed(2),
          min: +min.toFixed(1),
          max: +max.toFixed(1),
          meanR: +(red / n).toFixed(1)
        };
      }
    };
  }

  destroy() {
    if (this._destroy) this._destroy();
  }
}


return Silk;
})();

/* ═══ circular-carousel.js（环形画廊 · React Bits 移植，数学未改） ═══ */
const CircularCarousel = (function(){
/**
 * CircularCarousel —— React Bits「环形旋转木马」的原生 JS 移植
 * ------------------------------------------------------------
 * 只改封装：React 的 state/ref/useLayoutEffect → 类实例字段 + requestAnimationFrame。
 * 环半径、分片投影（TILES/OVERLAP）、弹簧、拖拽惯性、视差、拉伸、深度渐隐
 * 的算法与常量全部保留原值，未作"优化"。
 *
 * 与 React 版的唯一差别：
 *   - items 传的是 DOM 元素（不是 {src,title}），每个元素会被整卡复制到 8 条竖片里，
 *     因此卡片可以是"图 + 文字"的复合结构，不只是单张照片。
 *   - 去掉了 items 切换时的新旧图交替动画（本站不换图）。
 */

const TILES = 8;
const OVERLAP = 2.5;
const DRAG_THRESHOLD = 5;
const SPRING = 118;
const SETTLE_SPEED = 9;
const TO_RAD = Math.PI / 180;
const INTRO_LENGTH = { assemble: 1500, rise: 1400, spin: 1800, none: 0 };

const PRESETS = {
  cylinder: { axis: 'y', tilt: -5, perspective: 2500, curve: 1, spread: 1, inward: false, billboard: false, backfaces: true, window: 0 },
  orbit: { axis: 'y', tilt: -16, perspective: 1500, curve: 0, spread: 1.45, inward: false, billboard: true, backfaces: false, window: 0 },
  wheel: { axis: 'x', tilt: 0, perspective: 1800, curve: 0, spread: 1, inward: false, billboard: false, backfaces: true, window: 1.7 },
  panorama: { axis: 'y', tilt: 0, perspective: 0, curve: 1, spread: 1, inward: true, billboard: false, backfaces: false, window: 0 }
};

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const easeOut = (t) => 1 - Math.pow(1 - t, 4);
const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);

const CSS = `
.cc{position:relative;width:100%;height:100%;overflow:hidden;outline:none;
  touch-action:pan-y;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
.cc[data-draggable]{cursor:grab}
.cc[data-dragging]{cursor:grabbing}
.cc:focus-visible{box-shadow:inset 0 0 0 2px rgba(245,213,53,.45)}
.cc-view{position:absolute;inset:0;
  -webkit-mask-image:linear-gradient(to right,transparent 0%,#000 10%,#000 90%,transparent 100%);
  mask-image:linear-gradient(to right,transparent 0%,#000 10%,#000 90%,transparent 100%)}
.cc-stage{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  opacity:0;transition:opacity .45s ease}
.cc[data-ready] .cc-stage{opacity:1}
.cc-camera,.cc-ring,.cc-card{width:0;height:0;transform-style:preserve-3d}
.cc-camera{position:relative}
.cc-ring,.cc-card{position:absolute;left:0;top:0}
.cc-tile{position:absolute;outline:1px solid transparent;
  backface-visibility:hidden;-webkit-backface-visibility:hidden}
.cc-frame{position:absolute;left:0;top:0;width:100%;overflow:hidden}
.cc-content{position:absolute;overflow:hidden;pointer-events:none}
.cc-shade{position:absolute;inset:0;pointer-events:none;
  background:var(--cc-fade,#000);opacity:var(--cc-depth,0)}
.cc-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (prefers-reduced-motion:reduce){ .cc-stage{transition:none} }
`;

let cssInjected = false;
function injectCSS() {
  if (cssInjected) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  cssInjected = true;
}

class CircularCarousel {
  constructor(root, items, options = {}) {
    injectCSS();
    this.root = root;
    this.items = items;
    this.o = Object.assign(
      {
        preset: 'cylinder',
        intro: 'rise',
        cardWidth: 220,
        aspectRatio: 1,
        gap: 25,
        curve: undefined,
        tilt: undefined,
        perspective: undefined,
        autoplay: 'drift',
        speed: 14,
        interval: 3,
        direction: 'left',
        draggable: true,
        momentum: 0.6,
        snap: true,
        pauseOnHover: true,
        focusOnClick: true,
        parallax: 0.3,
        stretch: 0.5,
        depthFade: 0.55,
        fadeColor: '#000000',
        innerShade: 0.6,
        cornerRadius: 12,
        onChange: null
      },
      options
    );

    const o = this.o;
    this.shape = PRESETS[o.preset] ? o.preset : 'cylinder';
    this.layout = PRESETS[this.shape];
    this.axis = this.layout.axis;
    this.tilt = o.tilt ?? this.layout.tilt;
    this.curve = this.layout.billboard ? 0 : clamp(o.curve ?? this.layout.curve, 0, 1);
    this.cardW = Math.max(40, o.cardWidth);
    this.cardH = this.cardW / clamp(o.aspectRatio, 0.2, 5);
    this.along = this.axis === 'x' ? this.cardH : this.cardW;
    this.step = 360 / items.length;

    const n = Math.max(items.length, 3);
    const pitch = (this.along + o.gap) * this.layout.spread;
    const chord = pitch / (2 * Math.sin(Math.PI / n));
    const arc = (n * pitch) / (2 * Math.PI);
    this.radius = Math.max(chord + (arc - chord) * this.curve, this.along * 0.6);
    this.perspective = this.layout.inward ? this.radius : (o.perspective ?? this.layout.perspective);

    this.state = {
      angle: 0, velocity: 0, target: null, dir: 0, press: null, drag: false,
      hover: false, pointer: { inside: false, x: 0, y: 0 }, yaw: 0, pitch: 0,
      intro: null, introDone: false, holdUntil: 0, stepAt: 0, suppressClick: false,
      wheelTimer: 0, fit: 1, shift: 0, drop: 0, last: 0, active: 0
    };
    const dragSign = this.layout.inward ? -1 : 1;
    this.state.dir = (o.direction === 'right' ? 1 : -1) * dragSign;

    this.build();
    this.bind();
    this.measure();
    this.render(performance.now());
    root.dataset.ready = '';
    this.wake();
  }

  /* ───────── DOM ───────── */
  build() {
    const { root, cardW, cardH, along, layout, axis } = this;

    root.classList.add('cc');
    root.style.setProperty('--cc-fade', this.o.fadeColor);
    root.style.setProperty('--cc-inner', (1 - clamp(this.o.innerShade, 0, 1)).toFixed(3));
    root.setAttribute('role', 'region');
    root.setAttribute('aria-roledescription', 'carousel');
    root.setAttribute('aria-label', '团队成员');
    root.tabIndex = 0;
    root.dataset.shape = this.shape;
    if (this.o.draggable) root.dataset.draggable = '';

    root.innerHTML = '<div class="cc-view"><div class="cc-stage"><div class="cc-camera"><div class="cc-ring"></div></div></div></div><div class="cc-live" aria-live="polite"></div>';

    this.stageEl = root.querySelector('.cc-stage');
    this.cameraEl = root.querySelector('.cc-camera');
    this.ringEl = root.querySelector('.cc-ring');

    const total = this.curve > 0.001 ? TILES : 1;
    const length = along / total;
    const bend = this.curve > 0.001 ? this.radius / this.curve : 0;

    const tiles = Array.from({ length: total }, (_, index) => {
      const start = index * length - (index > 0 ? OVERLAP / 2 : 0);
      const end = (index + 1) * length + (index < total - 1 ? OVERLAP / 2 : 0);
      const center = (start + end) / 2 - along / 2;
      const alpha = bend ? center / bend : 0;
      const shift = bend ? bend * Math.sin(alpha) : center;
      const sink = bend ? bend * (1 - Math.cos(alpha)) : 0;
      const depth = layout.inward ? sink : -sink;
      const turn = ((layout.inward ? -alpha : alpha) * 180) / Math.PI;
      const move = axis === 'x'
        ? `translate3d(0px,${shift}px,${depth}px) rotateX(${-turn}deg)`
        : `translate3d(${shift}px,0px,${depth}px) rotateY(${turn}deg)`;
      const size = end - start;
      const first = index === 0;
      const last = index === total - 1;
      const r = this.o.cornerRadius;
      const radiusCSS = axis === 'x'
        ? `${first ? r : 0}px ${first ? r : 0}px ${last ? r : 0}px ${last ? r : 0}px`
        : `${first ? r : 0}px ${last ? r : 0}px ${last ? r : 0}px ${first ? r : 0}px`;
      return { start, size, move, radiusCSS };
    });

    this.cards = this.items.map((item, index) => {
      const card = document.createElement('div');
      card.className = 'cc-card';
      card.innerHTML = tiles.map((t) => {
        const box = axis === 'x'
          ? `left:${-cardW / 2}px;top:${-t.size / 2}px;width:${cardW}px;height:${t.size}px`
          : `left:${-t.size / 2}px;top:${-cardH / 2}px;width:${t.size}px;height:${cardH}px`;
        return `<div class="cc-tile" style="${box};transform:${t.move}">
          <div class="cc-frame" style="height:${axis === 'x' ? t.size : cardH}px;border-radius:${t.radiusCSS}">
            <div class="cc-content" style="left:${-t.start}px;top:0;width:${along}px;height:${cardH}px"></div>
            <div class="cc-shade"></div>
          </div>
        </div>`;
      }).join('');
      this.ringEl.appendChild(card);
      const content = item.el.cloneNode(true);
      content.removeAttribute('hidden');
      card.querySelectorAll('.cc-content').forEach((box) => box.appendChild(content.cloneNode(true)));
      return card;
    });
  }

  /* ───────── 事件 ───────── */
  bind() {
    const s = this.state;
    const root = this.root;

    this.onMove = (e) => {
      if (e.pointerType === 'mouse') {
        s.pointer.inside = true;
        const rect = root.getBoundingClientRect();
        s.pointer.x = clamp(((e.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
        s.pointer.y = clamp(((e.clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
      }
      const press = s.press;
      if (!press || press.id !== e.pointerId) { this.wake(); return; }
      const delta = this.axis === 'x' ? e.clientY - press.y : e.clientX - press.x;
      const cross = this.axis === 'x' ? e.clientX - press.x : e.clientY - press.y;
      if (!press.moved) {
        if (Math.abs(delta) < DRAG_THRESHOLD) return;
        if (Math.abs(cross) > Math.abs(delta) * 1.2 && e.pointerType !== 'mouse') { s.press = null; return; }
        press.moved = true;
        press.origin = delta;
        s.drag = true;
        s.target = null;
        s.velocity = 0;
        root.dataset.dragging = '';
        try { root.setPointerCapture(e.pointerId); } catch (_) {}
      }
      const perPixel = 180 / (Math.PI * this.radius * s.fit);
      s.angle = press.angle + (delta - press.origin) * perPixel * (this.layout.inward ? -1 : 1);
      const now = performance.now();
      press.samples.push({ time: now, angle: s.angle });
      while (press.samples.length > 2 && now - press.samples[0].time > 110) press.samples.shift();
      this.wake();
    };

    this.onDown = (e) => {
      s.suppressClick = false;
      if (!this.o.draggable || e.button !== 0) return;
      s.press = {
        id: e.pointerId, x: e.clientX, y: e.clientY, angle: s.angle,
        moved: false, origin: 0, samples: [{ time: performance.now(), angle: s.angle }]
      };
    };

    this.onUp = (e) => {
      const press = s.press;
      if (!press || press.id !== e.pointerId) return;
      s.press = null;
      if (!press.moved) return;
      s.drag = false;
      delete root.dataset.dragging;
      s.suppressClick = true;
      const first = press.samples[0];
      const last = press.samples[press.samples.length - 1];
      const span = (last.time - first.time) / 1000;
      const velocity = span > 0.008 ? clamp((last.angle - first.angle) / span, -1400, 1400) : 0;
      s.velocity = velocity;
      if (Math.abs(velocity) > 60) s.dir = Math.sign(velocity);
      const coasting = this.o.autoplay === 'drift' && !(this.o.pauseOnHover && s.hover && e.pointerType === 'mouse');
      if (this.o.snap && !coasting) {
        const tau = 0.18 + this.o.momentum * 1.5;
        s.target = Math.round((s.angle + velocity * tau * 0.55) / this.step) * this.step;
      }
      this.wake();
    };

    this.onWheel = (e) => {
      if (!this.o.draggable) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0;
      if (!delta) return;
      e.preventDefault();
      const perPixel = 180 / (Math.PI * this.radius * s.fit);
      s.target = null;
      s.angle -= delta * perPixel * (this.layout.inward ? -1 : 1);
      s.velocity = -delta * perPixel * (this.layout.inward ? -1 : 1) * 30;
      s.holdUntil = performance.now() + 1600;
      clearTimeout(s.wheelTimer);
      s.wheelTimer = setTimeout(() => {
        if (this.o.snap) s.target = this.nearest(s.angle + s.velocity * 0.12);
        this.wake();
      }, 140);
      this.wake();
    };

    this.onClick = (e) => {
      if (s.suppressClick) { s.suppressClick = false; return; }
      const card = e.target.closest && e.target.closest('.cc-card');
      if (!card) return;
      if (this.o.focusOnClick) this.focusIndex(this.cards.indexOf(card));
    };

    this.onKey = (e) => {
      const fwd = this.axis === 'x' ? 'ArrowDown' : 'ArrowRight';
      const back = this.axis === 'x' ? 'ArrowUp' : 'ArrowLeft';
      if (e.key === fwd) this.stepBy(1);
      else if (e.key === back) this.stepBy(-1);
      else if (e.key === 'Home') this.focusIndex(0);
      else if (e.key === 'End') this.focusIndex(this.items.length - 1);
      else return;
      e.preventDefault();
    };

    root.addEventListener('pointerdown', this.onDown);
    root.addEventListener('pointermove', this.onMove);
    root.addEventListener('pointerup', this.onUp);
    root.addEventListener('pointercancel', this.onUp);
    root.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { s.hover = true; this.wake(); } });
    root.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') { s.hover = false; s.pointer.inside = false; }
      this.wake();
    });
    root.addEventListener('click', this.onClick);
    root.addEventListener('keydown', this.onKey);
    root.addEventListener('wheel', this.onWheel, { passive: false });

    this.ro = new ResizeObserver(() => { this.measure(); this.wake(); });
    this.ro.observe(root);

    this.io = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      if (this.visible) this.wake();
      else { cancelAnimationFrame(this.raf); this.raf = 0; s.last = 0; }
    });
    this.io.observe(root);
    this.visible = true;

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { cancelAnimationFrame(this.raf); this.raf = 0; s.last = 0; }
      else this.wake();
    });
  }

  /* ───────── 尺寸 ───────── */
  measure() {
    const s = this.state;
    const rect = this.root.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const width = rect.width * 0.94;
    const height = rect.height * 0.92;
    const P = this.perspective;

    let spanX, spanY;
    if (this.layout.inward) {
      spanX = Math.max(width, 1);
      spanY = Math.max(this.cardH, 1);
    } else {
      spanX = Math.max(this.cardW, 1);
      spanY = Math.max(this.cardH, 1);
    }
    const fit = Math.min(1, width / spanX, height / spanY);
    s.fit = fit;
    s.shift = 0;
    s.drop = this.axis === 'x'
      ? (rect.width / fit) * 0.55 + this.cardW
      : (rect.height / fit) * 0.55 + this.cardH;
    this.stageEl.style.perspective = `${P}px`;
    this.stageEl.style.transform = `translate3d(0,${s.shift}px,0) scale(${fit})`;
  }

  nearest(angle) { return Math.round(angle / this.step) * this.step; }

  focusIndex(index) {
    const s = this.state;
    let target = -index * this.step;
    target += 360 * Math.round((s.angle - target) / 360);
    s.target = target;
    s.holdUntil = performance.now() + 2800;
    this.wake();
  }

  stepBy(delta) {
    const s = this.state;
    const base = s.target ?? Math.round(s.angle / this.step) * this.step;
    s.target = base - delta * this.step * (this.layout.inward ? -1 : 1);
    s.holdUntil = performance.now() + 2800;
    this.wake();
  }

  /* ───────── 物理 ───────── */
  introCard(elapsed, landing) {
    const s = this.state;
    if (!s.intro) return { radius: 1, lift: 0 };
    const reach = Math.abs(wrap(landing + s.angle));
    if (s.intro.type === 'rise') {
      const delay = (reach / 180) * 480;
      const p = easeOutQuint(clamp((elapsed - delay) / 900, 0, 1));
      return { radius: 1, lift: (1 - p) * s.drop };
    }
    if (s.intro.type === 'assemble') {
      const delay = (reach / 180) * 420;
      const p = easeOut(clamp((elapsed - delay) / 1080, 0, 1));
      return { radius: 1 + 0.6 * (1 - p), lift: 0 };
    }
    if (s.intro.type === 'spin') {
      const p = easeOut(clamp(elapsed / INTRO_LENGTH.spin, 0, 1));
      return { radius: 1 + 0.28 * (1 - p), lift: 0 };
    }
    return { radius: 1, lift: 0 };
  }

  advance(now) {
    const s = this.state;
    const o = this.o;
    const dt = s.last ? Math.min((now - s.last) / 1000, 0.05) : 1 / 60;
    s.last = now;

    if (!s.introDone) {
      if (!s.intro) {
        if (o.intro === 'none') s.introDone = true;
        else s.intro = { type: o.intro, start: now };
      }
      if (s.intro && now - s.intro.start >= (INTRO_LENGTH[s.intro.type] || 0)) {
        s.intro = null;
        s.introDone = true;
      }
    }

    const paused = (o.pauseOnHover && s.hover) || s.drag || now < s.holdUntil;
    const cruise = o.autoplay === 'drift' && !paused && !s.intro ? o.speed * s.dir : 0;
    let busy = Boolean(s.intro) || s.drag;

    if (s.drag || s.intro) {
      s.velocity = s.drag ? s.velocity : 0;
    } else if (s.target !== null) {
      let remaining = dt;
      const damping = 2 * Math.sqrt(SPRING);
      while (remaining > 0) {
        const h = Math.min(remaining, 1 / 240);
        const accel = SPRING * (s.target - s.angle) - damping * s.velocity;
        s.velocity += accel * h;
        s.angle += s.velocity * h;
        remaining -= h;
      }
      if (Math.abs(s.target - s.angle) < 0.004 && Math.abs(s.velocity) < 0.03) {
        s.angle = s.target;
        s.velocity = 0;
        s.target = null;
      }
      busy = true;
    } else {
      const tau = 0.18 + o.momentum * 1.5;
      s.velocity += (cruise - s.velocity) * (1 - Math.exp(-dt / tau));
      s.angle += s.velocity * dt;
      if (cruise === 0 && o.snap && Math.abs(s.velocity) < SETTLE_SPEED) s.target = this.nearest(s.angle);
      busy = busy || cruise !== 0 || Math.abs(s.velocity) > 0.01 || s.target !== null;
    }

    if (o.autoplay === 'step' && !paused && !s.intro && s.introDone) {
      if (!s.stepAt) s.stepAt = now + o.interval * 1000;
      if (now >= s.stepAt) {
        s.target = (s.target ?? this.nearest(s.angle)) + this.step * s.dir;
        s.stepAt = now + o.interval * 1000;
      }
      busy = true;
    } else {
      s.stepAt = 0;
    }

    if (now < s.holdUntil) busy = true;

    const ease = 1 - Math.exp(-dt / 0.35);
    const aimYaw = s.pointer.inside ? s.pointer.x * o.parallax * 9 : 0;
    const aimPitch = s.pointer.inside ? -s.pointer.y * o.parallax * 6 : 0;
    s.yaw += (aimYaw - s.yaw) * ease;
    s.pitch += (aimPitch - s.pitch) * ease;

    return busy;
  }

  render(now) {
    const s = this.state;
    const o = this.o;
    const elapsed = s.intro ? now - s.intro.start : 0;
    const swell = 1 + o.stretch * 0.12 * Math.min(1, Math.abs(s.velocity) / 420);
    const R = this.radius * swell;

    if (this.layout.inward) {
      this.cameraEl.style.transform = `translate3d(0,0,${this.perspective - 1}px) rotateX(${this.tilt + s.pitch}deg) rotateY(${s.yaw}deg)`;
      this.ringEl.style.transform = `rotateY(${s.angle}deg)`;
    } else {
      this.cameraEl.style.transform = `translate3d(0,0,${-R}px) rotateX(${this.tilt + s.pitch}deg) rotateY(${s.yaw}deg)`;
      this.ringEl.style.transform = `rotateY(${s.angle}deg)`;
    }

    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i];
      const base = i * this.step;
      const mod = this.introCard(elapsed, base);
      const r = R * mod.radius;
      let transform = this.layout.inward
        ? `rotateY(${base}deg) translateZ(${-r}px)`
        : `rotateY(${base}deg) translateZ(${r}px)`;
      if (mod.lift) transform += ` translateY(${mod.lift}px)`;
      card.style.transform = transform;

      const world = wrap(base + s.angle);
      if (this.layout.inward) card.style.visibility = Math.abs(world) > 86 ? 'hidden' : '';
      const facing = Math.cos(world * TO_RAD);
      card.style.setProperty('--cc-depth', (o.depthFade * Math.pow((1 - facing) / 2, 1.25)).toFixed(3));
    }

    const index = ((Math.round(-s.angle / this.step) % this.cards.length) + this.cards.length) % this.cards.length || 0;
    if (index !== s.active) {
      s.active = index;
      if (this.o.onChange) this.o.onChange(index, this.items[index]);
    }
  }

  wake() {
    if (this.raf || !this.visible || document.hidden) return;
    const frame = (now) => {
      this.raf = 0;
      const busy = this.advance(now);
      this.render(now);
      if (busy && this.visible && !document.hidden) this.raf = requestAnimationFrame(frame);
      else this.state.last = 0;
    };
    this.raf = requestAnimationFrame(frame);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro && this.ro.disconnect();
    this.io && this.io.disconnect();
    this.root.innerHTML = '';
  }
}

return CircularCarousel;
})();


const QS = new URLSearchParams(location.search);
const STILL = QS.has('still');

/* 首屏旗帜：慢流 0.45（原来是 1.4，太快像彩带） */
const SILK_PARAMS = {
  color:'#d7000f', sheenColor:'#ffb300', depth:0.8, speed:0.45, scale:1.2,
  rotation:0.45, wave:1.7, variation:1, glow:0.3, fade:0.1
};
/* 页脚旗帜：深红、反向纹理、更慢更亮——不再与首屏共用同一套参数 */
const FOOT_SILK_PARAMS = {
  ...SILK_PARAMS, color:'#a8000b', rotation:-0.45, speed:0.85, glow:0.16, scale:1.35
};
const OIL_PARAMS = {
  color:'#031206', speed:0.1, amplitude:0.28, detail:3, thickness:1.2,
  interactive:true, frequencyX:1.5, frequencyY:2.5, depth:1.2, roughness:0.22,
  exposure:0.75, rippleStrength:0.15, rippleSize:2, tilt:0.75, lightMode:false
};

/* 三处背景都是「加分项」：任何一处初始化失败都不能拖垮导航/团队/菜单。
   失败时给 html 挂 .no-webgl，由 CSS 兜底渐变接管首屏。 */
let heroFlag = null, bodyOil = null, footFlag = null;
try {
  heroFlag = new Silk('#heroBg', { ...SILK_PARAMS, intro:!STILL });
} catch (err) { console.warn('[bg] 首屏 Silk 初始化失败：', err); }
try {
  bodyOil = new LiquidChrome('#bodyBg', { ...OIL_PARAMS, intro:!STILL });
} catch (err) { console.warn('[bg] LiquidChrome 初始化失败：', err); }
try {
  footFlag = new Silk('#footBg', { ...FOOT_SILK_PARAMS, intro:!STILL });
} catch (err) { console.warn('[bg] 页脚 Silk 初始化失败：', err); }

if (!heroFlag || !bodyOil || !footFlag ||
    heroFlag.supported === false || footFlag.supported === false || bodyOil.supported === false) {
  document.documentElement.classList.add('no-webgl');
}
if (STILL) {
  if (heroFlag && heroFlag.debug) heroFlag.debug.advance(9000);
  if (bodyOil && bodyOil.debug) bodyOil.debug.step(40000);
  if (footFlag && footFlag.debug) footFlag.debug.advance(9000);
}
window.__site = { heroFlag, bodyOil, footFlag };

/* 偶发加速：默认 0.45 的慢流，每 9–14 秒临时提到 1.6 保持 1.2 秒再回落。
   只在首屏 Silk 正常、且用户没要求减少动效时运行。 */
(function flagBurst(){
  if (!heroFlag || heroFlag.supported === false || STILL) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const BASE = SILK_PARAMS.speed, PEAK = 1.6, HOLD = 1200;
  let gapTimer = 0, holdTimer = 0, stopped = false;
  function schedule(){
    if (stopped) return;
    gapTimer = setTimeout(() => {
      if (stopped) return;
      heroFlag.setSpeed(PEAK);
      holdTimer = setTimeout(() => {
        heroFlag.setSpeed(BASE);
        schedule();
      }, HOLD);
    }, 9000 + Math.random() * 5000);
  }
  function stop(){
    stopped = true;
    clearTimeout(gapTimer); clearTimeout(holdTimer);
    heroFlag.setSpeed(BASE);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(); else { stopped = false; schedule(); }
  });
  schedule();
})();

/* ── 导航：滚动高亮 + 悬浮底色 ── */
const nav = document.getElementById('nav');
const links = [...document.querySelectorAll('.nav__links a, .drawer a')];
const ids = ['about','matrix','works','honor','team'];
const secs = ids.map(id => document.getElementById(id)).filter(Boolean);

function setActive(id){
  links.forEach(a => a.classList.toggle('is-active', a.getAttribute('href') === '#' + id));
}
const spy = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) setActive(e.target.id); });
}, { rootMargin:'-45% 0px -50% 0px', threshold:0 });
secs.forEach(s => spy.observe(s));

const onScroll = () => nav.classList.toggle('is-solid', window.scrollY > window.innerHeight * 0.6);
onScroll();
window.addEventListener('scroll', onScroll, { passive:true });

/* ── 移动端菜单 ── */
const burger = document.getElementById('burger');
const drawer = document.getElementById('drawer');
function closeMenu(){
  document.body.classList.remove('menu-open','is-locked');
  burger.setAttribute('aria-expanded','false');
  drawer.setAttribute('aria-hidden','true');
}
burger.addEventListener('click', () => {
  const open = document.body.classList.toggle('menu-open');
  document.body.classList.toggle('is-locked', open);
  burger.setAttribute('aria-expanded', String(open));
  drawer.setAttribute('aria-hidden', String(!open));
  burger.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
});
drawer.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
window.addEventListener('resize', () => { if (innerWidth >= 900) closeMenu(); });

/* 截图验收：?only=about|matrix|works|honor|team|follow */
const only = QS.get('only');
if (only) {
  document.querySelectorAll('section, footer, header').forEach(el => {
    if (el.id !== only && el.id !== 'nav') el.style.display = 'none';
  });
  const el = document.getElementById(only);
  if (el) el.style.paddingTop = 'calc(var(--nav-h) + 32px)';
}

/* 团队区：桌面用环形画廊，窄屏/触屏/减少动效用卡片网格。
   关键：宽度跨越 1024 时要能双向切换——窄窗口加载后把窗口拉大，
   环廊必须自己长出来（曾因只在初始化判断一次，拉宽后永久停在网格）。 */
(function initTeamRing(){
  var grid = document.getElementById('teamGrid');
  var ringEl = document.getElementById('teamRing');
  var capEl = document.getElementById('teamCap');
  if (!grid || !ringEl || !capEl || typeof CircularCarousel === 'undefined') return;

  var instance = null;
  var builtCardWidth = 0;

  /* ?ring=1 强制环廊 / ?ring=0 强制网格（便于预览面板验收） */
  function forced(){
    var v = QS.get('ring');
    return v === '1' ? true : (v === '0' ? false : null);
  }
  /* 环廊是这块的主设计，所有尺寸都启用（曾经按宽度/触屏关掉，窄屏从「有」变「无」，
     属于退化，已撤销）。只有显式 ?ring=0 才回落网格。 */
  function eligible(){
    var f = forced();
    return f === null ? true : f;
  }
  function reduceMotion(){
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  /* 卡片尺寸只有两档，跨 700px 时需要重建（构造时读取，改不了） */
  function cardWidthFor(){
    return window.innerWidth < 700 ? 196 : 280;
  }

  function makeItems(){
    var cards = Array.prototype.slice.call(grid.querySelectorAll('.mcard'));
    return cards.map(function(c){
      var face = document.createElement('div');
      face.className = 'ccface';
      var srcImg = c.querySelector('.mcard__fig img');
      var img = document.createElement('img');
      img.src = srcImg.currentSrc || srcImg.src;
      img.alt = srcImg.alt || '';
      img.decoding = 'async';
      img.draggable = false;
      face.appendChild(img);
      var ov = document.createElement('div');
      ov.className = 'ccface__ov';
      var n = document.createElement('span');
      n.className = 'ccface__n';
      n.textContent = c.querySelector('.mcard__n').textContent.trim();
      var t = document.createElement('span');
      t.className = 'ccface__t';
      t.textContent = c.querySelector('.mcard__tag').textContent.trim();
      ov.appendChild(n); ov.appendChild(t);
      face.appendChild(ov);
      return { el: face, card: c };
    });
  }

  function build(){
    if (instance) return;
    // 每次重建都换一个干净的宿主节点：旧节点连同它身上的监听一起丢弃，避免重复绑定
    var stale = ringEl.querySelector('.ring__cc');
    if (stale) stale.parentNode.removeChild(stale);
    var ccHost = document.createElement('div');
    ccHost.className = 'ring__cc';
    ringEl.appendChild(ccHost);

    var items = makeItems();
    function q(sel){ return capEl.querySelector(sel); }
    function setCap(index){
      var c = items[index].card;
      q('.caps__n').textContent = c.querySelector('.mcard__n').textContent.trim();
      q('.caps__t').textContent = c.querySelector('.mcard__tag').textContent.trim();
      q('.caps__r').innerHTML = c.querySelector('.mcard__role').innerHTML;
      var bio = c.querySelector('.mcard__bio');
      q('.caps__b').innerHTML = bio ? bio.innerHTML : '';
      q('.caps__c').innerHTML = c.querySelector('.mcard__foot').innerHTML;
    }

    grid.style.display = 'none';
    ringEl.hidden = false;
    capEl.hidden = false;
    builtCardWidth = cardWidthFor();
    instance = new CircularCarousel(ccHost, items, {
      preset: (QS.get('preset') || 'panorama'), intro: 'rise',
      cardWidth: builtCardWidth, aspectRatio: 0.75,
      speed: 14, gap: 30, tilt: 0, curve: 1, perspective: 1800,
      autoplay: reduceMotion() ? 'off' : 'step', interval: 3, direction: 'left', momentum: 0.6,
      snap: true, pauseOnHover: true, focusOnClick: true, draggable: true,
      parallax: 0.3, stretch: 0.3, fadeColor: '#000000',
      depthFade: 0.55, innerShade: 0.6, cornerRadius: 12,
      onChange: setCap
    });
    setCap(0);
  }

  function teardown(){
    if (!instance) return;
    try { instance.destroy(); } catch (err) { /* 组件自清理失败不阻塞回退 */ }
    instance = null;
    var host = ringEl.querySelector('.ring__cc');
    if (host) host.parentNode.removeChild(host);
    ringEl.hidden = true;
    capEl.hidden = true;
    grid.style.display = '';
  }

  function apply(){
    var want = eligible();
    document.documentElement.classList.toggle('force-ring', forced() === true);
    if (!want) { teardown(); return; }
    if (instance && builtCardWidth !== cardWidthFor()) teardown();
    build();
  }

  apply();
  var raf = 0;
  window.addEventListener('resize', function(){
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(apply);
  });
  window.addEventListener('orientationchange', function(){ setTimeout(apply, 120); });
})();

/* 触屏设备：站内外链改「当前标签」打开。
   手机浏览器对 target="_blank" 常把新页开在后台，用户看不到跳转；
   微信等内嵌 WebView 更直接，会把外链拦成「复制链接」。 */
if (window.matchMedia && window.matchMedia('(hover: none)').matches) {
  document.querySelectorAll('a[target="_blank"]').forEach(function (a) {
    a.removeAttribute('target');
  });
}

})();

