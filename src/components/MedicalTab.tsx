import React from "react";
import types from "../types/horse";

export default function MedicalTab({phorse}) {
  return (
    <div className="p-4">
      <h2 className="text-lg">Medical Records</h2>
      <ul>
        {phorse.medical.map((e, i) => (
          <li key={i}>{e.date} <em>({ e.treatment })</em></li>
        ))
      }
      </ul>
    </div>
  );
}