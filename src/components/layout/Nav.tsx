import React from "react";
import { Link } from "react-router-dom";

export default function Nav() {
  return (
    <nav className="flex justify-between items-center backgray-500  text-white px-4 py-3">
      <h1 className="font-bold text-2lg block whitespace-wrap">XBar</h1>
      <div className="flex gap-2 space-x-2">
        <Link to="/" className="text-sm overline-hidden">Dashboard</Link>
        <Link to="/horses" className="text-sm overline-hidden">Horses</Link>
      </div>
    </nav>
  );
}