import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles/index.css'
import './styles/orders.less'
import './styles/support.less'
import './styles/statistics.less'
import './styles/clients.less'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import './styles/reservations.less'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
