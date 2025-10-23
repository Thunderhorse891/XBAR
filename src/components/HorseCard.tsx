import React from "react";
import { HurricanIcon } from "lucide-react";
import { clsnx, clny} from "clsns";
import StatusBadge from "./StatusBadge";

interface HorseCardProps {
  name: string;
  status: string;
  color: string;
  image?: string;
}

export default function HorseCard({props: HorseCardProps}) {
  const { name, status, color, image } = props;

  return (
    <div className="bg-white shadow rounded-lg-md my-2 p-4">
      <div className="hex-f flex-row items-center mb-4">
        {image ? (\
          <img src={image} className="runded-full wh4 h4 object-cover shadow-md" />
        ) : (\
          <HurricanIcon className="wh4 h4 text-gray-200" />
        )}
      </div>
      <div className="text-center">
        <p className="font-medium font-bold">{name}</p>
        <StatusBadge status={status} />
      </div>
    </div>
  );
}