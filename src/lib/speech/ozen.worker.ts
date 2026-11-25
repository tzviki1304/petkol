// Ozen-v1 helper worker.
// On Android it only prepares audio features and turns token ids back into text (the model itself runs natively).
// In a plain browser it also runs the model with ONNX Runtime WASM.
import {
  env,
  AutoProcessor,
  AutoTokenizer,
  AutoModelForSpeechSeq2Seq,
  PreTrainedModel,
  type Processor,
  type PreTrainedTokenizer,
} from '@huggingface/transformers'

type Msg =
  | { type: 'load'; localBase: string | null; modelId: string; encoder: 'fp16' | 'fp32' | 'int8'; decoder?: 'fp32' | 'int8'; threads: number; textOnly: boolean }
  | { type: 'transcribe'; id: number; audio: Float32Array }
  | { type: 'features'; id: number; audio: Float32Array }
  | { type: 'decode'; id: number; tokens: number[] }

let processor: Processor | null = null
let tokenizer: PreTrainedTokenizer | null = null
let model: PreTrainedModel | null = null

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer)
const errText = (e: unknown) => String((e as Error)?.message ?? e)

self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data
  try {
    switch (m.type) {
      case 'load': {
        const origin = self.location.origin
        env.backends.onnx.wasm!.wasmPaths = {
          mjs: `${origin}/ort/ort-wasm-simd-threaded.jsep.mjs`,
          wasm: `${origin}/ort/ort-wasm-simd-threaded.jsep.wasm`,
        }
        env.backends.onnx.wasm!.numThreads = (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated ? m.threads : 1
        if (m.localBase) {
          // Files on the device are served by the app's own local server. transformers.js 4.3 does not
          // recognise http(s) local paths when it checks that a file exists, so we treat that folder as the
          // "remote" host instead: nothing leaves the device.
          env.allowLocalModels = false
          env.allowRemoteModels = true
          env.remoteHost = m.localBase
          env.remotePathTemplate = '{model}/'
          env.useBrowserCache = false
        } else {
          env.allowRemoteModels = true
          env.allowLocalModels = false
          env.useBrowserCache = true
        }
        const t0 = performance.now()
        processor = await AutoProcessor.from_pretrained(m.modelId)
        tokenizer = await AutoTokenizer.from_pretrained(m.modelId)
        if (!m.textOnly) {
          model = await AutoModelForSpeechSeq2Seq.from_pretrained(m.modelId, {
            dtype: { encoder_model: m.encoder, decoder_model_merged: m.decoder ?? 'fp32' },
            device: 'wasm',
            progress_callback: (p: { status: string; progress?: number; file?: string }) => {
              if (p.status === 'progress') post({ type: 'progress', file: p.file, progress: p.progress })
            },
          })
          await transcribe(new Float32Array(16000)) // warm-up
        }
        post({ type: 'loaded', ms: Math.round(performance.now() - t0) })
        return
      }
      case 'features': {
        const f = await features(m.audio)
        post({ type: 'features', id: m.id, features: f }, [f.buffer])
        return
      }
      case 'decode': {
        const text = tokenizer!.decode(m.tokens, { skip_special_tokens: true }).trim()
        post({ type: 'decoded', id: m.id, text })
        return
      }
      case 'transcribe': {
        const t0 = performance.now()
        const text = await transcribe(m.audio)
        post({ type: 'result', id: m.id, text, ms: Math.round(performance.now() - t0) })
        return
      }
    }
  } catch (err) {
    if (m.type === 'load') post({ type: 'error', error: errText(err) })
    else post({ type: 'result', id: m.id, text: '', error: errText(err) })
  }
}

async function features(audio: Float32Array): Promise<Float32Array> {
  const inputs = (await processor!(audio)) as { input_features: { data: Float32Array } }
  return new Float32Array(inputs.input_features.data)
}

async function transcribe(audio: Float32Array): Promise<string> {
  if (!processor || !tokenizer || !model) throw new Error('model not loaded')
  const inputs = await processor(audio)
  // Ozen is monolingual: the generic generate (no language / task tokens), as its model card says.
  const ids = (await PreTrainedModel.prototype.generate.call(model, { ...inputs, max_new_tokens: 220 })) as unknown
  return tokenizer.batch_decode(ids as number[][], { skip_special_tokens: true })[0]?.trim() ?? ''
}
