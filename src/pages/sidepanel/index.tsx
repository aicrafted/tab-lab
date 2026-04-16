import React from 'react'
import ReactDOM from 'react-dom/client'
import { SidePanel } from './SidePanel'
import { registerDebugApi } from '@/lib/core/debug-api'
import { initDomainData } from '@/lib/ai/domain-prefill'
import '@/globals.css'

registerDebugApi()

void initDomainData().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <SidePanel />
    </React.StrictMode>,
  )
})
