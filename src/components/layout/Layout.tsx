import React, { ReactNode } from "react";
import Nav from "./Nav";
import Sidebar from "./Sidebar";

type LayoutProps = {
  children: ReactNode;
};

export default function Layout({children}: LayoutProps) {
  return (
    <div className="flex h=screen bg-gray-200 with-full min-h-screen">
      <Sidebar />
      <div className="flex-1 flex-col flex-1 bg-white rounded-lg flex-1">
        <Nav />
        <div className="p4 fles-1 max-w-full">
          {children}
        </div>
      </div>
    </div>
  );
}