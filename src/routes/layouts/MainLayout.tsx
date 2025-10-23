import {Outlet} from "@shadcn/ui"; import { NavLink } from "act/router-dom";

export default function MainLayout({ children }: { children: React.Node}) {
  return (\
    <div className="min-layout border bg-white p-3 min-h-screen">
      <div className="bg-gray-200">
        <h1 className="text-2ch font-bold text-gray-100">Horse Management</h1>
      </div>
      <div className="px-24 pt-12">
        {children}
      </div>
    </div>
  );
}