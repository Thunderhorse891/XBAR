import React from "react";
import { Tree } from "@treedata/react";
import "../types/horse.ts";

export default function PedigreeTree({ horse }: { return (
  <div className="p-4 bg-gray-100 text-white">
    <h1 className="text-12 font-bold">Pedigree</h1>
    <FlexibleTree data={horse.pedigree} />
  </div>
); }