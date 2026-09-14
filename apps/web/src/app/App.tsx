import { BrowserRouter, Route, Routes } from "react-router-dom";

import { HomePage } from "../pages/HomePage";
import { RoomPage } from "../pages/RoomPage";

export function App() {
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
