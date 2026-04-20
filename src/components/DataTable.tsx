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
import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
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
import { cn } from '@/lib/core/utils'

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
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null)
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
    enableSortingRemoval: false,
    sortDescFirst: false,
    state: { sorting, columnFilters, pagination },
  })

  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof window === 'undefined') return
    let parent = root.parentElement
    while (parent) {
      const style = window.getComputedStyle(parent)
      if (/(auto|scroll)/.test(style.overflowY)) {
        setScrollElement(parent)
        return
      }
      parent = parent.parentElement
    }
    setScrollElement(null)
  }, [])

  const filteredCount = table.getFilteredRowModel().rows.length
  const rows = table.getRowModel().rows
  const shouldVirtualize = !loading && rows.length > 80 && scrollElement != null
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => 56,
    overscan: 10,
  })
  const virtualRows = shouldVirtualize ? rowVirtualizer.getVirtualItems() : []
  const paddingTop = shouldVirtualize && virtualRows.length > 0 ? virtualRows[0].start : 0
  const paddingBottom = shouldVirtualize && virtualRows.length > 0
    ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
    : 0
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
        <span className="text-xs text-muted-foreground">
          {pageStart}-{pageEnd} of {filteredCount}
        </span>
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
      </div>
    </div>
  )

  return (
    <div ref={rootRef} className="pr-2">
      {menuHost ? createPortal(controls, menuHost) : controls}

      <div className="rounded-md border border-border">
        <Table className="min-w-full">
          <TableHeader>
            {table.getHeaderGroups().map(hg => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map(header => (
                  (() => {
                    const isFavicon = header.column.id === 'favicon'
                    const isTitle = header.column.id === 'title'
                    const isTags = header.column.id === 'tags'
                    const isTitleOrTags = isTitle || isTags
                    return (
                  <TableHead
                    key={header.id}
                    onClick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
                    className={cn(
                      header.column.getCanSort() && 'cursor-pointer select-none',
                      isFavicon && 'w-8 min-w-8 px-2',
                      isTitle && 'w-1/2 min-w-[250px] max-w-0',
                      isTags && 'w-1/2 max-w-0',
                      !isTitleOrTags && !isFavicon && 'whitespace-nowrap',
                    )}
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
                    )
                  })()
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
            ) : rows.length > 0 ? (
              <>
                {shouldVirtualize && paddingTop > 0 && (
                  <TableRow>
                    <TableCell colSpan={columns.length} style={{ height: `${paddingTop}px`, padding: 0 }} />
                  </TableRow>
                )}

                {(shouldVirtualize
                  ? virtualRows.map((virtualRow) => rows[virtualRow.index]!)
                  : rows
                ).map(row => (
                  <TableRow
                    key={row.id}
                    ref={shouldVirtualize ? (node) => {
                      if (node) rowVirtualizer.measureElement(node)
                    } : undefined}
                    className="[content-visibility:auto] [contain-intrinsic-size:48px]"
                  >
                    {row.getVisibleCells().map(cell => {
                      const isFavicon = cell.column.id === 'favicon'
                      const isTitle = cell.column.id === 'title'
                      const isTags = cell.column.id === 'tags'
                      const isTitleOrTags = isTitle || isTags
                      return (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          'align-top',
                          isFavicon && 'w-8 min-w-8 px-2',
                          isTitle && 'w-1/2 min-w-[250px] max-w-0',
                          isTags && 'w-1/2 max-w-0',
                          !isTitleOrTags && !isFavicon && 'whitespace-nowrap',
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                      )
                    })}
                  </TableRow>
                ))}

                {shouldVirtualize && paddingBottom > 0 && (
                  <TableRow>
                    <TableCell colSpan={columns.length} style={{ height: `${paddingBottom}px`, padding: 0 }} />
                  </TableRow>
                )}
              </>
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
