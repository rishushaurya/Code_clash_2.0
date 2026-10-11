import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { syncSiteFromServer } from './shared/site'

// Every device of a workspace (twin, phone camera, second screen) starts from the workspace's site on the server.
void syncSiteFromServer()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
