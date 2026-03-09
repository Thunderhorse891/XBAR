import React from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table';
import { useHorses } from '../store/useHorses';
import { OCRHorse } from '../types/horse';
import EditableField from './EditableField';

const columnHelper = createColumnHelper<OCRHorse>();

export function EditableTable() {
  const { horses, updateHorse } = useHorses();

  const columns = [
    columnHelper.accessor('name', {
      header: 'Name',
      cell: ({ row }) => (
        <EditableField
          value={row.original.name}
          onSave={(val) => updateHorse(row.original.id, { name: val })}
        />
      ),
    }),
    columnHelper.accessor('breed', {
      header: 'Breed',
      cell: ({ row }) => (
        <EditableField
          value={row.original.breed}
          onSave={(val) => updateHorse(row.original.id, { breed: val })}
        />
      ),
    }),
    columnHelper.accessor('status', {
      header: 'Status',
      cell: ({ row }) => (
        <EditableField
          value={row.original.status ?? ''}
          onSave={(val) => updateHorse(row.original.id, { status: val as OCRHorse['status'] })}
        />
      ),
    }),
    columnHelper.accessor('owner', {
      header: 'Owner',
      cell: ({ row }) => (
        <EditableField
          value={row.original.owner}
          onSave={(val) => updateHorse(row.original.id, { owner: val })}
        />
      ),
    }),
  ];

  const table = useReactTable({
    data: horses,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-auto border-collapse border border-gray-200">
        <thead className="bg-gray-50">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} className="border border-gray-200 px-4 py-2 text-left text-sm font-medium text-gray-600">
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="hover:bg-gray-50">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="border border-gray-200 px-4 py-2 text-sm">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default EditableTable;
