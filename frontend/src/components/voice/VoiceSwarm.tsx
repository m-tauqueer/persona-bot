import { useEffect, useRef, type CSSProperties } from "react";
import { expApproach } from "../../lib/swarmHear";
import type { VoiceClientConfig } from "../../lib/voiceConfig";

type SwarmUniforms = {
  time: WebGLUniformLocation | null;
  hear: WebGLUniformLocation | null;
  amplitude: WebGLUniformLocation | null;
  count: WebGLUniformLocation | null;
  radiusCalm: WebGLUniformLocation | null;
  radiusHear: WebGLUniformLocation | null;
  speedCalm: WebGLUniformLocation | null;
  speedHear: WebGLUniformLocation | null;
  noiseCalm: WebGLUniformLocation | null;
  noiseHear: WebGLUniformLocation | null;
  pointCalm: WebGLUniformLocation | null;
  pointHear: WebGLUniformLocation | null;
  hueCalm: WebGLUniformLocation | null;
  hueHear: WebGLUniformLocation | null;
  satCalm: WebGLUniformLocation | null;
  satHear: WebGLUniformLocation | null;
  lightCalm: WebGLUniformLocation | null;
  lightHear: WebGLUniformLocation | null;
  perspective: WebGLUniformLocation | null;
  levelNoise: WebGLUniformLocation | null;
  warpCalm: WebGLUniformLocation | null;
  warpHear: WebGLUniformLocation | null;
  coupling: WebGLUniformLocation | null;
  swirl: WebGLUniformLocation | null;
  pixelRatio: WebGLUniformLocation | null;
  aspect: WebGLUniformLocation | null;
};

type WebGLResources = {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  buffer: WebGLBuffer;
  count: number;
  uniforms: SwarmUniforms;
};

const VERTEX_SHADER = `
  attribute float aIndex;
  uniform float uTime;
  uniform float uHear;
  uniform float uAmplitude;
  uniform float uCount;
  uniform float uRadiusCalm;
  uniform float uRadiusHear;
  uniform float uSpeedCalm;
  uniform float uSpeedHear;
  uniform float uNoiseCalm;
  uniform float uNoiseHear;
  uniform float uPointCalm;
  uniform float uPointHear;
  uniform float uHueCalm;
  uniform float uHueHear;
  uniform float uSatCalm;
  uniform float uSatHear;
  uniform float uLightCalm;
  uniform float uLightHear;
  uniform float uPerspective;
  uniform float uLevelNoise;
  uniform float uWarpCalm;
  uniform float uWarpHear;
  uniform float uCoupling;
  uniform float uSwirl;
  uniform float uPixelRatio;
  uniform float uAspect;
  varying vec3 vColor;
  varying float vGain;

  vec3 hslRgb(float h, float s, float l) {
    vec3 hue = abs(mod(fract(h) * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0);
    vec3 rgb = clamp(hue - 1.0, 0.0, 1.0);
    return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
  }

  void main() {
    float count = max(uCount, 1.0);
    float id = aIndex;
    float n = id / max(count - 1.0, 1.0);
    float hear = clamp(uHear, 0.0, 1.0);
    hear = hear * hear * (3.0 - 2.0 * hear);
    float gold = 2.399963229728653;
    float theta = id * gold;
    float y = mix(-1.0, 1.0, n);
    float radial = sqrt(max(1.0 - y * y, 0.0));
    float t = uTime;
    float spin = t * mix(uSpeedCalm, uSpeedHear, hear);
    float cs = cos(spin);
    float sn = sin(spin);
    float x0 = radial * cos(theta);
    float z0 = radial * sin(theta);
    float x = x0 * cs - z0 * sn;
    float z = x0 * sn + z0 * cs;
    float field = mix(uNoiseCalm, uNoiseHear, hear);
    float tFast = t * mix(uWarpCalm, uWarpHear, hear);
    float s1 = sin(x * 2.17 + tFast);
    float s2 = sin(y * 2.41 - tFast * 0.83);
    float s3 = sin(z * 1.91 + tFast * 1.19);
    float c1 = cos(y * 3.07 + tFast * 0.49);
    float c2 = cos(z * 2.63 - tFast * 0.61);
    float c3 = cos(x * 2.89 + tFast * 0.93);
    x += field * (s2 - 0.16 * x + hear * uCoupling * c1 * s3);
    y += field * (s3 - 0.16 * y + hear * uCoupling * c2 * s1);
    z += field * (s1 - 0.16 * z + hear * uCoupling * c3 * s2);
    float swirl = hear * field * uSwirl;
    x += swirl * sin(theta * 5.0 + tFast * 1.87 + y * 8.0);
    y += swirl * cos(theta * 4.0 - tFast * 1.41 + z * 7.0);
    z += swirl * sin(id * 0.011 + tFast * 2.17);
    float breath = 1.0 + (1.0 - hear) * 0.04 * sin(t * 0.62);
    float radius = mix(uRadiusCalm, uRadiusHear, hear) * breath;
    radius *= 1.0 + clamp(uAmplitude, 0.0, 1.2) * uLevelNoise;
    vec3 p = vec3(x, y, z) * radius;
    float depth = max(uPerspective + p.z, 0.22);
    vec2 pos = vec2(p.x, p.y) / depth;
    pos.x /= max(uAspect, 0.05);
    gl_Position = vec4(pos, 0.0, 1.0);
    float size = mix(uPointCalm, uPointHear, hear) * uPixelRatio / depth;
    gl_PointSize = clamp(size, 1.0, 64.0);
    float hue = mix(uHueCalm, uHueHear, hear);
    float sat = mix(uSatCalm, uSatHear, hear);
    float lit = mix(uLightCalm, uLightHear, hear);
    vColor = hslRgb(hue, sat, lit);
    vGain = mix(0.38, 0.82, hear) * (0.72 + 0.28 / depth);
  }
`;

const FRAGMENT_SHADER = `
  precision mediump float;
  varying vec3 vColor;
  varying float vGain;

  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = dot(p, p);
    float alpha = exp(-d * 3.4) * clamp(vGain, 0.0, 1.0);
    if (alpha < 0.02) {
      discard;
    }
    gl_FragColor = vec4(vColor * alpha, alpha);
  }
`;

function compileShader(
  gl: WebGLRenderingContext,
  type: GLenum,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Unable to create shader");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(info ?? "Unknown shader compilation error");
  }
  return shader;
}

function location(
  gl: WebGLRenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation | null {
  return gl.getUniformLocation(program, name);
}

export function VoiceSwarm({
  hear,
  amplitude,
  config,
  className,
  style,
}: {
  hear: number;
  amplitude: number;
  config: VoiceClientConfig;
  className?: string;
  style?: CSSProperties;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const webglRef = useRef<WebGLResources | null>(null);
  const frameRef = useRef<number | null>(null);
  const hearRef = useRef(0);
  const hearTargetRef = useRef(hear);
  const amplitudeRef = useRef(amplitude);
  const amplitudeTargetRef = useRef(amplitude);
  const configRef = useRef(config);
  const lastStampRef = useRef<number | null>(null);

  hearTargetRef.current = hear;
  amplitudeTargetRef.current = amplitude;
  configRef.current = config;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    let gl: WebGLRenderingContext | null = null;
    try {
      gl = canvas.getContext("webgl", {
        antialias: false,
        alpha: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
      });
    } catch {
      return;
    }
    if (!gl) {
      return;
    }

    try {
      const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
      const fragmentShader = compileShader(
        gl,
        gl.FRAGMENT_SHADER,
        FRAGMENT_SHADER,
      );
      const program = gl.createProgram();
      if (!program) {
        throw new Error("Unable to create WebGL program");
      }
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const info = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error(info ?? "Unknown WebGL linking error");
      }
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);

      const count = configRef.current.swarmCount;
      const index = new Float32Array(count);
      for (let i = 0; i < count; i += 1) {
        index[i] = i;
      }
      const buffer = gl.createBuffer();
      if (!buffer) {
        throw new Error("Unable to create vertex buffer");
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, index, gl.STATIC_DRAW);
      const attrib = gl.getAttribLocation(program, "aIndex");
      gl.enableVertexAttribArray(attrib);
      gl.vertexAttribPointer(attrib, 1, gl.FLOAT, false, 0, 0);
      gl.useProgram(program);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);

      webglRef.current = {
        gl,
        program,
        buffer,
        count,
        uniforms: {
          time: location(gl, program, "uTime"),
          hear: location(gl, program, "uHear"),
          amplitude: location(gl, program, "uAmplitude"),
          count: location(gl, program, "uCount"),
          radiusCalm: location(gl, program, "uRadiusCalm"),
          radiusHear: location(gl, program, "uRadiusHear"),
          speedCalm: location(gl, program, "uSpeedCalm"),
          speedHear: location(gl, program, "uSpeedHear"),
          noiseCalm: location(gl, program, "uNoiseCalm"),
          noiseHear: location(gl, program, "uNoiseHear"),
          pointCalm: location(gl, program, "uPointCalm"),
          pointHear: location(gl, program, "uPointHear"),
          hueCalm: location(gl, program, "uHueCalm"),
          hueHear: location(gl, program, "uHueHear"),
          satCalm: location(gl, program, "uSatCalm"),
          satHear: location(gl, program, "uSatHear"),
          lightCalm: location(gl, program, "uLightCalm"),
          lightHear: location(gl, program, "uLightHear"),
          perspective: location(gl, program, "uPerspective"),
          levelNoise: location(gl, program, "uLevelNoise"),
          warpCalm: location(gl, program, "uWarpCalm"),
          warpHear: location(gl, program, "uWarpHear"),
          coupling: location(gl, program, "uCoupling"),
          swirl: location(gl, program, "uSwirl"),
          pixelRatio: location(gl, program, "uPixelRatio"),
          aspect: location(gl, program, "uAspect"),
        },
      };

      const reduceMotion = () =>
        configRef.current.swarmRespectReducedMotion &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      const resize = () => {
        const rect = canvas.getBoundingClientRect();
        const pixelRatio = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.round(rect.width * pixelRatio));
        const height = Math.max(1, Math.round(rect.height * pixelRatio));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        gl.viewport(0, 0, width, height);
      };

      const set1 = (
        slot: WebGLUniformLocation | null,
        value: number,
      ) => {
        if (slot) {
          gl.uniform1f(slot, value);
        }
      };

      const render = (stamp: number) => {
        frameRef.current = requestAnimationFrame(render);
        const resources = webglRef.current;
        if (!resources) {
          return;
        }
        const live = configRef.current;
        const still = reduceMotion();
        resize();
        resources.gl.useProgram(resources.program);
        resources.gl.clearColor(0, 0, 0, 1);
        resources.gl.clear(resources.gl.COLOR_BUFFER_BIT);

        const previous = lastStampRef.current;
        lastStampRef.current = stamp;
        const rawDt = previous === null ? 0 : stamp - previous;
        const dt = Math.min(Math.max(rawDt, 0), live.swarmDtCapMs);
        hearRef.current = expApproach(
          hearRef.current,
          still ? 0 : hearTargetRef.current,
          dt,
          live.swarmHearTauMs,
        );
        const ampBlend = 1 - live.ringSmoothing;
        const nextAmp =
          amplitudeRef.current +
          (amplitudeTargetRef.current - amplitudeRef.current) * ampBlend;
        amplitudeRef.current = nextAmp;

        const width = resources.gl.drawingBufferWidth;
        const height = Math.max(resources.gl.drawingBufferHeight, 1);
        set1(resources.uniforms.time, still ? 0 : stamp * 0.001);
        set1(resources.uniforms.hear, still ? 0 : hearRef.current);
        set1(resources.uniforms.amplitude, nextAmp);
        set1(resources.uniforms.count, resources.count);
        set1(resources.uniforms.radiusCalm, live.swarmRadiusCalm);
        set1(resources.uniforms.radiusHear, live.swarmRadiusHear);
        set1(resources.uniforms.speedCalm, live.swarmSpeedCalm);
        set1(resources.uniforms.speedHear, live.swarmSpeedHear);
        set1(resources.uniforms.noiseCalm, live.swarmNoiseCalm);
        set1(resources.uniforms.noiseHear, live.swarmNoiseHear);
        set1(resources.uniforms.pointCalm, live.swarmPointCalm);
        set1(resources.uniforms.pointHear, live.swarmPointHear);
        set1(resources.uniforms.hueCalm, live.swarmHueCalm);
        set1(resources.uniforms.hueHear, live.swarmHueHear);
        set1(resources.uniforms.satCalm, live.swarmSatCalm);
        set1(resources.uniforms.satHear, live.swarmSatHear);
        set1(resources.uniforms.lightCalm, live.swarmLightCalm);
        set1(resources.uniforms.lightHear, live.swarmLightHear);
        set1(resources.uniforms.perspective, live.swarmPerspective);
        set1(resources.uniforms.levelNoise, live.swarmLevelNoise);
        set1(resources.uniforms.warpCalm, live.swarmWarpCalm);
        set1(resources.uniforms.warpHear, live.swarmWarpHear);
        set1(resources.uniforms.coupling, live.swarmCoupling);
        set1(resources.uniforms.swirl, live.swarmSwirl);
        set1(resources.uniforms.pixelRatio, window.devicePixelRatio || 1);
        set1(resources.uniforms.aspect, width / height);
        resources.gl.drawArrays(resources.gl.POINTS, 0, resources.count);
      };

      resize();
      render(0);

      return () => {
        if (frameRef.current !== null) {
          cancelAnimationFrame(frameRef.current);
        }
        frameRef.current = null;
        lastStampRef.current = null;
        if (webglRef.current) {
          webglRef.current.gl.deleteBuffer(webglRef.current.buffer);
          webglRef.current.gl.deleteProgram(webglRef.current.program);
        }
        webglRef.current = null;
      };
    } catch {
      webglRef.current = null;
      return;
    }
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={style}
      aria-hidden="true"
    />
  );
}
