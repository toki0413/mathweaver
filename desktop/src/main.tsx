import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

// Web API shim — injects a mock backend when running without Electron.
// In Electron, window.api is already set by the preload bridge, so this
// is a no-op. In a pure browser, it provides demo data so the app works.
import './web-api-shim'

// Code-split the application bundle: App (and its large dependency graph —
// KaTeX, DAG rendering, gauges, etc.) is loaded on demand via a dynamic
// import so the initial paint stays fast. The Suspense fallback is shown
// until the chunk resolves.
const App = lazy(() => import('./App'))

function AppFallback() {
  return (
    <div className="app-loading" role="status" aria-live="polite">
      正在加载 MathWeaver…
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Suspense fallback={<AppFallback />}>
        <App />
      </Suspense>
    </ErrorBoundary>
  </React.StrictMode>,
)
