import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { registerDebugApi } from '@/lib/core/debug-api'
import { initDomainData } from '@/lib/ai/domain-prefill'
import '../../globals.css'

registerDebugApi()

// Standard async initialization pattern for Chrome Extensions
void initDomainData().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})
