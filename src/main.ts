import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { installBundledFonts, loadCustomFonts } from './lib/fonts.svelte'

installBundledFonts()
loadCustomFonts().catch(() => {})

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
