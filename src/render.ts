// WebGL2 renderer. Three passes per frame:
//  1. Light map (quarter res): additive gaussian lights, then the Hush subtract light.
//  2. World: one fullscreen shader draws the cave as topographic contour lines,
//     visible only where the light map (or a Hum's sonar ring) reaches.
//  3. Sprites: instanced quads for motes, sleepers and the Hush.

import { WORLD, G } from './world';

const QUAD_VS = `#version 300 es
layout(location=0) in vec2 corner;
layout(location=1) in vec4 i0; // x, y, size, shape(+seed fraction)
layout(location=2) in vec4 i1; // rgba
uniform vec2 uCam; uniform vec2 uView;
out vec2 vUv; out vec4 vCol; out float vShape;
void main(){
  vec2 w = i0.xy + corner * i0.z;
  vec2 ndc = (w - uCam) / (uView * 0.5);
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  vUv = corner; vCol = i1; vShape = i0.w;
}`;

const LIGHT_FS = `#version 300 es
precision mediump float;
in vec2 vUv; in vec4 vCol; in float vShape;
out vec4 o;
void main(){
  float d2 = dot(vUv, vUv);
  float f = exp(-d2 * 3.6) * (1.0 - smoothstep(0.85, 1.0, d2));
  o = vec4(vCol.rgb * vCol.a * f, 1.0);
}`;

const SPRITE_FS = `#version 300 es
precision highp float;
in vec2 vUv; in vec4 vCol; in float vShape;
uniform float uTime;
out vec4 o;
void main(){
  float shape = floor(vShape + 0.001);
  float seed = fract(vShape) * 37.0;
  float r = length(vUv);
  float ang = atan(vUv.y, vUv.x);
  vec3 c = vCol.rgb; float a = vCol.a;
  if (shape < 0.5) {            // 0: soft glow mote
    float core = exp(-r * r * 26.0) * 1.4 + exp(-r * r * 5.0) * 0.32;
    o = vec4(c * a * core, 1.0);
  } else if (shape < 1.5) {     // 1: ring
    float w = 0.05;
    float k = 1.0 - smoothstep(0.0, w, abs(r - 0.86));
    o = vec4(c * a * k, 1.0);
  } else if (shape < 2.5) {     // 2: the Hush, an inky ragged absence (alpha blended)
    float edge = 0.74 + 0.10 * sin(ang * 5.0 + uTime * 1.7 + seed) + 0.05 * sin(ang * 11.0 - uTime * 2.9 + seed * 2.0)
               + 0.04 * sin(ang * 3.0 + uTime * 0.7);
    float body = smoothstep(edge, edge - 0.32, r);
    float rim = smoothstep(edge - 0.16, edge - 0.02, r) * smoothstep(edge + 0.06, edge - 0.02, r);
    vec2 e1 = vUv - vec2(-0.2, -0.08), e2 = vUv - vec2(0.2, -0.08);
    float blink = step(0.06, fract(uTime * 0.21 + seed * 0.1));
    float eyes = (smoothstep(0.06, 0.02, length(e1 * vec2(1.0, 1.8))) + smoothstep(0.06, 0.02, length(e2 * vec2(1.0, 1.8)))) * blink;
    vec3 col = vec3(0.004, 0.003, 0.012) + vec3(0.30, 0.20, 0.55) * rim * 0.55 + vec3(0.75, 0.72, 0.95) * eyes * 0.55;
    o = vec4(col, max(body, rim * 0.6) * a);
  } else if (shape < 3.5) {     // 3: crisp dot
    float k = 1.0 - smoothstep(0.55, 1.0, r);
    o = vec4(c * a * k, 1.0);
  } else if (shape < 4.5) {     // 4: woken sleeper, slowly turning rays
    float rays = pow(abs(cos(ang * 3.0 + uTime * 0.25)), 24.0) + pow(abs(cos(ang * 5.0 - uTime * 0.17)), 40.0) * 0.6;
    float k = exp(-r * r * 40.0) * 2.0 + exp(-r * r * 6.0) * 0.4 + rays * exp(-r * 2.6) * 0.5;
    o = vec4(c * a * k * (1.0 - smoothstep(0.9, 1.0, r)), 1.0);
  } else {                      // 5: dormant sleeper glyph
    float ring = 1.0 - smoothstep(0.0, 0.035, abs(r - 0.62));
    float inner = 1.0 - smoothstep(0.0, 0.03, abs(r - 0.28 - 0.02 * sin(uTime * 1.3)));
    float tick = step(0.97, abs(cos(ang * 6.0))) * step(r, 0.62) * step(0.45, r);
    o = vec4(c * a * (ring * 0.8 + inner * 0.6 + tick * 0.5), 1.0);
  }
}`;

const FULL_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1,-1), vec2(3,-1), vec2(-1,3));
out vec2 vUv;
void main(){ vec2 p = P[gl_VertexID]; vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0, 1); }`;

const WORLD_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uField; uniform sampler2D uLight;
uniform vec2 uCam; uniform vec2 uView;
uniform float uWorld; uniform float uTime; uniform float uLightScale; uniform float uAmbient;
uniform vec4 uRing; uniform float uFade;
out vec4 o;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 hash2(vec2 p){ return vec2(hash(p), hash(p + 19.19)); }
void main(){
  vec2 wp = uCam + (vUv - 0.5) * uView * vec2(1.0, -1.0);
  float s = texture(uField, wp / uWorld).r;
  vec3 L = texture(uLight, vUv).rgb * uLightScale;
  vec3 lit = 1.0 - exp(-L * 1.3);
  float lum = max(lit.r, max(lit.g, lit.b));

  float ring = 0.0;
  if (uRing.w > 0.0) {
    float rd = length(wp - uRing.xy) - uRing.z;
    ring = exp(-rd * rd / 3200.0) * uRing.w + exp(-rd * rd / 60000.0) * uRing.w * 0.25 * step(rd, 0.0);
  }

  float rock = smoothstep(0.485, 0.515, s);
  float k = s * 15.0;
  float fr = fract(k);
  float contour = 1.0 - smoothstep(0.5, 1.4, min(fr, 1.0 - fr) / max(fwidth(k), 1e-4));
  float edge = 1.0 - smoothstep(0.6, 2.2, abs(s - 0.5) / max(fwidth(s), 1e-5));

  vec3 water = vec3(0.010, 0.016, 0.032);
  vec3 stone = vec3(0.022, 0.026, 0.044);
  vec3 col = mix(water, stone, rock);
  float vis = lum + ring + uAmbient;
  vec3 lineCol = mix(vec3(0.20, 0.55, 0.62), vec3(0.34, 0.80, 0.74), rock);
  col += lineCol * contour * mix(0.10, 0.5, rock) * vis;
  col += vec3(0.80, 0.94, 0.90) * edge * (lum * 1.2 + ring * 0.9 + uAmbient * 2.0);
  col += lit * mix(vec3(0.16, 0.08, 0.06), vec3(0.05, 0.05, 0.07), rock);

  // Marine snow: drifting specks only light can reveal.
  vec2 g = wp / 26.0 + vec2(sin(uTime * 0.05) * 2.0, uTime * 0.22);
  vec2 id = floor(g); vec2 f = fract(g) - 0.5;
  vec2 off = (hash2(id) - 0.5) * 0.7;
  float speck = smoothstep(0.09, 0.0, length(f - off)) * step(0.78, hash(id + 3.1));
  col += vec3(0.75, 0.85, 0.9) * speck * (lum * 0.9 + ring * 0.4 + 0.015) * (1.0 - rock);

  vec2 q = vUv - 0.5;
  col *= 1.0 - dot(q, q) * 0.85;
  col *= uFade;
  col += (hash(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) / 255.0;
  o = vec4(col, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
  return p;
}

const FLOATS = 8;

class Batch {
  data: Float32Array;
  n = 0;
  constructor(cap: number) { this.data = new Float32Array(cap * FLOATS); }
  push(x: number, y: number, size: number, shape: number, r: number, g: number, b: number, a: number) {
    if ((this.n + 1) * FLOATS > this.data.length) {
      const d = new Float32Array(this.data.length * 2); d.set(this.data); this.data = d;
    }
    const o = this.n++ * FLOATS, d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = size; d[o + 3] = shape;
    d[o + 4] = r; d[o + 5] = g; d[o + 6] = b; d[o + 7] = a;
  }
}

export interface Camera { x: number; y: number; viewH: number }

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement;
  private lightProg: WebGLProgram; private spriteProg: WebGLProgram; private worldProg: WebGLProgram;
  private vao: WebGLVertexArrayObject; private inst: WebGLBuffer;
  private emptyVao: WebGLVertexArrayObject;
  private fieldTex: WebGLTexture;
  private lightTex: WebGLTexture | null = null; private lightFbo: WebGLFramebuffer | null = null;
  private lw = 0; private lh = 0;
  private lightScale = 1; private halfFloat: boolean;
  readonly lights = new Batch(1024);
  readonly shadows = new Batch(64);
  readonly glows = new Batch(2048);
  readonly darks = new Batch(64);
  view = { w: 1, h: 1 };
  private u = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.halfFloat = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
    this.lightScale = this.halfFloat ? 1 : 4;

    this.lightProg = compile(gl, QUAD_VS, LIGHT_FS);
    this.spriteProg = compile(gl, QUAD_VS, SPRITE_FS);
    this.worldProg = compile(gl, FULL_VS, WORLD_FS);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.inst = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.bufferData(gl.ARRAY_BUFFER, 4096 * FLOATS * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, FLOATS * 4, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, FLOATS * 4, 16); gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    this.emptyVao = gl.createVertexArray()!;

    this.fieldTex = gl.createTexture()!;
  }

  uploadField(bytes: Uint8Array) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, G, G, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (w === this.canvas.width && h === this.canvas.height && this.lightTex) return;
    this.canvas.width = w; this.canvas.height = h;
    const gl = this.gl;
    this.lw = Math.max(1, Math.ceil(w / 4)); this.lh = Math.max(1, Math.ceil(h / 4));
    if (this.lightTex) gl.deleteTexture(this.lightTex);
    if (this.lightFbo) gl.deleteFramebuffer(this.lightFbo);
    this.lightTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.lightTex);
    if (this.halfFloat) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, this.lw, this.lh, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.lw, this.lh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.lightFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lightFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.lightTex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE && this.halfFloat) {
      // Fall back to 8-bit light if half-float targets are refused.
      this.halfFloat = false; this.lightScale = 4;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.lightTex = null; this.resize(); return;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  setCamera(cam: Camera) {
    const aspect = this.canvas.width / this.canvas.height;
    // Keep the shorter screen side showing about cam.viewH world units.
    if (aspect >= 1) { this.view.h = cam.viewH; this.view.w = cam.viewH * aspect; }
    else { this.view.w = cam.viewH; this.view.h = cam.viewH / aspect; }
  }

  beginFrame() { this.lights.n = 0; this.shadows.n = 0; this.glows.n = 0; this.darks.n = 0; }

  private loc(p: WebGLProgram, name: string) {
    let m = this.u.get(p);
    if (!m) { m = new Map(); this.u.set(p, m); }
    if (!m.has(name)) m.set(name, this.gl.getUniformLocation(p, name));
    return m.get(name)!;
  }

  private drawBatch(prog: WebGLProgram, b: Batch, cam: Camera, time: number) {
    if (!b.n) return;
    const gl = this.gl;
    gl.useProgram(prog);
    gl.uniform2f(this.loc(prog, 'uCam'), cam.x, cam.y);
    gl.uniform2f(this.loc(prog, 'uView'), this.view.w, this.view.h);
    const ut = this.loc(prog, 'uTime'); if (ut) gl.uniform1f(ut, time);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    const bytes = b.n * FLOATS * 4;
    if (bytes > gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE)) gl.bufferData(gl.ARRAY_BUFFER, bytes * 2, gl.DYNAMIC_DRAW);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, b.data, 0, b.n * FLOATS);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, b.n);
  }

  endFrame(cam: Camera, time: number, ring: [number, number, number, number], ambient: number, fade: number) {
    const gl = this.gl;
    // Pass 1: light map.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lightFbo);
    gl.viewport(0, 0, this.lw, this.lh);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE);
    const ls = 1 / this.lightScale;
    if (ls !== 1) for (let i = 0; i < this.lights.n; i++) this.lights.data[i * FLOATS + 7] *= ls;
    this.drawBatch(this.lightProg, this.lights, cam, time);
    gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT);
    if (ls !== 1) for (let i = 0; i < this.shadows.n; i++) this.shadows.data[i * FLOATS + 7] *= ls;
    this.drawBatch(this.lightProg, this.shadows, cam, time);
    gl.blendEquation(gl.FUNC_ADD);

    // Pass 2: world.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND);
    const p = this.worldProg;
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.lightTex);
    gl.uniform1i(this.loc(p, 'uField'), 0); gl.uniform1i(this.loc(p, 'uLight'), 1);
    gl.uniform2f(this.loc(p, 'uCam'), cam.x, cam.y);
    gl.uniform2f(this.loc(p, 'uView'), this.view.w, this.view.h);
    gl.uniform1f(this.loc(p, 'uWorld'), WORLD);
    gl.uniform1f(this.loc(p, 'uTime'), time);
    gl.uniform1f(this.loc(p, 'uLightScale'), this.lightScale);
    gl.uniform1f(this.loc(p, 'uAmbient'), ambient);
    gl.uniform1f(this.loc(p, 'uFade'), fade);
    gl.uniform4f(this.loc(p, 'uRing'), ring[0], ring[1], ring[2], ring[3]);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Pass 3: sprites. Darks (alpha) first, then glows (additive) on top.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (fade < 1) for (let i = 0; i < this.darks.n; i++) this.darks.data[i * FLOATS + 7] *= fade;
    this.drawBatch(this.spriteProg, this.darks, cam, time);
    gl.blendFunc(gl.ONE, gl.ONE);
    if (fade < 1) for (let i = 0; i < this.glows.n; i++) this.glows.data[i * FLOATS + 7] *= fade;
    this.drawBatch(this.spriteProg, this.glows, cam, time);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
}
