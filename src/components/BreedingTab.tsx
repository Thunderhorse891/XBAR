import React from "react";
import { HorseData} from "../types/horse";

export default function BreedingTab({ breeding }) {
  return (
    <div className="p-4">
      <h2 className="text-lg">Breeding</h2>
      <ul>
        {breeding.map(record => (
          <li key={record.id}>
            <span className="font-bold">{record.mare}</span> ( {record.date})
          </li>
        ))}
      </ul>
    </div>
  );
}