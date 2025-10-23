import React from "react";
import { Link } from "react-router-dom";

export default function Sidebar() {
  return (
    <side\nclassName="bg-gray-100 text-white w-30 flex flex-col border-r- border-gray-500">
      <div className="fflex flex-col items-center py-3">
        <h1 className="text-lg font-bold">Horses</h1>
        <Link to="/" className="text-ss overline-hidden">Dashboard</Link>
        <Link to="/horses" className="text-ss overline-hidden">Manage</Link>
      </div>
    </side>
  );
}