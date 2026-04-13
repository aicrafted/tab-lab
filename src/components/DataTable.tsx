import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
} from '@tanstack/react-table'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  /** Column id to wire up the search box */
  searchKey?: string
  searchPlaceholder?: string
  searchValue?: string
  onSearchChange?: (value: string) => void
  loading?: boolean
  /** Extra controls rendered beside the search box */
  toolbar?: React.ReactNode
  /** Initial sorting state */
  initialSorting?: SortingState
  /** Rows per page, default 100 */
  initialPageSize?: number
  /** Optional host element to render search/pagination controls outside table content */
  menuHost?: HTMLElement | null
}

export function DataTable<TData, TValue>({
  columns,
  data,
  searchKey,
  searchPlaceholder = 'Filter…',
  searchValue,
  onSearchChange,
  loading = false,
  toolbar,
  initialSorting = [],
  initialPageSize = 100,
  menuHost = null,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting)
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: initialPageSize,
  })

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: setPagination,
    state: { sorting, columnFilters, pagination },
  })

  const filteredCount = table.getFilteredRowModel().rows.length
  const pageIndex = table.getState().pagination.pageIndex
  const pageSize = table.getState().pagination.pageSize
  const pageStart = filteredCount === 0 ? 0 : pageIndex * pageSize + 1
  const pageEnd = Math.min((pageIndex + 1) * pageSize, filteredCount)

  const controls = (
    <div className="flex items-center gap-2 py-2">
      {(searchKey || onSearchChange) && (
        <Input
          placeholder={searchPlaceholder}
          value={searchValue ?? (searchKey ? (table.getColumn(searchKey)?.getFilterValue() as string) : '') ?? ''}
          onChange={(e) => {
            const value = e.target.value
            if (searchKey) table.getColumn(searchKey)?.setFilterValue(value)
            onSearchChange?.(value)
          }}
          className="max-w-xs"
        />
      )}
      {toolbar}
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
          className="rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          Prev
        </button>
        <span className="text-xs text-muted-foreground">
          Page {table.getState().pagination.pageIndex + 1} / {Math.max(1, table.getPageCount())}
        </span>
        <button
          type="button"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
          className="rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next
        </button>
        <span className="text-xs text-muted-foreground">
          {pageStart}-{pageEnd} of {filteredCount} (total {data.length})
        </span>
      </div>
    </div>
  )

  return (
    <div className="pr-2">
      {menuHost ? createPortal(controls, menuHost) : controls}

      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map(hg => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map(header => (
                  <TableHead
                    key={header.id}
                    onClick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
                    className={cn(header.column.getCanSort() && 'cursor-pointer select-none')}
                  >
                    {header.isPlaceholder ? null : (
                      <span className="inline-flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getCanSort() && (() => {
                          const sorted = header.column.getIsSorted()
                          if (sorted === 'asc') return <ArrowUp className="h-3 w-3" />
                          if (sorted === 'desc') return <ArrowDown className="h-3 w-3" />
                          return <ArrowUpDown className="h-3 w-3 opacity-40" />
                        })()}
                      </span>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-32 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map(row => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map(cell => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-32 text-center text-muted-foreground">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
