import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './portal/lib/AuthProvider.jsx'
import { ViewModeProvider } from './portal/lib/ViewModeProvider.jsx'
import RequireAuth from './portal/components/RequireAuth.jsx'
import LoginPage from './portal/auth/LoginPage.jsx'
import SignupPage from './portal/auth/SignupPage.jsx'
import HomePage from './portal/user/HomePage.jsx'
import BookPage from './portal/user/BookPage.jsx'
import PayPage from './portal/user/PayPage.jsx'
import TrackPage from './portal/user/TrackPage.jsx'
import DriverPage from './portal/driver/DriverPage.jsx'
import MerchantDashboard from './portal/merchant/MerchantDashboard.jsx'
import AdminPage from './portal/admin/AdminPage.jsx'
import FoodHomePage from './portal/food/FoodHomePage.jsx'
import RestaurantPage from './portal/food/RestaurantPage.jsx'
import FoodCartPage from './portal/food/FoodCartPage.jsx'
import FoodCheckoutPage from './portal/food/FoodCheckoutPage.jsx'
import FoodTrackPage from './portal/food/FoodTrackPage.jsx'
import FoodOrdersPage from './portal/food/FoodOrdersPage.jsx'
import NotificationsPage from './portal/user/NotificationsPage.jsx'
import TransactionsPage from './portal/user/TransactionsPage.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ViewModeProvider>
          <Routes>
            <Route path="/" element={<App />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />

            {/* Signed-in users land on the multi-service hub. */}
            <Route path="/home" element={<RequireAuth role="passenger" redirectWrongRole><HomePage /></RequireAuth>} />
            {/* Notification inbox + transaction records (any signed-in user). */}
            <Route path="/notifications" element={<RequireAuth><NotificationsPage /></RequireAuth>} />
            <Route path="/transactions" element={<RequireAuth><TransactionsPage /></RequireAuth>} />
            {/* Booking is for passengers only — drivers/admins are redirected to their dashboard. */}
            <Route path="/book" element={<RequireAuth role="passenger" redirectWrongRole><BookPage /></RequireAuth>} />
            {/* Payment + tracking stay open by booking code. */}
            <Route path="/pay/:code" element={<PayPage />} />
            <Route path="/track/:code" element={<TrackPage />} />

            <Route path="/driver" element={<RequireAuth role="driver"><DriverPage /></RequireAuth>} />
            <Route path="/merchant" element={<RequireAuth role="merchant"><MerchantDashboard /></RequireAuth>} />
            <Route path="/admin" element={<RequireAuth role="admin"><AdminPage /></RequireAuth>} />

            {/* Food Delivery — browsing is public; cart/checkout/orders need sign-in. */}
            <Route path="/food" element={<FoodHomePage />} />
            <Route path="/food/r/:id" element={<RestaurantPage />} />
            <Route path="/food/cart" element={<RequireAuth><FoodCartPage /></RequireAuth>} />
            <Route path="/food/checkout" element={<RequireAuth><FoodCheckoutPage /></RequireAuth>} />
            <Route path="/food/orders" element={<RequireAuth><FoodOrdersPage /></RequireAuth>} />
            <Route path="/food/track/:code" element={<RequireAuth><FoodTrackPage /></RequireAuth>} />
          </Routes>
        </ViewModeProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
