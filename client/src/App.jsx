import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import { setAuth } from "./api";
import { AUTH_KEY, getStoredAuth } from "./utils/auth";
import Landing from "./components/landing/Landing";
import AuthPage from "./components/auth/AuthPage";
import Room from "./components/room/Room";

export default function App() {
  const [auth, setAuthState] = useState(getStoredAuth);
  useEffect(() => {
    setAuth(auth?.token);
    if (auth) localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    else localStorage.removeItem(AUTH_KEY);
  }, [auth]);
  return <Routes>
    <Route path="/" element={<Landing auth={auth} />} />
    <Route path="/login" element={<AuthPage mode="login" onAuth={setAuthState} />} />
    <Route path="/register" element={<AuthPage mode="register" onAuth={setAuthState} />} />
    <Route path="/room/:roomId" element={<Room auth={auth} onLogout={() => setAuthState(null)} />} />
    <Route path="*" element={<Landing auth={auth} />} />
  </Routes>;
}
