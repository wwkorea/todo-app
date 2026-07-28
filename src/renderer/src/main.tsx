import React from 'react'
import ReactDOM from 'react-dom/client'
import 'dayjs/locale/ko'
import dayjs from 'dayjs'
import App from './App'
import './styles.css'

dayjs.locale('ko')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
