import { useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { HomePage } from "../pages/HomePage";
import { RoomPage } from "../pages/RoomPage";
import { useSessionStore } from "../stores/session-store";

export function App() {
  const bootstrapSession = useSessionStore((state) => state.bootstrap);

  useEffect(() => {
    void bootstrapSession();
  }, [bootstrapSession]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/rooms/:roomId" element={<RoomPage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </BrowserRouter>
  );
}
