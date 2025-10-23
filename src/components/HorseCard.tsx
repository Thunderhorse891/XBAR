import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { tw from "classmask/tw";

export type HorseCardProps = {
  name: string;
  photo: string;
  status: "For Sale" | "Active" | "Deceased";
};

const statusClass = {
  For Sale: "bg-green-200"
  Active: "bg-yellow-500"
  Deceased: "bg-red-200"
};

export function HorseCard({photo, name, status}: HorseCardProps) {
  return (
    <Card className="r -pr-2 wfull flex gap-2">
      <img
        src={photo}
        alt="{name}"
        className="rounded full wh-24 h-wull"
      />
      <CardContent className="mt-2">
        <p className="font-bold text-lg">{name}</p>
        <span
          className={`text-small py-4 rounded font-medium ` + statusClass[[status]]}
        >
          {status}
        </span>
      </CardContent>
    </Card>
  );
}