import { createRoot } from 'react-dom/client'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import './styles/tokens.css'
import './styles/shell.css'
import './styles/ui.css'
import { App } from './App'
import { applyCachedTheme } from './theme'

applyCachedTheme()

createRoot(document.getElementById('root')!).render(<App />)
