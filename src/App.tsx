// src/App.tsx

import React, { useEffect } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Profile from "./pages/Profile";
import Interests from "./pages/Interests";
import Chatbot from "./pages/Chatbot";
import Friends from "./pages/Friends";
import Upgrade from "./pages/Upgrade";
import Header from "./components/common/Header";
import SideNavbar from "./components/common/SideNavbar";
import Footer from "./components/common/Footer";
import "./styles/main.css";
import PrivateRoute from "./components/PrivateRoute";
import { AuthProvider, useAuth } from "./context/AuthContext";

const AppContent: React.FC = () => {
  const { isAuthenticated, checkAuthStatus } = useAuth();

  useEffect(() => {
    checkAuthStatus();
  }, [checkAuthStatus]);

  return (
    <div
      className="app"
      style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {isAuthenticated && <Header />}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {isAuthenticated && <SideNavbar />}
        <main style={{ flex: 1, overflow: "auto", padding: "20px" }}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route
              path="/profile"
              element={<PrivateRoute element={<Profile />} />}
            />
            <Route
              path="/interests"
              element={<PrivateRoute element={<Interests />} />}
            />
            <Route
              path="/chatbot"
              element={<PrivateRoute element={<Chatbot />} />}
            />
            <Route
              path="/friends"
              element={<PrivateRoute element={<Friends />} />}
            />
            <Route
              path="/upgrade"
              element={<PrivateRoute element={<Upgrade />} />}
            />
          </Routes>
        </main>
      </div>
      {isAuthenticated && <Footer />}
    </div>
  );
};

const App: React.FC = () => {
  return (
    <Router>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </Router>
  );
};

export default App;
