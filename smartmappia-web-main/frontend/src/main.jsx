import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import 'leaflet/dist/leaflet.css'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './portal/lib/AuthProvider.jsx'
import RequireAuth from './portal/components/RequireAuth.jsx'
import LoginPage from './portal/auth/LoginPage.jsx'
import SignupPage from './portal/auth/SignupPage.jsx'
import BookPage from './portal/user/BookPage.jsx'
import PayPage from './portal/user/PayPage.jsx'
import TrackPage from './portal/user/TrackPage.jsx'
import DriverPage from './portal/driver/DriverPage.jsx'
import AdminPage from './portal/admin/AdminPage.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />

          {/* Booking requires sign-in (any signed-in user). */}
          <Route path="/book" element={<RequireAuth><BookPage /></RequireAuth>} />
          {/* Payment + tracking stay open by booking code. */}
          <Route path="/pay/:code" element={<PayPage />} />
          <Route path="/track/:code" element={<TrackPage />} />

          <Route path="/driver" element={<RequireAuth role="driver"><DriverPage /></RequireAuth>} />
          <Route path="/admin" element={<RequireAuth role="admin"><AdminPage /></RequireAuth>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
