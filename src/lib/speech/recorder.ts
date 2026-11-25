// Microphone capture at 16 kHz with a small energy-based voice detector that cuts speech into phrases.

export interface RecorderOptions {
  silenceMs: number // pause length that ends a phrase
  maxPhraseSec: number // force a cut after this long
  sensitivity: 'quiet' | 'normal' | 'noisy'
  onPhrase: (audio: Float32Array) => void
  onLevel?: (level: number, speaking: boolean) => void
  onSilence?: (silentMs: number) => void
}

const RATE = 16000
const FRAME = 480 // 30 ms

const workletCode = `
class Tap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) this.port.postMessage(ch.slice(0))
    return true
  }
}
registerProcessor('petkol-tap', Tap)
`

export class Recorder {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: AudioWorkletNode | null = null
  private src: MediaStreamAudioSourceNode | null = null
  private opts: RecorderOptions

  private frameBuf = new Float32Array(FRAME)
  private frameLen = 0
  private noise = 0.004
  private chunks: Float32Array[] = []
  private chunkLen = 0
  private preroll: Float32Array[] = []
  private inSpeech = false
  private silentFrames = 0
  private voicedFrames = 0
  private silentSinceSpeechMs = 0
  private resampleRatio = 1
  private resamplePos = 0
  private lastSample = 0

  constructor(opts: RecorderOptions) {
    this.opts = opts
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true },
    })
    let ctx: AudioContext
    try {
      ctx = new AudioContext({ sampleRate: RATE })
    } catch {
      ctx = new AudioContext()
    }
    this.ctx = ctx
    this.resampleRatio = ctx.sampleRate / RATE
    const url = URL.createObjectURL(new Blob([workletCode], { type: 'application/javascript' }))
    await ctx.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    this.src = ctx.createMediaStreamSource(this.stream)
    this.node = new AudioWorkletNode(ctx, 'petkol-tap')
    this.node.port.onmessage = (e) => this.push(e.data as Float32Array)
    this.src.connect(this.node)
    // keep the graph running without playing the mic back
    const mute = ctx.createGain()
    mute.gain.value = 0
    this.node.connect(mute).connect(ctx.destination)
    if (ctx.state === 'suspended') await ctx.resume()
  }

  async stop() {
    this.flushPhrase(true)
    this.node?.disconnect()
    this.src?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    await this.ctx?.close().catch(() => {})
    this.ctx = null
    this.node = null
    this.src = null
    this.stream = null
  }

  private push(input: Float32Array) {
    // resample to 16 kHz if the device refused our sample rate (linear interpolation)
    let data = input
    if (this.resampleRatio !== 1) {
      const out: number[] = []
      let pos = this.resamplePos
      while (pos < input.length) {
        const i = Math.floor(pos)
        const f = pos - i
        const a = i === 0 && f < 0 ? this.lastSample : input[i]
        const b = i + 1 < input.length ? input[i + 1] : input[i]
        out.push(a + (b - a) * f)
        pos += this.resampleRatio
      }
      this.resamplePos = pos - input.length
      this.lastSample = input[input.length - 1]
      data = Float32Array.from(out)
    }
    for (let i = 0; i < data.length; i++) {
      this.frameBuf[this.frameLen++] = data[i]
      if (this.frameLen === FRAME) {
        this.onFrame(this.frameBuf.slice(0))
        this.frameLen = 0
      }
    }
  }

  private threshold(): number {
    const mult = this.opts.sensitivity === 'quiet' ? 2.2 : this.opts.sensitivity === 'noisy' ? 4 : 3
    const floor = this.opts.sensitivity === 'quiet' ? 0.006 : this.opts.sensitivity === 'noisy' ? 0.02 : 0.01
    return Math.max(this.noise * mult, floor)
  }

  private onFrame(frame: Float32Array) {
    let sum = 0
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
    const rms = Math.sqrt(sum / frame.length)
    const speaking = rms > this.threshold()
    if (!speaking) this.noise = this.noise * 0.95 + rms * 0.05 // track background level
    this.opts.onLevel?.(Math.min(1, rms * 12), speaking)

    if (!this.inSpeech) {
      this.preroll.push(frame)
      if (this.preroll.length > 10) this.preroll.shift() // 300 ms before speech
      if (speaking) {
        this.voicedFrames++
        if (this.voicedFrames >= 3) {
          this.inSpeech = true
          this.silentFrames = 0
          for (const f of this.preroll) this.add(f)
          this.preroll = []
        }
      } else {
        this.voicedFrames = 0
        this.silentSinceSpeechMs += 30
        this.opts.onSilence?.(this.silentSinceSpeechMs)
      }
      return
    }

    this.add(frame)
    this.silentSinceSpeechMs = 0
    if (speaking) this.silentFrames = 0
    else this.silentFrames++

    const lenSec = this.chunkLen / RATE
    const pauseMs = this.silentFrames * 30
    if ((pauseMs >= this.opts.silenceMs && lenSec >= 1.2) || lenSec >= this.opts.maxPhraseSec) {
      this.flushPhrase(false)
    } else if (pauseMs >= this.opts.silenceMs * 2.5) {
      this.flushPhrase(false) // short noise burst, close it anyway
    }
  }

  private add(f: Float32Array) {
    this.chunks.push(f)
    this.chunkLen += f.length
  }

  private flushPhrase(final: boolean) {
    const len = this.chunkLen
    const chunks = this.chunks
    this.chunks = []
    this.chunkLen = 0
    this.inSpeech = false
    this.voicedFrames = 0
    this.silentFrames = 0
    if (len < RATE * 0.5) return
    const out = new Float32Array(len)
    let o = 0
    for (const c of chunks) {
      out.set(c, o)
      o += c.length
    }
    // trim trailing silence (keep 200 ms)
    const trimmed = final ? out : out.subarray(0, Math.max(RATE, len - Math.max(0, this.opts.silenceMs - 200) * 16))
    this.opts.onPhrase(trimmed.slice(0))
  }
}
