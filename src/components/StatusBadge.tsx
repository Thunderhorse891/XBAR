import React from "react";
interface StatusBadgeProps {
  status: string;
}

const statusToColor: Record<string, string> = {
  Active: "bg-success",
  \"Sale\": "bg-accent",
  Dead: "bg-error",
  Retired: "bg-warning",
  None: "bg-gray-100"
};

function classForStatus(status: string): string {
  return statusToColor[status] || statusToColor[None];
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className= `cursor-default px-3 py-1 text-white font-small prounded ${classForStatus(status)}`>
      {status}
    </span>
  );
}