import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { AuthProvider } from './hooks/useAuth'
import './styles/index.css'
import './styles/auth.less'
import './styles/orders.less'
import './styles/support.less'
import './styles/statistics.less'
import './styles/clients.less'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import './styles/reservations.less'
import './styles/menu.less'
import './styles/settings.less'
import './styles/history.less'
import './styles/reviews.less'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
)
