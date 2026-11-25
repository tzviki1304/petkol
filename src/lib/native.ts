import { Capacitor, registerPlugin } from '@capacitor/core'

export interface PetkolNativePlugin {
  whisperLoad(o: { path: string; threads?: number }): Promise<{ ok: boolean }>
  whisperTranscribe(o: { audio: string; language?: string; prompt?: string }): Promise<{ text: string; ms: number }>
  whisperUnload(): Promise<void>
  ozenLoad(o: { dir: string; threads?: number; lowMem?: boolean; memOpts?: string }): Promise<{ ok: boolean; ms: number }>
  ozenRun(o: { features: string; maxTokens?: number }): Promise<{ tokens: number[]; ms: number }>
  ozenUnload(): Promise<void>
  whisperInfo(): Promise<{ loaded: boolean; path?: string; system: string }>
  htmlToPdf(o: { html: string; fileName: string }): Promise<{ path: string }>
  installApk(o: { path: string }): Promise<void>
  canInstallApks(): Promise<{ value: boolean }>
  deviceInfo(): Promise<{ totalRamMB: number; availRamMB: number; cores: number; abi: string; manufacturer: string; model: string; sdk: number }>
  listSystemFonts(): Promise<{ fonts: { name: string; file: string }[] }>
  readFileBase64(o: { path: string }): Promise<{ data: string }>
  keepScreenOn(o: { on: boolean }): Promise<void>
  // background recording (foreground service, works with the screen off)
  recStart(o: { dir: string; chunkSec?: number; minChunkSec?: number }): Promise<{ ok: boolean }>
  recStop(): Promise<{ files: string[]; seconds: number }>
  recStatus(): Promise<{ recording: boolean; seconds: number; dir?: string; files: string[] }>
  // keep the app alive (and show progress) while slow work runs in the background
  workStart(o: { title: string; text?: string }): Promise<void>
  workUpdate(o: { text?: string; progress?: number; max?: number }): Promise<void>
  workStop(): Promise<void>
  requestNotifications(): Promise<{ granted: boolean }>
  requestIgnoreBatteryOptimizations(): Promise<{ ignoring: boolean; opened: boolean }>
  addListener(
    event: 'recLevel' | 'recChunk' | 'recStopped',
    cb: (data: { level?: number; seconds: number; file?: string; index?: number; files?: string[] }) => void,
  ): Promise<{ remove: () => Promise<void> }>
}

export const isNative = Capacitor.isNativePlatform()
export const Native = registerPlugin<PetkolNativePlugin>('PetkolNative')

export function float32ToB64(a: Float32Array): string {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
  let s = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode(...bytes.subarray(i, i + step))
  return btoa(s)
}
