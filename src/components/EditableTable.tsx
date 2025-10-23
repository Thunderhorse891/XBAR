
import React from 'react';
import { useTable } from '@tanstack/react-table';
import { useHorses } from '../store/useHorses';
import EditableField from './EditableField';

export function EditableTable() {
  const { horses, updateHorse } = useHorses();

  const columns = React.useMemo(
    () => [
      {
        Header: 'Name',
        accessor: 'name',
        Cell: ({ row }: any) => (
          <EditableField
            value={row.original.name}
            onSave={(val) => updateHorse(row.original.id, { name: val })}
          />
        ),
      },
      {
        Header: 'Breed',
        accessor: 'breed',
        Cell: ({ row }: any) => (
          <EditableField
            value={row.original.breed}
            onSave={(val) => updateHorse(row.original.id, { breed: val })}
          />
        ),
      },
      {
        Header: 'Status',
        accessor: 'status',
        Cell: ({ row }: any) => (
          <EditableField
            value={row.original.status}
            onSave={(val) => updateHorse(row.original.id, { status: val })}
          />
        ),
      },
    ],
    [updateHorse]
  );

  const { getTableProps, getTableBodyProps, headerGroups, rows, prepareRow } =
    useTable({
      columns,
      data: horses,
    });

  return (
    <table {...getTableProps()} className="w-full table-auto border">
      <thead>
        {headerGroups.map((headerGroup) => (
          <tr {...headerGroup.getHeaderGroupProps()}>
            {headerGroup.headers.map((column) => (
              <th {...column.getHeaderProps()} className="border px-4 py-2">
                {column.render('Header')}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody {...getTableBodyProps()}>
        {rows.map((row) => {
          prepareRow(row);
          return (
            <tr {...row.getRowProps()}>
              {row.cells.map((cell) => (
                <td {...cell.getCellProps()} className="border px-4 py-2">
                  {cell.render('Cell')}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
