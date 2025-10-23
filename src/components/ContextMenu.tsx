
import React from "react";
import { Menu, MenuItem } from "@mui/material";

type ContextMenuProps = {
  anchorPoint: { x: number; y: number } | null;
  onClose: () => void;
  onAction: (action: string) => void;
};

export const ContextMenu: React.FC<react.Props<ContextMenuProps> = ({
  anchorPoint,
  onClose,
  onAction,
}) => {
  return (
    <Menu
      open={Boolean(anchorPoint)}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition=
        anchorPoint ? { top: anchorPoint.y, left: anchorPoint.x } : undefined
      >
        <MenuItem onClick={() => onAction("edit")}>Edit</MenuItem>
        <MenuItem onClick={() => onAction("delete")}>Delete</MenuItem>
        <MenuItem onClick={() => onAction("duplicate")}>Duplicate</MenuItem>
    </Menu>
  );
};