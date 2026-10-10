import { useEffect, useRef } from "react";

const LOW_END_MEMORY_GB = 2;
const LOW_END_CORES = 2;
const MAX_DPR = 2;

const hexToRgb = (hex: string): [number, number, number] => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [1, 1, 1];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
};

const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uTimeSpeed;
uniform float uColorBalance;
uniform float uWarpStrength;
uniform float uWarpFrequency;
uniform float uWarpSpeed;
uniform float uWarpAmplitude;
uniform float uBlendAngle;
uniform float uBlendSoftness;
uniform float uRotationAmount;
uniform float uNoiseScale;
uniform float uGrainAmount;
uniform float uGrainScale;
uniform float uGrainAnimated;
uniform float uContrast;
uniform float uGamma;
uniform float uSaturation;
uniform vec2 uCenterOffset;
uniform float uZoom;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
out vec4 fragColor;
#define S(a,b,t) smoothstep(a,b,t)
mat2 Rot(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);}
vec2 hash(vec2 p){p=vec2(dot(p,vec2(2127.1,81.17)),dot(p,vec2(1269.5,283.37)));return fract(sin(p)*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);float n=mix(mix(dot(-1.0+2.0*hash(i+vec2(0.0,0.0)),f-vec2(0.0,0.0)),dot(-1.0+2.0*hash(i+vec2(1.0,0.0)),f-vec2(1.0,0.0)),u.x),mix(dot(-1.0+2.0*hash(i+vec2(0.0,1.0)),f-vec2(0.0,1.0)),dot(-1.0+2.0*hash(i+vec2(1.0,1.0)),f-vec2(1.0,1.0)),u.x),u.y);return 0.5+0.5*n;}
void mainImage(out vec4 o, vec2 C){
  float t=iTime*uTimeSpeed;
  vec2 uv=C/iResolution.xy;
  float ratio=iResolution.x/iResolution.y;
  vec2 tuv=uv-0.5+uCenterOffset;
  tuv/=max(uZoom,0.001);
  float degree=noise(vec2(t*0.1,tuv.x*tuv.y)*uNoiseScale);
  tuv.y*=1.0/ratio;
  tuv*=Rot(radians((degree-0.5)*uRotationAmount+180.0));
  tuv.y*=ratio;
  float frequency=uWarpFrequency;
  float ws=max(uWarpStrength,0.001);
  float amplitude=uWarpAmplitude/ws;
  float warpTime=t*uWarpSpeed;
  tuv.x+=sin(tuv.y*frequency+warpTime)/amplitude;
  tuv.y+=sin(tuv.x*(frequency*1.5)+warpTime)/(amplitude*0.5);
  vec3 colLav=uColor1;
  vec3 colOrg=uColor2;
  vec3 colDark=uColor3;
  float b=uColorBalance;
  float s=max(uBlendSoftness,0.0);
  mat2 blendRot=Rot(radians(uBlendAngle));
  float blendX=(tuv*blendRot).x;
  float edge0=-0.3-b-s;
  float edge1=0.2-b+s;
  float v0=0.5-b+s;
  float v1=-0.3-b-s;
  vec3 layer1=mix(colDark,colOrg,S(edge0,edge1,blendX));
  vec3 layer2=mix(colOrg,colLav,S(edge0,edge1,blendX));
  vec3 col=mix(layer1,layer2,S(v0,v1,tuv.y));
  vec2 grainUv=uv*max(uGrainScale,0.001);
  if(uGrainAnimated>0.5){grainUv+=vec2(iTime*0.05);}
  float grain=fract(sin(dot(grainUv,vec2(12.9898,78.233)))*43758.5453);
  col+=(grain-0.5)*uGrainAmount;
  col=(col-0.5)*uContrast+0.5;
  float luma=dot(col,vec3(0.2126,0.7152,0.0722));
  col=mix(vec3(luma),col,uSaturation);
  col=pow(max(col,0.0),vec3(1.0/max(uGamma,0.001)));
  col=clamp(col,0.0,1.0);
  o=vec4(col,1.0);
}
void main(){ vec4 o=vec4(0.0); mainImage(o,gl_FragCoord.xy); fragColor=o; }
`;

export interface GrainientProps {
  timeSpeed?: number;
  colorBalance?: number;
  warpStrength?: number;
  warpFrequency?: number;
  warpSpeed?: number;
  warpAmplitude?: number;
  blendAngle?: number;
  blendSoftness?: number;
  rotationAmount?: number;
  noiseScale?: number;
  grainAmount?: number;
  grainScale?: number;
  grainAnimated?: boolean;
  contrast?: number;
  gamma?: number;
  saturation?: number;
  centerX?: number;
  centerY?: number;
  zoom?: number;
  color1?: string;
  color2?: string;
  color3?: string;
  className?: string;
}

export default function Grainient({
  timeSpeed = 0.25,
  colorBalance = -0.78,
  warpStrength = 1.5,
  warpFrequency = 0,
  warpSpeed = 0,
  warpAmplitude = 50,
  blendAngle = 114,
  blendSoftness = 0.4,
  rotationAmount = 460,
  noiseScale = 3.1,
  grainAmount = 0.26,
  grainScale = 0.4,
  grainAnimated = false,
  contrast = 1.5,
  gamma = 1,
  saturation = 0.9,
  centerX = 0,
  centerY = 0,
  zoom = 0.9,
  color1 = "#000000",
  color2 = "#000000",
  color3 = "#5a2410",
  className = "",
}: GrainientProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    const [r3, g3, b3] = hexToRgb(color3);
    const cssFallback = `radial-gradient(ellipse at 85% 90%, rgba(${Math.round(
      r3 * 255
    )},${Math.round(g3 * 255)},${Math.round(b3 * 255)},0.10) 0%, ${color1} 50%)`;

    const nav = navigator as Navigator & { deviceMemory?: number };
    const mem = nav.deviceMemory ?? 8;
    const cores = navigator.hardwareConcurrency || 8;
    if (mem <= LOW_END_MEMORY_GB || cores <= LOW_END_CORES) {
      container.style.background = cssFallback;
      return;
    }

    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { alpha: true, antialias: false });
    if (!gl) {
      container.style.background = cssFallback;
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    container.appendChild(canvas);

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      container.style.background = cssFallback;
      return;
    }
    gl.useProgram(program);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const U = (n: string) => gl.getUniformLocation(program, n);
    const u = {
      iTime: U("iTime"),
      iResolution: U("iResolution"),
    };
    gl.uniform1f(U("uTimeSpeed"), timeSpeed);
    gl.uniform1f(U("uColorBalance"), colorBalance);
    gl.uniform1f(U("uWarpStrength"), warpStrength);
    gl.uniform1f(U("uWarpFrequency"), warpFrequency);
    gl.uniform1f(U("uWarpSpeed"), warpSpeed);
    gl.uniform1f(U("uWarpAmplitude"), warpAmplitude);
    gl.uniform1f(U("uBlendAngle"), blendAngle);
    gl.uniform1f(U("uBlendSoftness"), blendSoftness);
    gl.uniform1f(U("uRotationAmount"), rotationAmount);
    gl.uniform1f(U("uNoiseScale"), noiseScale);
    gl.uniform1f(U("uGrainAmount"), grainAmount);
    gl.uniform1f(U("uGrainScale"), grainScale);
    gl.uniform1f(U("uGrainAnimated"), grainAnimated ? 1 : 0);
    gl.uniform1f(U("uContrast"), contrast);
    gl.uniform1f(U("uGamma"), gamma);
    gl.uniform1f(U("uSaturation"), saturation);
    gl.uniform2f(U("uCenterOffset"), centerX, centerY);
    gl.uniform1f(U("uZoom"), zoom);
    gl.uniform3fv(U("uColor1"), hexToRgb(color1));
    gl.uniform3fv(U("uColor2"), hexToRgb(color2));
    gl.uniform3fv(U("uColor3"), hexToRgb(color3));

    const setSize = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width * dpr));
      const h = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(u.iResolution, w, h);
    };
    const ro = new ResizeObserver(setSize);
    ro.observe(container);
    setSize();

    let raf = 0;
    const t0 = performance.now();
    const loop = (t: number) => {
      gl.uniform1f(u.iTime, (t - t0) * 0.001);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onLost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(raf);
      container.style.background = cssFallback;
    };
    canvas.addEventListener("webglcontextlost", onLost, false);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("webglcontextlost", onLost);
      ro.disconnect();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      try {
        container.removeChild(canvas);
      } catch {}
    };
  }, []);

  return <div ref={ref} className={`grainient ${className}`.trim()} aria-hidden />;
}
