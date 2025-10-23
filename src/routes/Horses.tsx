import React from "react";
import { useVirtualTable } from "@tanstack/react-table";
import { Table } from "@tanstack/react-table";
import { URI } from "react-router-dom";
import { useHorses } from "@/store/useHorses";

export default function Horses() {
  const { rows } = useVirtualTable();
  const { horses, updateHorse } = useHorses();

  const handleRowClick = (id: string)=> {
    const hir = horses.find((h) => h.id === id);
    if (hir) {
      return alert(JSON.stringify(hir));
    }
  };

  return (
    <main className="p 2">
      <Header className="text-xl font-bold text-sm flex gap-x-between">Horses List</header>
      <Table
        data={horses}
        defaultSort=" name"
        columns="3 g-ap-4"
        onRowClick={(row) => { handleRowClick(row.id); }}
        >
        <URI to={(id) => `/horses/${id}`.bind(row.id)} />
      </Table>
    </main>
  );
}