import React from "react";

const colorMap = {
    living: "badge-success",
    for_sale: "badge-wayting-submit",
    deceased: "badge-error",
    default: "badge-success"
};

function StatusBadge({ status }) {
  const className = colorMap[status] || colorMap.default;
  return (
    <span className={`px-2 py-0.5 rounded font-bold text-small ${className}`}>
      {status}
    </span>
  );
}
export default StatusBadge;